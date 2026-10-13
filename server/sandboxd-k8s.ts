// Kubernetes backend for sagax-sandboxd. It speaks the same DockerApi the
// lifecycle already uses, so SANDBOX_BACKEND=docker is untouched. One Pod
// and one PVC per person, in a dedicated namespace. Egress is a NetworkPolicy
// (public IPv4 only). Pause keeps the PVC and the capacity slot; the Pod is
// deleted, so unlike `docker pause` the memory is released.
import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { accessSync, constants as fsConstants, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Duplex } from "node:stream";

import { createSandboxAudit, type SandboxAudit } from "./sandbox-audit.ts";
import { ensureSandboxdKey, SandboxdVerifier } from "./sandboxd-auth.ts";
import type { K8sClient } from "./sandboxd-k8s-client.ts";
import {
  IMAGE_ANNOTATION,
  PAUSED_ANNOTATION,
  SANDBOX_DEFAULT_DENY_NAME,
  SUBNET_ANNOTATION,
  defaultDenyNetworkPolicy,
  imageAdmissionProblems,
  k8sLabels,
  kubernetesReadinessProblems,
  kubernetesSandboxConfigFromEnv,
  podFromDockerSpec,
  podIsolationProblems,
  pvcSpec,
  sandboxKeyFromContainerName,
  sandboxNetworkPolicy,
  storageClassEncrypts,
  type K8sGuards,
  type K8sSandboxConfig,
} from "./sandboxd-k8s-spec.ts";
import { SandboxService } from "./sandboxd-core.ts";
import type { ContainerStats, ContainerSummary, DockerApi, ExecRequest, ExecResult } from "./sandboxd-docker.ts";
import { createSandboxdHandler, createSandboxdUpgradeHandler } from "./sandboxd.ts";
import {
  SANDBOX_KEY_RE,
  SANDBOX_LABEL,
  SANDBOX_USER_LABEL,
  sandboxContainerSpec,
  sandboxNames,
  sandboxdConfigFromEnv,
  type SandboxdConfig,
} from "./user-sandbox-spec.ts";

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj {
  return value && typeof value === "object" ? value as Obj : {};
}

function metaOf(body: Obj): { name: string; labels: Record<string, string>; annotations: Record<string, string> } {
  const metadata = asObj(body.metadata);
  return {
    name: String(metadata.name ?? ""),
    labels: { ...(asObj(metadata.labels) as Record<string, string>) },
    annotations: { ...(asObj(metadata.annotations) as Record<string, string>) },
  };
}

function waitingReason(pod: Obj): string {
  const statuses = (asObj(pod.status).containerStatuses ?? []) as Obj[];
  const waiting = asObj(asObj(statuses[0]?.state).waiting);
  return String(waiting.reason ?? "");
}

const READY_TIMEOUT_MS = 90_000;

