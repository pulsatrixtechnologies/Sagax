// The Kubernetes cluster wake (0.5.3): a call routed to Kubernetes that finds
// the provisioner unreachable posts the start webhook once for the whole
// process, waits for GET /healthz, then runs. Docker is never touched, the
// URL never leaves the waker, and without the variable nothing changes.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONTROL_PLANE_ENV, stripControlPlaneEnv } from "./config.ts";
import {
  DEFAULT_WAKE_TIMEOUT_MS, POST_WINDOW_MS, SandboxClusterWaker, provisionerNotReached, provisionerUnreachable, sandboxWakeSettingsFromEnv,
} from "./sandbox-k8s-wake.ts";
import type { SandboxExecOutput, SandboxStatus } from "./sandboxd-core.ts";
import { SandboxdRequestError, sandboxdHealth, type SandboxdClient } from "./user-sandbox-client.ts";
import { UserSandboxManager, userSandboxSettingsFromEnv, type ClusterWaitEvent } from "./user-sandbox-manager.ts";

const ALICE = "pr_00000000-0000-4000-8000-00000000000a";
const SECRET_URL = "https://wake.example.invalid/webhooks?token=s3cr3t-T0KEN-value";
const SECRET_PARTS = ["s3cr3t-T0KEN-value", "wake.example.invalid", SECRET_URL];

function refused(): Error {
  return Object.assign(new Error("connect ECONNREFUSED 10.0.0.4:8791"), { code: "ECONNREFUSED" });
}

const RUNNING: SandboxStatus = { state: "running" } as unknown as SandboxStatus;
const EXEC_OK: SandboxExecOutput = { exitCode: 0, stdout: "ok", stderr: "" } as unknown as SandboxExecOutput;

/** A provisioner that refuses connections while `cluster.up` is false. */
function fakeProvisioner(cluster: { up: boolean }, calls: string[], name: string): SandboxdClient {
  const gate = async <T>(method: string, value: T): Promise<T> => {
    calls.push(`${name}:${method}`);
    if (!cluster.up) throw refused();
    return value;
  };
  return {
    info: () => gate("info", { instance: "default", egress: "enforced", maxRunning: 3, idleMinutes: 15 }),
    status: () => gate("status", RUNNING),
    ensure: () => gate("ensure", RUNNING),
    stop: () => gate("stop", RUNNING),
    pause: () => gate("pause", RUNNING),
    resume: () => gate("resume", RUNNING),
    markUsed: () => gate("markUsed", RUNNING),
    stats: () => gate("stats", {} as never),
    remove: () => gate("remove", RUNNING),
    exec: () => gate("exec", EXEC_OK),
    desktopStream: () => gate("desktopStream", {} as never),
    stdioStream: () => gate("stdioStream", {} as never),
  };
}

let dir: string;
let clock = 0;
let logs: string[];
let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sandbox-wake-"));
  clock = 1_000_000;
  logs = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
  warnSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

interface Rig {
  manager: UserSandboxManager;
  waker: SandboxClusterWaker;
  cluster: { up: boolean };
  calls: string[];
  posts: { url: string; method: string }[];
  probes: () => number;
  waits: ClusterWaitEvent[];
}

