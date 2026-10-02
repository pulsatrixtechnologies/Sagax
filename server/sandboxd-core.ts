// The provisioner's sandbox lifecycle, independent of HTTP and of a real
// Docker daemon (the DockerApi is injected). One sandbox per opaque person
// key: created on first need, started on demand, stopped after an idle
// period, removed on request. Every object it touches carries its labels and
// its deployment instance; anything else with a matching name is refused.
import type { Duplex } from "node:stream";

import type { DockerApi } from "./sandboxd-docker.ts";
import {
  SANDBOX_INSTANCE_LABEL,
  SANDBOX_KEY_RE,
  SANDBOX_LABEL,
  SANDBOX_UID,
  SANDBOX_USER_LABEL,
  SANDBOX_WORKSPACE,
  allocateSubnet,
  assertSandboxIsolation,
  cidrContains,
  egressHelperSpec,
  egressPolicyScript,
  sandboxContainerSpec,
  sandboxNames,
  sandboxNetworkSpec,
  sandboxVolumeSpec,
  type SandboxdConfig,
} from "./user-sandbox-spec.ts";

export type SandboxState = "missing" | "stopped" | "running" | "paused";
export type EgressPolicyState = "enforced" | "missing" | "not-required";

export interface SandboxStatus {
  key: string;
  state: SandboxState;
  lastUsedAt: number | null;
  workspaceBytes: number | null;
  overQuota: boolean;
  busy: number;
  limits: { memoryMb: number; cpus: number; pids: number; diskMb: number; tmpMb: number };
}

/** The usage panel of the person's Computer tab: a light sample, scoped to
 * that one sandbox. */
export interface SandboxStats {
  key: string;
  state: SandboxState;
  /** CPU in use as a percentage of the sandbox's own CPU quota. */
  cpuPercent: number | null;
  memoryBytes: number | null;
  memoryLimitBytes: number;
  workspaceBytes: number | null;
  workspaceQuotaBytes: number;
  /** e.g. "Debian GNU/Linux 12 (bookworm)", read inside the sandbox once. */
  os: string | null;
  arch: string | null;
  /** The image's name and tag, without the registry. */
  image: string;
}

export interface SandboxExecInput {
  argv: string[];
  env?: Record<string, string>;
  timeoutSec?: number;
  maxOutputBytes?: number;
}

export interface SandboxExecOutput {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
}

export class SandboxError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const EXEC_ENV_KEY_RE = /^SAGAX_[A-Z0-9_]{1,40}$/;
export const MAX_EXEC_TIMEOUT_SEC = 600;
export const DEFAULT_EXEC_TIMEOUT_SEC = 120;
export const MAX_EXEC_OUTPUT_BYTES = 1024 * 1024;
const MAX_EXEC_ENV_BYTES = 1_500_000;
const MAX_CONCURRENT_EXECS = 4;
const USAGE_TTL_MS = 60_000;
const CAPACITY_IDLE_GRACE_MS = 60_000;
/** Live views of one person's desktop open at once (windows, reconnects). */
export const MAX_DESKTOP_STREAMS = 4;
const CONTROL_TOUCH_MS = 30_000;

export class SandboxService {
  private readonly lastUsed = new Map<string, number>();
  private readonly busy = new Map<string, number>();
  private readonly usage = new Map<string, { bytes: number; at: number }>();
  private readonly locks = new Map<string, Promise<void>>();
  private readonly desktopStreams = new Map<string, number>();
  private readonly osInfo = new Map<string, { os: string; arch: string }>();
  egress: EgressPolicyState;

  private readonly docker: DockerApi;
  readonly config: SandboxdConfig;
  private readonly now: () => number;

  constructor(docker: DockerApi, config: SandboxdConfig, now: () => number = Date.now) {
    this.docker = docker;
    this.config = config;
    this.now = now;
    this.egress = config.requireEgressPolicy ? "missing" : "not-required";
  }

  private ownLabels(): Record<string, string> {
    return { [SANDBOX_LABEL]: "1", [SANDBOX_INSTANCE_LABEL]: this.config.instance };
  }

  private owned(labels: Record<string, string>, key: string): boolean {
    return labels[SANDBOX_LABEL] === "1" && labels[SANDBOX_INSTANCE_LABEL] === this.config.instance && labels[SANDBOX_USER_LABEL] === key;
  }