export interface KubernetesApiOptions {
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** DockerApi backed by the Kubernetes API. */
export function kubernetesApi(sandbox: SandboxdConfig, k8s: K8sSandboxConfig, client: K8sClient, audit: SandboxAudit, options: KubernetesApiOptions = {}): DockerApi {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); }));
  const now = options.now ?? Date.now;
  const ns = k8s.namespace;
  let encryptionOk: boolean | null = null;

  const podPath = (name: string) => `/api/v1/namespaces/${ns}/pods/${name}`;
  const pvcPath = (name: string) => `/api/v1/namespaces/${ns}/persistentvolumeclaims/${name}`;
  const netPath = (name: string) => `/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies/${name}`;

  async function read(path: string): Promise<Obj | null> {
    const response = await client.request("GET", path);
    if (response.status === 404) return null;
    if (response.status !== 200) throw new Error(`kubernetes GET failed (${response.status})`);
    return asObj(response.body);
  }

  async function create(path: string, body: Obj): Promise<void> {
    const response = await client.request("POST", path, body);
    if (response.status === 200 || response.status === 201 || response.status === 202) return;
    if (response.status === 409) {
      const name = metaOf(body).name;
      const existing = await read(`${path}/${name}`);
      const wanted = metaOf(body).labels[SANDBOX_USER_LABEL];
      const got = existing ? metaOf(existing).labels[SANDBOX_USER_LABEL] : undefined;
      if (existing && wanted && got === wanted) return;
    }
    const message = String(asObj(response.body).message ?? "");
    throw new Error(`kubernetes create failed (${response.status}) ${message}`.trim());
  }

  async function remove(path: string): Promise<void> {
    // The default 30s grace leaves a deleted Pod phase Running, so a pause
    // would still read as running. Zero grace, then wait until the object
    // is gone. The workspace is the claim, which this does not delete.
    const response = await client.request("DELETE", `${path}?gracePeriodSeconds=0`);
    if (response.status !== 200 && response.status !== 202 && response.status !== 404) {
      throw new Error(`kubernetes delete failed (${response.status})`);
    }
    const deadline = now() + 20_000;
    for (;;) {
      if (!(await read(path))) return;
      if (now() > deadline) throw new Error("kubernetes delete did not finish");
      await sleep(200);
    }
  }

  async function merge(path: string, patch: Obj): Promise<void> {
    const response = await client.request("PATCH", path, patch, "application/merge-patch+json");
    if (response.status !== 200 && response.status !== 201) throw new Error(`kubernetes patch failed (${response.status})`);
  }

  function summaryFrom(name: string, labels: Record<string, string>, annotations: Record<string, string>, phase: string | null, pausedFlag: boolean): ContainerSummary {
    const running = phase === "Running";
    const paused = pausedFlag && !running;
    const image = annotations[IMAGE_ANNOTATION];
    return {
      name,
      running: running || paused,
      ...(paused ? { paused: true } : {}),
      labels,
      ...(image ? { image } : {}),
    };
  }

  async function podAndPvc(containerName: string): Promise<{ pod: Obj | null; pvc: Obj | null; key: string }> {
    const key = sandboxKeyFromContainerName(containerName);
    const names = sandboxNames(key);
    const [pod, pvc] = await Promise.all([read(podPath(names.container)), read(pvcPath(names.volume))]);
    return { pod, pvc, key };
  }

  function toSummary(containerName: string, pod: Obj | null, pvc: Obj | null): ContainerSummary | null {
    if (pod) {
      const meta = metaOf(pod);
      const pausedFlag = metaOf(pvc ?? {}).annotations[PAUSED_ANNOTATION] === "true";
      const annotations = { ...metaOf(pvc ?? {}).annotations, ...meta.annotations };
      return summaryFrom(containerName, meta.labels, annotations, String(asObj(pod.status).phase ?? ""), pausedFlag);
    }
    if (!pvc) return null;
    const meta = metaOf(pvc);
    return summaryFrom(containerName, meta.labels, meta.annotations, null, meta.annotations[PAUSED_ANNOTATION] === "true");
  }

  async function listCollection(path: string, labels: Record<string, string>): Promise<Obj[]> {
    const selector = encodeURIComponent(Object.entries(labels).map(([key, value]) => `${key}=${value}`).join(","));
    const response = await client.request("GET", `${path}?labelSelector=${selector}`);
    if (response.status !== 200) throw new Error(`kubernetes list failed (${response.status})`);
    const items = (asObj(response.body).items ?? []) as Obj[];
    return items;
  }

  function podBody(key: string): Obj {
    const spec = sandboxContainerSpec(sandbox, key);
    const pod = podFromDockerSpec(spec, k8s);
    const problems = podIsolationProblems(pod, key);
    if (problems.length) throw new Error(`sandbox spec refused: ${problems.join(", ")}`);
    const image = String(spec.Image ?? "");
    const imageProblems = imageAdmissionProblems(image, { registry: k8s.registry, requireDigest: k8s.requireDigest });
    if (imageProblems.length) {
      audit.record({ action: "image.admit", outcome: "denied", key, detail: { problems: imageProblems.length } });
      throw new Error(`image refused: ${imageProblems.join(", ")}`);
    }
    return pod;
  }

  async function createPod(key: string): Promise<void> {
    await create(`/api/v1/namespaces/${ns}/pods`, podBody(key));
    audit.record({ action: "sandbox.pod.create", outcome: "ok", key });
  }

  async function waitRunning(key: string): Promise<void> {
    const names = sandboxNames(key);
    const deadline = now() + READY_TIMEOUT_MS;
    for (;;) {
      let pod = await read(podPath(names.container));
      if (!pod) {
        await createPod(key);
        pod = await read(podPath(names.container));
      }
      const phase = String(asObj(pod?.status).phase ?? "");
      if (phase === "Running") return;
      const reason = pod ? waitingReason(pod) : "";
      if (reason === "ImagePullBackOff" || reason === "ErrImagePull") {
        throw new Error(`the server environment image is not available (${reason})`);
      }
      if (phase === "Failed" || phase === "Succeeded") await remove(podPath(names.container));
      if (now() > deadline) throw new Error("the sandbox pod did not become ready");
      await sleep(500);
    }
  }

  async function ensureEncrypted(): Promise<void> {
    if (!k8s.requireEncryption) return;
    if (encryptionOk) return;
    const storageClass = await read(`/apis/storage.k8s.io/v1/storageclasses/${k8s.storageClass}`);
    const encrypts = storageClass ? storageClassEncrypts({
      parameters: asObj(storageClass.parameters) as Record<string, string>,
      annotations: metaOf(storageClass).annotations,
    }) : false;
    if (!storageClass || !encrypts) {
      audit.record({ action: "storage.encrypt", outcome: "denied", detail: { storageClass: k8s.storageClass } });
      throw new Error("storage class does not advertise encryption at rest");
    }
    encryptionOk = true;
  }

  async function ensureDefaultDeny(): Promise<void> {
    const existing = await read(netPath(SANDBOX_DEFAULT_DENY_NAME));
    if (existing) return;
    await create(`/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies`, defaultDenyNetworkPolicy(ns, sandbox.instance));
  }

  function emit(action: string, key: string): void {
    audit.record({ action, outcome: "ok", key });
    void client.request("POST", `/api/v1/namespaces/${ns}/events`, {
      apiVersion: "v1",
      kind: "Event",
      metadata: { name: `sagax-${key.slice(0, 8)}-${Date.now().toString(36)}`, namespace: ns },
      involvedObject: { kind: "Pod", namespace: ns, name: sandboxNames(key).container },
      reason: action,
      message: action,
      type: "Normal",
      source: { component: "sagax-sandboxd" },
      firstTimestamp: new Date(now()).toISOString(),
    }).catch(() => {});
  }

  const api: DockerApi = {
    async ping() {
      const response = await client.request("GET", `/api/v1/namespaces/${ns}`);
      return response.status === 200;
    },
    async imageExists(image: string) {
      const problems = imageAdmissionProblems(image, { registry: k8s.registry, requireDigest: k8s.requireDigest });
      if (problems.length) audit.record({ action: "image.admit", outcome: "denied", detail: { problems: problems.length } });
      return problems.length === 0;
    },
    async inspectContainer(name: string) {
      try {
        const { pod, pvc } = await podAndPvc(name);
        return toSummary(name, pod, pvc);
      } catch {
        return null;
      }
    },
    async listContainers(labels: Record<string, string>) {
      const pods = await listCollection(`/api/v1/namespaces/${ns}/pods`, labels);
      const byName = new Map<string, ContainerSummary>();
      for (const pod of pods) {
        const key = metaOf(pod).labels[SANDBOX_USER_LABEL] ?? "";
        if (!SANDBOX_KEY_RE.test(key)) continue;
        const name = sandboxNames(key).container;
        const summary = toSummary(name, pod, null);
        if (summary) byName.set(name, summary);
      }
      const claims = await listCollection(`/api/v1/namespaces/${ns}/persistentvolumeclaims`, labels);
      for (const claim of claims) {
        const key = metaOf(claim).labels[SANDBOX_USER_LABEL] ?? "";
        if (!SANDBOX_KEY_RE.test(key)) continue;
        const name = sandboxNames(key).container;
        if (byName.has(name)) {
          const paused = metaOf(claim).annotations[PAUSED_ANNOTATION] === "true";
          if (paused && byName.get(name)?.running !== true) byName.set(name, toSummary(name, null, claim)!);
          continue;
        }
        const summary = toSummary(name, null, claim);
        if (summary) byName.set(name, summary);
      }
      return [...byName.values()];
    },
    async createContainer(name: string, spec: Record<string, unknown>) {
      const key = sandboxKeyFromContainerName(name);
      const image = String(spec.Image ?? "");
      const imageProblems = imageAdmissionProblems(image, { registry: k8s.registry, requireDigest: k8s.requireDigest });
      if (imageProblems.length) {
        audit.record({ action: "image.admit", outcome: "denied", key, detail: { problems: imageProblems.length } });
        throw new Error(`image refused: ${imageProblems.join(", ")}`);
      }
      const pod = podFromDockerSpec(spec, k8s);
      const problems = podIsolationProblems(pod, key);
      if (problems.length) throw new Error(`sandbox spec refused: ${problems.join(", ")}`);
      await create(`/api/v1/namespaces/${ns}/pods`, pod);
      audit.record({ action: "sandbox.pod.create", outcome: "ok", key });
    },
    async startContainer(name: string) {
      const key = sandboxKeyFromContainerName(name);
      const names = sandboxNames(key);
      const claim = await read(pvcPath(names.volume));
      if (claim && metaOf(claim).annotations[PAUSED_ANNOTATION] === "true") throw new Error("the sandbox is paused");
      await waitRunning(key);
      emit("sandbox.pod.start", key);
    },
    async stopContainer(name: string) {
      const key = sandboxKeyFromContainerName(name);
      const names = sandboxNames(key);
      if (await read(pvcPath(names.volume))) {
        await merge(pvcPath(names.volume), { metadata: { annotations: { [PAUSED_ANNOTATION]: null } } });
      }
      await remove(podPath(names.container));
      emit("sandbox.pod.stop", key);
    },
    async pauseContainer(name: string) {
      const key = sandboxKeyFromContainerName(name);
      const names = sandboxNames(key);
      await merge(pvcPath(names.volume), { metadata: { annotations: { [PAUSED_ANNOTATION]: "true" } } });
      await remove(podPath(names.container));
      emit("sandbox.pod.pause", key);
    },
    async unpauseContainer(name: string) {
      const key = sandboxKeyFromContainerName(name);
      const names = sandboxNames(key);
      await merge(pvcPath(names.volume), { metadata: { annotations: { [PAUSED_ANNOTATION]: null } } });
      await waitRunning(key);
      emit("sandbox.pod.resume", key);
    },
    async containerStats(name: string): Promise<ContainerStats> {
      const limit = sandbox.limits.memoryBytes;
      const metrics = await client.metrics(ns, name).catch(() => null);
      if (!metrics) return { cpus: 0, memoryBytes: 0, memoryLimitBytes: limit };
      return { cpus: metrics.cpu, memoryBytes: metrics.memoryBytes, memoryLimitBytes: limit };
    },
    async removeContainer(name: string) {
      const key = sandboxKeyFromContainerName(name);
      await remove(podPath(name));
      emit("sandbox.pod.delete", key);
    },
    async inspectNetwork(name: string) {
      const policy = await read(netPath(name));
      if (!policy) return null;
      const meta = metaOf(policy);
      const subnet = meta.annotations[SUBNET_ANNOTATION];
      return { labels: meta.labels, subnets: subnet ? [subnet] : [] };
    },
    async listNetworks(labels: Record<string, string>) {
      const policies = await listCollection(`/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies`, labels);
      return policies.map((policy) => {
        const meta = metaOf(policy);
        const subnet = meta.annotations[SUBNET_ANNOTATION];
        return { name: meta.name, subnets: subnet ? [subnet] : [] };
      });
    },
    async createNetwork(spec: Record<string, unknown>) {
      const labels = asObj(spec.Labels) as Record<string, string>;
      const key = labels[SANDBOX_USER_LABEL] ?? "";
      const ipam = asObj(spec.IPAM);
      const configs = (ipam.Config ?? []) as { Subnet?: string }[];
      const subnet = configs[0]?.Subnet ?? "";
      if (!SANDBOX_KEY_RE.test(key) || !subnet) throw new Error("sandbox network is missing its key or subnet");
      await create(`/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies`, sandboxNetworkPolicy(k8s, key, subnet, sandbox.egressDeny, labels));
      audit.record({ action: "sandbox.net.create", outcome: "ok", key });
    },
    async removeNetwork(name: string) {
      await remove(netPath(name));
    },
    async inspectVolume(name: string) {
      const claim = await read(pvcPath(name));
      if (!claim) return null;
      return { labels: metaOf(claim).labels };
    },
    async createVolume(spec: Record<string, unknown>) {
      const labels = asObj(spec.Labels) as Record<string, string>;
      const key = labels[SANDBOX_USER_LABEL] ?? "";
      if (!SANDBOX_KEY_RE.test(key)) throw new Error("sandbox volume is missing its person key");
      await ensureEncrypted();
      const owned = k8sLabels(sandbox, key);
      await create(`/api/v1/namespaces/${ns}/persistentvolumeclaims`, pvcSpec(k8s, key, sandbox.limits.workspaceQuotaBytes, sandbox.image, owned));
      audit.record({ action: "sandbox.pvc.create", outcome: "ok", key });
    },
    async removeVolume(name: string) {
      await remove(pvcPath(name));
    },
    async exec(name: string, request: ExecRequest, maxBytes: number): Promise<ExecResult> {
      const result = await client.exec(ns, name, request.Cmd);
      let stdout = result.stdout;
      let stderr = result.stderr;
      let truncated = false;
      if (stdout.length > maxBytes) { truncated = true; stdout = stdout.subarray(0, maxBytes); }
      if (stderr.length > maxBytes) { truncated = true; stderr = stderr.subarray(0, maxBytes); }
      let key = "";
      try { key = sandboxKeyFromContainerName(name); } catch { /* name already checked by the caller */ }
      audit.record({ action: "sandbox.exec", outcome: "ok", ...(key ? { key } : {}), detail: { argv0: request.Cmd[0] ?? "", exit: result.exitCode ?? -1 } });
      return { exitCode: result.exitCode, stdout, stderr, truncated };
    },
    async execStream(name: string, request: ExecRequest): Promise<Duplex> {
      return client.execStream(ns, name, request.Cmd);
    },
    async runOnce(name: string, spec: Record<string, unknown>) {
      const labels = asObj(spec.Labels) as Record<string, string>;
      const host = asObj(spec.HostConfig);
      const capAdd = Array.isArray(host.CapAdd) ? host.CapAdd.map(String) : [];
      const helper = labels[SANDBOX_LABEL] === "egress-helper" && host.NetworkMode === "host" && capAdd.includes("NET_ADMIN");
      if (!helper) {
        audit.record({ action: "egress.helper", outcome: "denied", detail: { name } });
        throw new Error("kubernetes backend refuses one-shot containers");
      }
      await ensureDefaultDeny();
      audit.record({ action: "egress.policy.apply", outcome: "ok", detail: { instance: sandbox.instance } });
      return { exitCode: 0, output: "sagax-egress-ok\n" };
    },
  };
  return api;
}