/** `upAfterProbes`: the cluster answers from that many health probes after the first webhook POST. */
function rig(options: { route?: "docker" | "kubernetes"; upAfterProbes?: number; timeoutMs?: number; webhook?: "ok" | "500" | "throw"; hold?: Promise<void> } = {}): Rig {
  const cluster = { up: false };
  const calls: string[] = [];
  const posts: { url: string; method: string }[] = [];
  let probes = 0;
  let probesAfterPost = 0;
  const waits: ClusterWaitEvent[] = [];
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    posts.push({ url: String(input), method: init?.method ?? "GET" });
    if (options.webhook === "throw") throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${SECRET_URL}`), { code: "ENOTFOUND" }) });
    return new Response("{}", { status: options.webhook === "500" ? 500 : 202 });
  }) as typeof fetch;
  const waker = new SandboxClusterWaker({
    settings: { url: new URL(SECRET_URL), timeoutMs: options.timeoutMs ?? DEFAULT_WAKE_TIMEOUT_MS },
    health: async () => {
      probes += 1;
      if (posts.length > 0) {
        probesAfterPost += 1;
        if (probesAfterPost >= (options.upAfterProbes ?? 3)) cluster.up = true;
      }
      return cluster.up;
    },
    fetchImpl,
    now: () => clock,
    sleep: async (ms) => { if (options.hold) await options.hold; clock += ms; },
  });
  const manager = new UserSandboxManager({
    client: fakeProvisioner({ up: true }, calls, "docker"),
    kubernetes: fakeProvisioner(cluster, calls, "kubernetes"),
    kubernetesWaker: waker,
    onClusterWait: (event) => waits.push(event),
    backendFor: () => options.route ?? "kubernetes",
    instance: "default",
    stateFile: join(dir, "deletions.json"),
    now: () => clock,
  });
  return { manager, waker, cluster, calls, posts, probes: () => probes, waits };
}

function expectNoSecret(texts: readonly string[]): void {
  for (const text of texts) for (const part of SECRET_PARTS) expect(text).not.toContain(part);
}

describe("sandboxWakeSettingsFromEnv", () => {
  it("is off without the variable, and defaults the timeout to 8 minutes", () => {
    expect(sandboxWakeSettingsFromEnv({})).toBeNull();
    expect(sandboxWakeSettingsFromEnv({ SAGAX_SANDBOX_K8S_WAKE_URL: "  " })).toBeNull();
    const settings = sandboxWakeSettingsFromEnv({ SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL });
    expect(settings?.timeoutMs).toBe(8 * 60_000);
    expect(sandboxWakeSettingsFromEnv({ SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL, SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS: "300000" })?.timeoutMs).toBe(300_000);
  });

  it("refuses http, credentials and a bad timeout without echoing the URL", () => {
    const bad = [
      { SAGAX_SANDBOX_K8S_WAKE_URL: "http://wake.example.invalid/webhooks?token=s3cr3t-T0KEN-value" },
      { SAGAX_SANDBOX_K8S_WAKE_URL: "https://user:s3cr3t-T0KEN-value@wake.example.invalid/" },
      { SAGAX_SANDBOX_K8S_WAKE_URL: "not a url s3cr3t-T0KEN-value" },
      { SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL, SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS: "1000" },
      { SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL, SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS: "3600000" },
      { SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL, SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS: "8m" },
    ];
    for (const env of bad) {
      let message = "";
      try { sandboxWakeSettingsFromEnv(env); } catch (error) { message = (error as Error).message; }
      expect(message).toMatch(/^SAGAX_SANDBOX_K8S_WAKE_(URL|TIMEOUT_MS) must be/);
      expectNoSecret([message]);
    }
  });

  it("is read only with a Kubernetes provisioner", () => {
    const base = { SAGAX_SANDBOXD_URL: "http://sagax-sandboxd:8791", SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL };
    expect(userSandboxSettingsFromEnv(base)?.wake).toBeNull();
    const withK8s = userSandboxSettingsFromEnv({ ...base, SAGAX_SANDBOXD_K8S_URL: "https://sagax-sandboxd-k8s:8791", SAGAX_SANDBOXD_TLS_CA: "/etc/ca.pem" });
    expect(withK8s?.wake?.url.href).toBe(SECRET_URL);
  });

  it("never reaches an engine's environment", () => {
    expect(CONTROL_PLANE_ENV).toContain("SAGAX_SANDBOX_K8S_WAKE_URL");
    const env: Record<string, string | undefined> = { SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL, PATH: "/bin" };
    stripControlPlaneEnv(env);
    expect(env).toEqual({ PATH: "/bin" });
  });
});

describe("provisionerUnreachable", () => {
  it("counts no answer and gateway errors, not a refusal from the provisioner", () => {
    expect(provisionerUnreachable(refused())).toBe(true);
    expect(provisionerUnreachable(new Error("the provisioner did not answer"))).toBe(true);
    expect(provisionerUnreachable(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }))).toBe(true);
    expect(provisionerUnreachable(new SandboxdRequestError(502, "error", "the provisioner answered 502"))).toBe(true);
    expect(provisionerUnreachable(new SandboxdRequestError(503, "error", "the provisioner answered 503"))).toBe(true);
    expect(provisionerUnreachable(new SandboxdRequestError(503, "egress_policy", "egress"))).toBe(false);
    expect(provisionerUnreachable(new SandboxdRequestError(404, "error", "not found"))).toBe(false);
    expect(provisionerNotReached(refused())).toBe(true);
    expect(provisionerNotReached(new SandboxdRequestError(503, "error", "x"))).toBe(true);
    expect(provisionerNotReached(new SandboxdRequestError(502, "error", "x"))).toBe(false);
    expect(provisionerNotReached(new Error("the provisioner did not answer"))).toBe(false);
  });
});

describe("the cluster wake", () => {
  it("wakes an unreachable provisioner, waits for /healthz, then runs the call", async () => {
    const r = rig({ upAfterProbes: 3 });
    const startedAt = clock;
    const result = await r.manager.exec(ALICE, { argv: ["true"] }, "bot1");
    expect(result.exitCode).toBe(0);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]!.method).toBe("POST");
    expect(r.calls).toEqual(["kubernetes:exec"]);
    expect(clock).toBeGreaterThan(startedAt);
    expect(r.waits).toEqual([{ principalId: ALICE, botId: "bot1", phase: "waiting" }]);
    // Healthy now: the next call goes straight through, no probe, no POST.
    const probes = r.probes();
    await r.manager.exec(ALICE, { argv: ["true"] }, "bot1");
    expect(r.probes()).toBe(probes);
    expect(r.posts).toHaveLength(1);
    expectNoSecret(logs);
  });

  it("posts once for many concurrent calls, which all wait on the same wake", async () => {
    const r = rig({ upAfterProbes: 4 });
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => r.manager.exec(ALICE, { argv: ["true"] }, `bot${index % 3}`)));
    expect(results.every((result) => result.exitCode === 0)).toBe(true);
    expect(r.posts).toHaveLength(1);
    expect(r.waker.posts).toBe(1);
    expect(r.waits.filter((event) => event.phase === "waiting")).toHaveLength(12);
    expect(r.calls.filter((call) => call === "kubernetes:exec")).toHaveLength(12);
  });

  it("gives up after the timeout with a clear error, no URL, and the turn can be sent again", async () => {
    const r = rig({ upAfterProbes: Number.POSITIVE_INFINITY, timeoutMs: 5 * 60_000 });
    const startedAt = clock;
    const error = await r.manager.exec(ALICE, { argv: ["true"] }, "bot1").then(() => { throw new Error("expected a timeout"); }, (caught: unknown) => caught as Error & { code?: string });
    expect(error).toMatchObject({ code: "cluster_start_timeout" });
    expect(error.message).toMatch(/did not start in time/);
    expect(clock - startedAt).toBeGreaterThanOrEqual(5 * 60_000);
    expect(clock - startedAt).toBeLessThan(5 * 60_000 + 30_000);
    expect(r.waits.map((event) => event.phase)).toEqual(["waiting", "timeout"]);
    // A successful POST is not repeated during the same wake.
    expect(r.posts).toHaveLength(1);
    expect(r.calls).toEqual([]);
    expectNoSecret([error.message, String(error.stack), JSON.stringify(error), ...logs]);
    // Sent again later: a new wake, a new POST (the window has passed), and it runs.
    r.cluster.up = true;
    const again = await r.manager.exec(ALICE, { argv: ["true"] }, "bot1");
    expect(again.exitCode).toBe(0);
  });

  it("never posts more than once per window, even when a wake times out and another starts", async () => {
    const r = rig({ upAfterProbes: Number.POSITIVE_INFINITY, timeoutMs: 30_000 });
    await expect(r.manager.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "cluster_start_timeout" });
    await expect(r.manager.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "cluster_start_timeout" });
    expect(r.posts).toHaveLength(1);
    clock += POST_WINDOW_MS;
    await expect(r.manager.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "cluster_start_timeout" });
    expect(r.posts).toHaveLength(2);
  });

  it("retries a failed webhook only once per window, and logs no part of the URL", async () => {
    const r = rig({ upAfterProbes: Number.POSITIVE_INFINITY, timeoutMs: 5 * 60_000, webhook: "throw" });
    const error = await r.manager.exec(ALICE, { argv: ["true"] }).then(() => { throw new Error("expected a timeout"); }, (caught: unknown) => caught as Error);
    expect(r.posts.length).toBeGreaterThanOrEqual(2);
    expect(r.posts.length).toBeLessThanOrEqual(3);
    expect(logs.some((line) => line.includes("start webhook unreachable (ENOTFOUND)"))).toBe(true);
    expectNoSecret([error.message, ...logs]);
  });

  it("a status read never starts the cluster: the environment reads stopped", async () => {
    const r = rig();
    const view = await r.manager.status(ALICE, "bot1");
    expect(view).toMatchObject({ state: "stopped", error: "cluster_stopped" });
    expect(await r.manager.workspaceOverQuota(ALICE, "bot1")).toBe(false);
    expect(await r.manager.markUsed(ALICE, "bot1")).toBe(false);
    expect(r.posts).toHaveLength(0);
    expect(r.calls).toEqual([]);
    expect(r.waits).toEqual([]);
  });

  it("a status read during a wake answers at once that the environment is starting", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const r = rig({ upAfterProbes: 3, hold });
    const waking = r.manager.exec(ALICE, { argv: ["true"] });
    await vi.waitFor(() => expect(r.waker.starting).toBe(true));
    expect(await r.manager.status(ALICE)).toMatchObject({ state: "unavailable", error: "cluster_starting" });
    release();
    await waking;
    expect(r.posts).toHaveLength(1);
  });

  it("Start in the Computer tab wakes it", async () => {
    const r = rig({ upAfterProbes: 2 });
    const view = await r.manager.power(ALICE, "start");
    expect(view.state).toBe("running");
    expect(r.posts).toHaveLength(1);
  });

  it("sends a call refused before it reached the provisioner once more after the wake", async () => {
    const r = rig({ upAfterProbes: 2 });
    r.cluster.up = true;
    await r.manager.exec(ALICE, { argv: ["true"] });
    // The cluster stops behind a provisioner seen healthy a moment ago.
    r.cluster.up = false;
    const result = await r.manager.exec(ALICE, { argv: ["true"] });
    expect(result.exitCode).toBe(0);
    expect(r.posts).toHaveLength(1);
    expect(r.calls).toEqual(["kubernetes:exec", "kubernetes:exec", "kubernetes:exec"]);
  });

  it("never touches the Docker route", async () => {
    const r = rig({ route: "docker" });
    await r.manager.exec(ALICE, { argv: ["true"] });
    await r.manager.status(ALICE);
    await r.manager.power(ALICE, "start");
    expect(r.calls.every((call) => call.startsWith("docker:"))).toBe(true);
    expect(r.posts).toHaveLength(0);
    expect(r.probes()).toBe(0);
    expect(r.waits).toEqual([]);
  });

  it("without the variable, an unreachable provisioner fails the call as before", async () => {
    const calls: string[] = [];
    const manager = new UserSandboxManager({
      client: fakeProvisioner({ up: true }, calls, "docker"),
      kubernetes: fakeProvisioner({ up: false }, calls, "kubernetes"),
      backendFor: () => "kubernetes",
      instance: "default",
      stateFile: join(dir, "deletions.json"),
    });
    await expect(manager.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "unreachable" });
    expect((await manager.status(ALICE)).state).toBe("unavailable");
    expect(calls).toEqual(["kubernetes:exec", "kubernetes:status", "kubernetes:info"]);
  });
});

describe("sandboxdHealth", () => {
  it("is true on 200 from /healthz and false when nothing answers", async () => {
    const server = createServer((req, res) => {
      res.writeHead(req.url === "/healthz" ? 200 : 404);
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      expect(await sandboxdHealth(`http://127.0.0.1:${port}`)(2_000)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await sandboxdHealth(`http://127.0.0.1:${port}`)(2_000)).toBe(false);
  });
});