  private checkKey(key: string): void {
    if (!SANDBOX_KEY_RE.test(key)) throw new SandboxError(400, "bad_key", "invalid sandbox key");
  }

  private withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    const next = previous.then(work);
    // The chain itself never rejects: the caller gets `next`'s outcome.
    const settled: Promise<void> = next.then(() => {}, () => {}).finally(() => { if (this.locks.get(key) === settled) this.locks.delete(key); });
    this.locks.set(key, settled);
    return next;
  }

  /** Apply the host egress policy through the one-shot helper. */
  async installEgressPolicy(): Promise<EgressPolicyState> {
    try {
      const result = await this.docker.runOnce(
        `sagax-sandbox-egress-${this.config.instance}`,
        egressHelperSpec(this.config, egressPolicyScript(this.config)),
        60_000,
      );
      this.egress = result.exitCode === 0 && result.output.includes("sagax-egress-ok") ? "enforced"
        : this.config.requireEgressPolicy ? "missing" : "not-required";
      if (this.egress !== "enforced") console.error(`sandboxd: egress policy not applied (exit ${result.exitCode}): ${result.output.slice(0, 400)}`);
    } catch (error) {
      this.egress = this.config.requireEgressPolicy ? "missing" : "not-required";
      console.error(`sandboxd: egress policy helper failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return this.egress;
  }

  private limitsSummary(): SandboxStatus["limits"] {
    const { limits } = this.config;
    return {
      memoryMb: Math.round(limits.memoryBytes / 1048576),
      cpus: limits.nanoCpus / 1e9,
      pids: limits.pidsLimit,
      diskMb: Math.round(limits.workspaceQuotaBytes / 1048576),
      tmpMb: Math.round(limits.tmpBytes / 1048576),
    };
  }

  async status(key: string): Promise<SandboxStatus> {
    this.checkKey(key);
    const names = sandboxNames(key);
    const container = await this.docker.inspectContainer(names.container);
    if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
    const state: SandboxState = !container ? "missing" : container.paused ? "paused" : container.running ? "running" : "stopped";
    const usage = this.usage.get(key);
    return {
      key,
      state,
      lastUsedAt: this.lastUsed.get(key) ?? null,
      workspaceBytes: usage?.bytes ?? null,
      overQuota: usage ? usage.bytes > this.config.limits.workspaceQuotaBytes : false,
      busy: this.busy.get(key) ?? 0,
      limits: this.limitsSummary(),
    };
  }

  async list(): Promise<SandboxStatus[]> {
    const rows = await this.docker.listContainers(this.ownLabels());
    const keys = rows.map((row) => row.labels[SANDBOX_USER_LABEL]).filter((key): key is string => typeof key === "string" && SANDBOX_KEY_RE.test(key));
    return Promise.all(keys.map((key) => this.status(key)));
  }

  private async runningCount(): Promise<{ key: string; lastUsed: number }[]> {
    const rows = await this.docker.listContainers(this.ownLabels());
    return rows.filter((row) => row.running && SANDBOX_KEY_RE.test(row.labels[SANDBOX_USER_LABEL] ?? ""))
      .map((row) => {
        const key = row.labels[SANDBOX_USER_LABEL]!;
        return { key, lastUsed: this.lastUsed.get(key) ?? row.startedAt ?? 0 };
      });
  }

  /** Make room for one more running sandbox: stop the least recently used
   * one that is idle, or refuse with 429. */
  private async makeRoom(forKey: string): Promise<void> {
    const running = (await this.runningCount()).filter((row) => row.key !== forKey);
    if (running.length < this.config.maxRunning) return;
    const now = this.now();
    const victims = running
      .filter((row) => (this.busy.get(row.key) ?? 0) === 0 && now - row.lastUsed > CAPACITY_IDLE_GRACE_MS)
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const needed = running.length - this.config.maxRunning + 1;
    if (victims.length < needed) {
      throw new SandboxError(429, "capacity", "every server environment slot is in use; try again in a few minutes");
    }
    for (const victim of victims.slice(0, needed)) await this.docker.stopContainer(sandboxNames(victim.key).container, 5);
  }

  private async ensureNetwork(key: string): Promise<void> {
    const names = sandboxNames(key);
    const existing = await this.docker.inspectNetwork(names.network);
    if (existing) {
      if (!this.owned(existing.labels, key)) throw new SandboxError(409, "conflict", "a network with this name is not managed by this provisioner");
      if (!existing.subnets.every((subnet) => cidrContains(this.config.subnetPool, subnet))) {
        throw new SandboxError(409, "conflict", "the sandbox network is outside the egress-policed pool");
      }
      return;
    }
    const used = (await this.docker.listNetworks({ [SANDBOX_LABEL]: "1" })).flatMap((network) => network.subnets);
    const subnet = allocateSubnet(this.config.subnetPool, used);
    if (!subnet) throw new SandboxError(507, "pool_full", "the sandbox subnet pool is full");
    await this.docker.createNetwork(sandboxNetworkSpec(this.config, key, subnet));
  }

  private async ensureVolume(key: string): Promise<void> {
    const names = sandboxNames(key);
    const existing = await this.docker.inspectVolume(names.volume);
    if (existing) {
      if (!this.owned(existing.labels, key)) throw new SandboxError(409, "conflict", "a volume with this name is not managed by this provisioner");
      return;
    }
    await this.docker.createVolume(sandboxVolumeSpec(this.config, key));
  }

  /** Create on first need, start when stopped. Idempotent. */
  ensure(key: string): Promise<SandboxStatus> {
    this.checkKey(key);
    return this.withLock(key, async () => {
      if (this.egress === "missing") {
        throw new SandboxError(503, "egress_policy", "the host egress policy is not in place; server environments stay off until it is");
      }
      const names = sandboxNames(key);
      let container = await this.docker.inspectContainer(names.container);
      if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
      if (container?.paused) {
        throw new SandboxError(409, "paused", "the server environment is paused; its owner resumes it from the Computer tab");
      }
      if (container?.running) {
        this.touch(key);
        return this.status(key);
      }
      await this.makeRoom(key);
      if (!container) {
        if (!(await this.docker.imageExists(this.config.image))) {
          throw new SandboxError(503, "image_missing", "the server environment image is not on this host");
        }
        await this.ensureNetwork(key);
        await this.ensureVolume(key);
        const spec = sandboxContainerSpec(this.config, key);
        assertSandboxIsolation(spec, key);
        await this.docker.createContainer(names.container, spec);
        container = await this.docker.inspectContainer(names.container);
      }
      await this.docker.startContainer(names.container);
      this.touch(key);
      return this.status(key);
    });
  }

  stop(key: string): Promise<SandboxStatus> {
    this.checkKey(key);
    return this.withLock(key, async () => {
      const names = sandboxNames(key);
      const container = await this.docker.inspectContainer(names.container);
      if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
      if (container?.running) await this.docker.stopContainer(names.container, 5);
      return this.status(key);
    });
  }

  /** Remove the container and its network; the workspace volume too unless
   * `keepWorkspace`. Unknown keys succeed (nothing to remove). */
  remove(key: string, options: { keepWorkspace?: boolean } = {}): Promise<SandboxStatus> {
    this.checkKey(key);
    return this.withLock(key, async () => {
      const names = sandboxNames(key);
      const container = await this.docker.inspectContainer(names.container);
      if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
      if (container) await this.docker.removeContainer(names.container);
      const network = await this.docker.inspectNetwork(names.network);
      if (network && this.owned(network.labels, key)) await this.docker.removeNetwork(names.network);
      if (!options.keepWorkspace) {
        const volume = await this.docker.inspectVolume(names.volume);
        if (volume && this.owned(volume.labels, key)) await this.docker.removeVolume(names.volume);
        this.usage.delete(key);
      }
      this.lastUsed.delete(key);
      this.osInfo.delete(key);
      return this.status(key);
    });
  }

  private touch(key: string): void {
    this.lastUsed.set(key, this.now());
  }

  async exec(key: string, input: SandboxExecInput): Promise<SandboxExecOutput> {
    this.checkKey(key);
    if (!Array.isArray(input.argv) || input.argv.length === 0 || input.argv.length > 64 || input.argv.some((arg) => typeof arg !== "string" || arg.includes("\u0000"))) {
      throw new SandboxError(400, "bad_exec", "argv must be 1 to 64 strings");
    }
    const env = Object.entries(input.env ?? {});
    let envBytes = 0;
    for (const [name, value] of env) {
      if (!EXEC_ENV_KEY_RE.test(name) || typeof value !== "string" || value.includes("\u0000")) throw new SandboxError(400, "bad_exec", "env names must be SAGAX_*");
      envBytes += name.length + value.length;
    }
    if (envBytes > MAX_EXEC_ENV_BYTES) throw new SandboxError(413, "too_large", "the request is too large");
    const timeoutSec = Math.min(MAX_EXEC_TIMEOUT_SEC, Math.max(1, Math.floor(input.timeoutSec ?? DEFAULT_EXEC_TIMEOUT_SEC)));
    const maxOutput = Math.min(MAX_EXEC_OUTPUT_BYTES, Math.max(1024, Math.floor(input.maxOutputBytes ?? 256 * 1024)));
    if ((this.busy.get(key) ?? 0) >= MAX_CONCURRENT_EXECS) throw new SandboxError(429, "busy", "too many commands are running in this environment");
    await this.ensure(key);
    this.busy.set(key, (this.busy.get(key) ?? 0) + 1);
    try {
      const result = await this.docker.exec(sandboxNames(key).container, {
        Cmd: ["timeout", "-k", "2", String(timeoutSec), ...input.argv],
        User: `${SANDBOX_UID}:${SANDBOX_UID}`,
        Env: env.map(([name, value]) => `${name}=${value}`),
        WorkingDir: SANDBOX_WORKSPACE,
      }, maxOutput);
      return {
        exitCode: result.exitCode,
        stdout: result.stdout.toString("utf8"),
        stderr: result.stderr.toString("utf8"),
        truncated: result.truncated,
        timedOut: result.exitCode === 124 || result.exitCode === 137,
      };
    } finally {
      this.busy.set(key, Math.max(0, (this.busy.get(key) ?? 1) - 1));
      this.touch(key);
      void this.refreshUsage(key).catch(() => {});
    }
  }

  /** Freeze every process of the sandbox (docker pause): it keeps its
   * memory but uses no CPU, and bots are refused until it is resumed. */
  pause(key: string): Promise<SandboxStatus> {
    this.checkKey(key);
    return this.withLock(key, async () => {
      const names = sandboxNames(key);
      const container = await this.docker.inspectContainer(names.container);
      if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
      if (!container?.running) throw new SandboxError(409, "not_running", "the server environment is not running");
      if (!container.paused) await this.docker.pauseContainer(names.container);
      return this.status(key);
    });
  }

  resume(key: string): Promise<SandboxStatus> {
    this.checkKey(key);
    return this.withLock(key, async () => {
      const names = sandboxNames(key);
      const container = await this.docker.inspectContainer(names.container);
      if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
      if (container?.paused) await this.docker.unpauseContainer(names.container);
      this.touch(key);
      return this.status(key);
    });
  }

  /** CPU, memory, disk and OS of one sandbox. Starts nothing; a stopped or
   * paused sandbox answers without CPU and memory figures. */
  async stats(key: string): Promise<SandboxStats> {
    const status = await this.status(key);
    const names = sandboxNames(key);
    const { limits } = this.config;
    let cpuPercent: number | null = null;
    let memoryBytes: number | null = null;
    if (status.state === "running") {
      const sample = await this.docker.containerStats(names.container);
      cpuPercent = Math.round((sample.cpus / (limits.nanoCpus / 1e9)) * 1000) / 10;
      memoryBytes = sample.memoryBytes;
      if (!this.osInfo.has(key)) {
        const result = await this.docker.exec(names.container, {
          Cmd: ["sh", "-c", ". /etc/os-release 2>/dev/null; echo \"${PRETTY_NAME:-Linux}\"; uname -m"], User: `${SANDBOX_UID}:${SANDBOX_UID}`, Env: [], WorkingDir: "/",
        }, 4096).catch(() => null);
        const [os, arch] = (result?.stdout.toString("utf8") ?? "").trim().split("\n");
        if (os && arch) this.osInfo.set(key, { os: os.slice(0, 80), arch: arch.slice(0, 20) });
      }
      await this.refreshUsage(key).catch(() => null);
    }
    const usage = this.usage.get(key);
    return {
      key,
      state: status.state,
      cpuPercent,
      memoryBytes,
      memoryLimitBytes: limits.memoryBytes,
      workspaceBytes: usage?.bytes ?? null,
      workspaceQuotaBytes: limits.workspaceQuotaBytes,
      os: this.osInfo.get(key)?.os ?? null,
      arch: this.osInfo.get(key)?.arch ?? null,
      image: this.config.image.split("/").pop() ?? this.config.image,
    };
  }

  /** The live view: a byte stream to the desktop's VNC port, which listens
   * on 127.0.0.1 inside the sandbox only. Never starts anything: the
   * sandbox and its desktop must already run (the Sagax server starts them
   * through exec when the owner opens the view). A view in control counts
   * as use, so the sandbox does not idle out under the person's hands; a
   * view that only watches does not keep it alive. */
  async desktopStream(key: string, options: { control: boolean }): Promise<Duplex> {
    this.checkKey(key);
    const names = sandboxNames(key);
    const container = await this.docker.inspectContainer(names.container);
    if (container && !this.owned(container.labels, key)) throw new SandboxError(409, "conflict", "a container with this name is not managed by this provisioner");
    if (!container?.running) throw new SandboxError(409, "not_running", "the server environment is stopped");
    if (container.paused) throw new SandboxError(409, "paused", "the server environment is paused");
    const open = this.desktopStreams.get(key) ?? 0;
    if (open >= MAX_DESKTOP_STREAMS) throw new SandboxError(429, "busy", "too many live views of this desktop are open");
    this.desktopStreams.set(key, open + 1);
    let stream: Duplex;
    try {
      stream = await this.docker.execStream(names.container, {
        Cmd: ["sagax-desktop", "relay"], User: `${SANDBOX_UID}:${SANDBOX_UID}`, Env: [], WorkingDir: SANDBOX_WORKSPACE,
      });
    } catch (error) {
      this.releaseDesktopStream(key);
      throw error;
    }
    let released = false;
    const timer = options.control ? setInterval(() => this.touch(key), CONTROL_TOUCH_MS) : null;
    timer?.unref?.();
    if (options.control) this.touch(key);
    stream.once("close", () => {
      if (timer) clearInterval(timer);
      if (!released) { released = true; this.releaseDesktopStream(key); }
    });
    return stream;
  }

  private releaseDesktopStream(key: string): void {
    const left = (this.desktopStreams.get(key) ?? 1) - 1;
    if (left > 0) this.desktopStreams.set(key, left);
    else this.desktopStreams.delete(key);
  }

  /** Measure /workspace at most once a minute (soft quota). */
  async refreshUsage(key: string, force = false): Promise<number | null> {
    const cached = this.usage.get(key);
    if (!force && cached && this.now() - cached.at < USAGE_TTL_MS) return cached.bytes;
    const container = await this.docker.inspectContainer(sandboxNames(key).container);
    if (!container?.running || container.paused || !this.owned(container.labels, key)) return cached?.bytes ?? null;
    const result = await this.docker.exec(sandboxNames(key).container, {
      Cmd: ["du", "-sxb", SANDBOX_WORKSPACE], User: `${SANDBOX_UID}:${SANDBOX_UID}`, Env: [], WorkingDir: "/",
    }, 4096);
    const bytes = Number(/^(\d+)/.exec(result.stdout.toString("utf8"))?.[1]);
    if (!Number.isFinite(bytes)) return cached?.bytes ?? null;
    this.usage.set(key, { bytes, at: this.now() });
    return bytes;
  }

  /** Stop every running sandbox idle for longer than the idle period. A
   * sandbox first seen running (provisioner restart) counts from now. */
  async sweepIdle(): Promise<string[]> {
    const stopped: string[] = [];
    const now = this.now();
    for (const row of await this.runningCount()) {
      if (!this.lastUsed.has(row.key)) { this.lastUsed.set(row.key, now); continue; }
      if ((this.busy.get(row.key) ?? 0) > 0) continue;
      if (now - this.lastUsed.get(row.key)! < this.config.idleStopMs) continue;
      await this.withLock(row.key, () => this.docker.stopContainer(sandboxNames(row.key).container, 5));
      stopped.push(row.key);
    }
    return stopped;
  }
}
