import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { createSandboxAudit } from "./sandbox-audit.ts";
import { SandboxService } from "./sandboxd-core.ts";
import { createSandboxdHandler } from "./sandboxd.ts";
import { SandboxdVerifier } from "./sandboxd-auth.ts";
import { kubeconfigFileFromEnv, type K8sClient, type K8sResponse } from "./sandboxd-k8s-client.ts";
import { kubernetesApi } from "./sandboxd-k8s.ts";
import { PAUSED_ANNOTATION, kubernetesSandboxConfigFromEnv } from "./sandboxd-k8s-spec.ts";
import { FakeDocker } from "./testing/fake-docker.ts";
import { sandboxdClient } from "./user-sandbox-client.ts";
import { SANDBOX_INSTANCE_LABEL, SANDBOX_LABEL, SANDBOX_USER_LABEL, sandboxKeyForPrincipal, sandboxNames, sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";

const DIGEST = "cd".repeat(32);
const REGISTRY = "ghcr.io/pulsatrixtechnologies";
const IMAGE = `${REGISTRY}/sagax-sandbox:1.0.0@sha256:${DIGEST}`;
const KEY = "a".repeat(64);
const person = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-0000000000bb");

type Obj = Record<string, unknown>;

function mergePatch(target: Obj, patch: Obj): void {
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) {
      delete target[field];
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && target[field] && typeof target[field] === "object" && !Array.isArray(target[field])) {
      mergePatch(target[field] as Obj, value as Obj);
      continue;
    }
    target[field] = value;
  }
}

function memoryCluster(): { client: K8sClient; objects: Map<string, Obj> } {
  const objects = new Map<string, Obj>();
  const client: K8sClient = {
    async request(method, path, body): Promise<K8sResponse> {
      const url = new URL(path, "https://kubernetes.local");
      const pathname = url.pathname;
      if (method === "GET" && url.searchParams.has("labelSelector")) {
        const selector = url.searchParams.get("labelSelector") ?? "";
        const wanted = selector.split(",").filter(Boolean).map((pair) => {
          const index = pair.indexOf("=");
          return [pair.slice(0, index), pair.slice(index + 1)] as const;
        });
        const prefix = `${pathname}/`;
        const items = [...objects.entries()].filter(([stored, obj]) => {
          if (!stored.startsWith(prefix) || stored.slice(prefix.length).includes("/")) return false;
          const labels = ((obj.metadata as Obj | undefined)?.labels ?? {}) as Record<string, string>;
          return wanted.every(([field, value]) => labels[field] === value);
        }).map(([, obj]) => obj);
        return { status: 200, body: { items } };
      }
      if (method === "GET") {
        const found = objects.get(pathname);
        return found ? { status: 200, body: found } : { status: 404, body: {} };
      }
      if (method === "DELETE") {
        if (!objects.delete(pathname)) return { status: 404, body: {} };
        return { status: 200, body: {} };
      }
      if (method === "PATCH") {
        const found = objects.get(pathname);
        if (!found) return { status: 404, body: {} };
        mergePatch(found, (body ?? {}) as Obj);
        return { status: 200, body: found };
      }
      const spec = JSON.parse(JSON.stringify(body ?? {})) as Obj;
      const name = String((spec.metadata as Obj | undefined)?.name ?? "");
      const target = `${pathname}/${name}`;
      if (objects.has(target)) return { status: 409, body: { message: "already exists" } };
      if (spec.kind === "Pod") spec.status = { phase: "Running" };
      objects.set(target, spec);
      return { status: 201, body: spec };
    },
    async exec() {
      return { stdout: Buffer.from("0123456789"), stderr: Buffer.from("abcdefghij"), exitCode: 3 };
    },
    async execStream(): Promise<Duplex> {
      throw new Error("execStream is not used in this fixture");
    },
    async metrics() {
      return null;
    },
  };
  objects.set("/api/v1/namespaces/sagax-sandboxes", { metadata: { name: "sagax-sandboxes" } });
  objects.set("/apis/storage.k8s.io/v1/storageclasses/encrypted", {
    metadata: { name: "encrypted", annotations: {} },
    parameters: { encrypted: "true" },
  });
  return { client, objects };
}