async function collectReadiness(client: K8sClient, k8s: K8sSandboxConfig, guards: K8sGuards, sandbox: SandboxdConfig, auditWritable: boolean): Promise<string[]> {
  const namespace = await client.request("GET", `/api/v1/namespaces/${k8s.namespace}`);
  const storage = await client.request("GET", `/apis/storage.k8s.io/v1/storageclasses/${k8s.storageClass}`);
  const storageBody = asObj(storage.body);
  const quota = await client.request("GET", `/api/v1/namespaces/${k8s.namespace}/resourcequotas/${k8s.quotaName}`);
  const hard = asObj(asObj(asObj(quota.body).status).hard) as Record<string, string>;
  const specHard = asObj(asObj(asObj(quota.body).spec).hard) as Record<string, string>;
  const tlsReady = guards.tlsInsecure || Boolean(guards.tlsCertPath && guards.tlsKeyPath);
  return kubernetesReadinessProblems({
    namespaceExists: namespace.status === 200,
    storageClassFound: storage.status === 200,
    storageEncrypts: storage.status === 200 && storageClassEncrypts({
      parameters: asObj(storageBody.parameters) as Record<string, string>,
      annotations: metaOf(storageBody).annotations,
    }),
    requireEncryption: k8s.requireEncryption,
    quotaHard: quota.status === 200 ? { ...specHard, ...hard } : null,
    imageProblems: imageAdmissionProblems(sandbox.image, { registry: k8s.registry, requireDigest: k8s.requireDigest }),
    secretsEncryptedAttested: guards.secretsEncryptedAttested,
    networkPolicyAttested: guards.networkPolicyAttested,
    tlsReady,
    auditWritable,
  });
}