function harness(dir: string) {
  const auditFile = join(dir, "audit.jsonl");
  const processEnv = {
    SAGAX_SANDBOX_IMAGE: IMAGE,
    SAGAX_SANDBOX_K8S_STORAGE_CLASS: "encrypted",
    SAGAX_SANDBOX_K8S_REGISTRY: REGISTRY,
    SAGAX_SANDBOXD_TLS_INSECURE: "1",
    SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED: "true",
    SAGAX_SANDBOX_K8S_NETWORK_POLICY: "enforced",
    SAGAX_SANDBOX_AUDIT_LOG: auditFile,
  };
  const sandbox = sandboxdConfigFromEnv(processEnv);
  const { k8s } = kubernetesSandboxConfigFromEnv(processEnv, sandbox);
  const audit = createSandboxAudit({ file: auditFile });
  const cluster = memoryCluster();
  const api = kubernetesApi(sandbox, k8s, cluster.client, audit);
  const service = new SandboxService(api, sandbox);
  return { sandbox, k8s, audit, auditFile, api, service, objects: cluster.objects };
}

describe("kubernetes client auth", () => {
  it("uses ~/.kube/config when the kind flag is set and KUBECONFIG is unset", () => {
    expect(kubeconfigFileFromEnv({ SAGAX_SANDBOX_K8S_USE_KUBECONFIG: "1" }, "/home/me/.kube/config")).toBe("/home/me/.kube/config");
    expect(kubeconfigFileFromEnv({ SAGAX_SANDBOX_K8S_USE_KUBECONFIG: "1", KUBECONFIG: "/tmp/k" }, "/home/me/.kube/config")).toBe("/tmp/k");
    expect(kubeconfigFileFromEnv({
      SAGAX_SANDBOX_K8S_KUBECONFIG: "/tmp/explicit",
      SAGAX_SANDBOX_K8S_USE_KUBECONFIG: "1",
      KUBECONFIG: "/tmp/k",
    }, "/home/me/.kube/config")).toBe("/tmp/explicit");
    expect(kubeconfigFileFromEnv({}, "/home/me/.kube/config")).toBe("");
  });
});

describe("kubernetes sandbox lifecycle", () => {
  it("applies egress as a NetworkPolicy and never a privileged pod", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-"));
    const { service, objects } = harness(dir);
    expect(await service.installEgressPolicy()).toBe("enforced");
    const kinds = [...objects.values()].map((obj) => obj.kind);
    expect(kinds).toContain("NetworkPolicy");
    expect(kinds).not.toContain("Pod");
    expect(objects.has("/apis/networking.k8s.io/v1/namespaces/sagax-sandboxes/networkpolicies/sagax-default-deny")).toBe(true);
  });

  it("creates one pod and one claim, pauses without releasing the slot, then removes them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-"));
    const { service, objects, api, auditFile } = harness(dir);
    await service.installEgressPolicy();
    expect((await service.ensure(person)).state).toBe("running");
    const names = sandboxNames(person);
    const podPath = `/api/v1/namespaces/sagax-sandboxes/pods/${names.container}`;
    const claimPath = `/api/v1/namespaces/sagax-sandboxes/persistentvolumeclaims/${names.volume}`;
    expect(objects.has(podPath)).toBe(true);
    expect(objects.has(claimPath)).toBe(true);
    expect((await service.pause(person)).state).toBe("paused");
    expect(objects.has(podPath)).toBe(false);
    const paused = objects.get(claimPath)!;
    expect(((paused.metadata as Obj).annotations as Obj)[PAUSED_ANNOTATION]).toBe("true");
    const running = await api.listContainers({ [SANDBOX_LABEL]: "1", [SANDBOX_INSTANCE_LABEL]: "default" });
    expect(running.find((row) => row.name === names.container)?.running).toBe(true);
    expect((await service.resume(person)).state).toBe("running");
    expect(objects.has(podPath)).toBe(true);
    expect((await service.stop(person)).state).toBe("stopped");
    expect(objects.has(podPath)).toBe(false);
    expect(objects.has(claimPath)).toBe(true);
    expect((await service.remove(person)).state).toBe("missing");
    expect(objects.has(claimPath)).toBe(false);
    const lines = readFileSync(auditFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { action: string; detail?: { argv0?: string } });
    expect(lines.some((line) => line.action === "sandbox.pod.create")).toBe(true);
    expect(lines.some((line) => line.action === "sandbox.pvc.create")).toBe(true);
  });

  it("refuses a foreign pod, a bad image, an unencrypted class, and a one-shot container", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-"));
    const { service, objects, api, k8s, auditFile } = harness(dir);
    await service.installEgressPolicy();
    const names = sandboxNames(person);
    objects.set(`/api/v1/namespaces/sagax-sandboxes/pods/${names.container}`, {
      kind: "Pod",
      metadata: {
        name: names.container,
        labels: { [SANDBOX_LABEL]: "1", [SANDBOX_USER_LABEL]: "f".repeat(32), [SANDBOX_INSTANCE_LABEL]: "default" },
      },
      status: { phase: "Running" },
    });
    await expect(service.ensure(person)).rejects.toMatchObject({ status: 409, code: "conflict" });
    objects.delete(`/api/v1/namespaces/sagax-sandboxes/pods/${names.container}`);
    expect(await api.imageExists("sagax-sandbox:local")).toBe(false);
    const storage = objects.get(`/apis/storage.k8s.io/v1/storageclasses/${k8s.storageClass}`)!;
    storage.parameters = {};
    await expect(service.ensure(person)).rejects.toThrow(/encryption at rest/);
    await expect(api.runOnce("helper", { Labels: {}, HostConfig: { NetworkMode: "bridge", CapAdd: [] } }, 1000)).rejects.toThrow(/one-shot/);
    const audit = readFileSync(auditFile, "utf8");
    expect(audit).toContain("egress.helper");
    expect(audit).not.toContain("super-secret");
  });

  it("records exec as the program name and the exit code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-"));
    const { service, api, auditFile } = harness(dir);
    await service.installEgressPolicy();
    await service.ensure(person);
    const names = sandboxNames(person);
    const result = await api.exec(names.container, { Cmd: ["echo", "super-secret"], User: "1000:1000", Env: ["SAGAX_TOKEN=super-secret"], WorkingDir: "/workspace" }, 4);
    expect(result.truncated).toBe(true);
    expect(result.stdout.toString("utf8")).toBe("0123");
    expect(result.exitCode).toBe(3);
    const lines = readFileSync(auditFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { action: string; detail?: Record<string, unknown> });
    const exec = lines.find((line) => line.action === "sandbox.exec");
    expect(exec?.detail).toEqual({ argv0: "echo", exit: 3 });
    expect(readFileSync(auditFile, "utf8")).not.toContain("super-secret");
  });
});