function fileReadable(path: string | undefined): boolean {
  if (!path) return false;
  try { accessSync(path, fsConstants.R_OK); return true; } catch { return false; }
}

/** Serve the provisioner against the Kubernetes API. Docker is not contacted. */
export async function startKubernetesProvisioner(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const sandbox = sandboxdConfigFromEnv(env);
  const { k8s, guards } = kubernetesSandboxConfigFromEnv(env, sandbox);
  let auditWritable = false;
  try { accessSync(dirname(guards.auditFile), fsConstants.W_OK); auditWritable = true; } catch { auditWritable = false; }
  if (!auditWritable) throw new Error(`sandboxd: audit directory is not writable: ${dirname(guards.auditFile)}`);
  const audit = createSandboxAudit({ file: guards.auditFile, ...(guards.auditShipUrl ? { shipUrl: guards.auditShipUrl } : {}) });
  if (!guards.tlsInsecure && (!fileReadable(guards.tlsCertPath) || !fileReadable(guards.tlsKeyPath))) {
    audit.record({ action: "provisioner.start", outcome: "denied", detail: { reason: "tls" } });
    throw new Error("sandboxd: TLS certificate or key is not readable");
  }
  const { kubernetesClientFromEnv } = await import("./sandboxd-k8s-client.ts");
  const client = kubernetesClientFromEnv(env);
  const problems = await collectReadiness(client, k8s, guards, sandbox, true);
  if (problems.length) {
    audit.record({ action: "provisioner.start", outcome: "denied", detail: { problems: problems.length } });
    throw new Error(`sandboxd: kubernetes backend is not ready: ${problems.join("; ")}`);
  }
  audit.record({
    action: "provisioner.start",
    outcome: "ok",
    detail: { namespace: k8s.namespace, tls: guards.tlsInsecure ? "off" : "on", secretsEncrypted: true, networkPolicy: true },
  });
  const backend = kubernetesApi(sandbox, k8s, client, audit);
  if (process.argv.includes("--uninstall-egress")) {
    const response = await client.request("DELETE", `/apis/networking.k8s.io/v1/namespaces/${k8s.namespace}/networkpolicies/${SANDBOX_DEFAULT_DENY_NAME}`);
    if (response.status !== 200 && response.status !== 202 && response.status !== 404) {
      throw new Error(`sandboxd: could not remove the egress policy (${response.status})`);
    }
    audit.record({ action: "egress.policy.remove", outcome: "ok" });
    process.stdout.write("sagax-egress-removed\n");
    return;
  }
  if (!(await backend.ping())) throw new Error(`sandboxd: kubernetes namespace ${k8s.namespace} is not reachable`);
  const key = ensureSandboxdKey(sandbox.keyFile);
  const service = new SandboxService(backend, sandbox);
  const egress = await service.installEgressPolicy();
  console.log(`sandboxd: kubernetes backend, namespace ${k8s.namespace}, instance ${sandbox.instance}, egress policy ${egress}, at most ${sandbox.maxRunning} running, idle stop ${sandbox.idleStopMs / 60_000} min`);
  const verifier = new SandboxdVerifier(key);
  const handler = createSandboxdHandler(service, verifier);
  const server = guards.tlsInsecure
    ? createServer(handler)
    : createHttpsServer({ cert: readFileSync(guards.tlsCertPath!), key: readFileSync(guards.tlsKeyPath!) }, handler);
  server.on("upgrade", createSandboxdUpgradeHandler(service, verifier));
  server.requestTimeout = 16 * 60_000;
  server.listen(sandbox.listenPort, sandbox.listenHost);
  const sweep = setInterval(() => {
    void service.sweepIdle().then((stopped) => {
      if (stopped.length) console.log(`sandboxd: stopped ${stopped.length} idle environment(s)`);
    }, (error: unknown) => console.error(`sandboxd: idle sweep failed: ${error instanceof Error ? error.message : String(error)}`));
  }, 60_000);
  sweep.unref();
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