describe("sandbox audit log", () => {
  it("appends, refuses to follow a link, and ships only over https", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-audit-"));
    const file = join(dir, "audit.jsonl");
    const first = createSandboxAudit({ file, now: () => new Date("2026-10-12T00:00:00.000Z") });
    first.record({ action: "provisioner.start", outcome: "ok" });
    const second = createSandboxAudit({ file, now: () => new Date("2026-10-12T00:00:01.000Z") });
    second.record({ action: "sandbox.pod.create", outcome: "ok", key: person });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).action).toBe("provisioner.start");
    expect(JSON.parse(lines[1]!).action).toBe("sandbox.pod.create");
    const link = join(dir, "linked.jsonl");
    symlinkSync(file, link);
    // O_NOFOLLOW does not exist on Windows; the provisioner that writes this log runs on Linux only
    if (process.platform !== "win32") expect(() => createSandboxAudit({ file: link })).toThrow();
    expect(() => createSandboxAudit({ file, shipUrl: "http://collector.example/in" })).toThrow(/https/);
    const posts: { url: string; body: string }[] = [];
    const shipped = createSandboxAudit({
      file: join(dir, "ship.jsonl"),
      shipUrl: "https://collector.example/ingest",
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        posts.push({ url: String(url), body: String(init?.body ?? "") });
        return new Response("ok");
      }) as typeof fetch,
    });
    shipped.record({ action: "sandbox.pod.start", outcome: "ok", key: person });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(posts[0]?.url).toBe("https://collector.example/ingest");
    expect(posts[0]?.body).toContain("sandbox.pod.start");
    expect(() => createSandboxAudit({ file, shipUrl: "https://user:pw@collector.example/in" })).toThrow(/credentials/);
  });
});

describe("provisioner https", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("reaches the provisioner when the caller presents the CA", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-tls-"));
    const cert = join(dir, "cert.pem");
    const keyFile = join(dir, "key.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyFile, "-out", cert, "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"]);
    const docker = new FakeDocker();
    const config = sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test" });
    const service = new SandboxService(docker, config);
    await service.installEgressPolicy();
    const server = createServer({ cert: readFileSync(cert), key: readFileSync(keyFile) }, createSandboxdHandler(service, new SandboxdVerifier(KEY)));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    const client = sandboxdClient(`https://127.0.0.1:${port}`, () => KEY, fetch, { ca: readFileSync(cert) });
    expect((await client.info()).egress).toBe("enforced");
  });
});
