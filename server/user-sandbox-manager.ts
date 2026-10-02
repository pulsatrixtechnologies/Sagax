// The Sagax server's view of the per-person server environments. Maps a
// principal (the bot OWNER, for every bot, thread and routine of theirs) to
// one sandbox key, and owns what the provisioner cannot know: who is out.
// A person signed out by Perspicax (back-channel logout, disabled, removed)
// has their environment stopped at once and deleted after a grace period; a
// person back in before it ends keeps it. Pending deletions survive restarts.
import { randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Duplex } from "node:stream";

import { writeFileAtomic } from "./atomic.ts";
import type { SandboxExecInput, SandboxExecOutput, SandboxStats, SandboxStatus } from "./sandboxd-core.ts";
import type { SandboxdClient, SandboxdInfo } from "./user-sandbox-client.ts";
import { SandboxdRequestError } from "./user-sandbox-client.ts";
import { sandboxKeyForPrincipal } from "./user-sandbox-spec.ts";

export const DEFAULT_DELETE_GRACE_MS = 72 * 3600_000;

export interface UserSandboxView {
  state: SandboxStatus["state"] | "unavailable";
  lastUsedAt: number | null;
  workspaceBytes: number | null;
  overQuota: boolean;
  limits: SandboxStatus["limits"] | null;
  idleMinutes: number | null;
  pendingDeletionAt: number | null;
  error?: string;
}

export class UserSandboxUnavailable extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export interface UserSandboxManagerOptions {
  client: SandboxdClient;
  instance: string;
  /** JSON file holding pending deletions (DATA_DIR/user-sandbox-deletions.json). */
  stateFile: string;
  graceMs?: number;
  now?: () => number;
}

export class UserSandboxManager {
  private readonly pending = new Map<string, number>();
  private info: SandboxdInfo | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly graceMs: number;
  private readonly now: () => number;

  private readonly options: UserSandboxManagerOptions;

  constructor(options: UserSandboxManagerOptions) {
    this.options = options;
    this.graceMs = options.graceMs ?? DEFAULT_DELETE_GRACE_MS;
    this.now = options.now ?? Date.now;
    this.load();
  }

  /** The only way to name a sandbox: by person. There is no per-bot key. */
  keyFor(principalId: string): string {
    return sandboxKeyForPrincipal(this.options.instance, principalId);
  }

  private load(): void {
    if (!existsSync(this.options.stateFile)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.options.stateFile, "utf8")) as { version?: number; pending?: Record<string, number> };
      for (const [principalId, dueAt] of Object.entries(parsed.pending ?? {})) {
        if (typeof dueAt === "number" && Number.isFinite(dueAt)) this.pending.set(principalId, dueAt);
      }
    } catch (error) {
      console.error(`user-sandbox: ${this.options.stateFile} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private persist(): void {
    writeFileAtomic(this.options.stateFile, `${JSON.stringify({ version: 1, pending: Object.fromEntries(this.pending) }, null, 2)}\n`);
  }

  pendingDeletionAt(principalId: string): number | null {
    return this.pending.get(principalId) ?? null;
  }

  private async provisionerInfo(): Promise<SandboxdInfo | null> {
    try {
      this.info = await this.options.client.info();
    } catch { /* keep the last answer */ }
    return this.info;
  }

  async status(principalId: string): Promise<UserSandboxView> {
    const pendingDeletionAt = this.pendingDeletionAt(principalId);
    try {
      const [status, info] = await Promise.all([this.options.client.status(this.keyFor(principalId)), this.provisionerInfo()]);
      return {
        state: status.state,
        lastUsedAt: status.lastUsedAt,
        workspaceBytes: status.workspaceBytes,
        overQuota: status.overQuota,
        limits: status.limits,
        idleMinutes: info?.idleMinutes ?? null,
        pendingDeletionAt,
        ...(info?.egress === "missing" ? { error: "egress_policy" } : {}),
      };
    } catch (error) {
      return {
        state: "unavailable", lastUsedAt: null, workspaceBytes: null, overQuota: false, limits: null,
        idleMinutes: null, pendingDeletionAt, error: error instanceof SandboxdRequestError ? error.code : "unreachable",
      };
    }
  }

  private refuseIfOut(principalId: string): void {
    if (this.pending.has(principalId)) {
      throw new UserSandboxUnavailable("This person was signed out by Perspicax; their server environment is closed.", "person_out");
    }
  }

  async exec(principalId: string, input: SandboxExecInput): Promise<SandboxExecOutput> {
    this.refuseIfOut(principalId);
    try {
      return await this.options.client.exec(this.keyFor(principalId), input);
    } catch (error) {
      if (error instanceof SandboxdRequestError) throw new UserSandboxUnavailable(error.message, error.code);
      throw new UserSandboxUnavailable("The server environment could not be reached. Try again in a moment.", "unreachable");
    }
  }

  private async call<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof SandboxdRequestError) throw new UserSandboxUnavailable(error.message, error.code);
      throw new UserSandboxUnavailable("The server environment could not be reached. Try again in a moment.", "unreachable");
    }
  }

  /** The power controls of the person's own Computer tab. Start creates or
   * starts it (and resumes a paused one); shutdown stops it and keeps
   * /workspace; pause freezes it (bots are refused until resumed). */
  async power(principalId: string, action: "start" | "shutdown" | "pause" | "resume"): Promise<UserSandboxView> {
    if (action !== "shutdown") this.refuseIfOut(principalId);
    const key = this.keyFor(principalId);
    await this.call(async () => {
      if (action === "shutdown") return this.options.client.stop(key);
      if (action === "pause") return this.options.client.pause(key);
      if (action === "resume") return this.options.client.resume(key);
      const current = await this.options.client.status(key);
      return current.state === "paused" ? this.options.client.resume(key) : this.options.client.ensure(key);
    });
    return this.status(principalId);
  }

  /** Commands in flight in the person's environment right now. */
  async busy(principalId: string): Promise<number> {
    try { return (await this.options.client.status(this.keyFor(principalId))).busy; } catch { return 0; }
  }

  /** The usage panel: CPU, memory, disk and OS of the person's own
   * environment. Starts nothing. */
  stats(principalId: string): Promise<SandboxStats> {
    return this.call(() => this.options.client.stats(this.keyFor(principalId)));
  }

  /** Open the person's desktop for their live view: start the sandbox and its
   * desktop when needed and set two fresh VNC passwords, the full one
   * (controls the screen) and the view-only one. Only the owner's own
   * request reaches this (server/routes/desktop-viewer.ts). */
  async openDesktop(principalId: string): Promise<{ full: string; view: string }> {
    const passwords = { full: vncPassword(), view: vncPassword() };
    const result = await this.exec(principalId, {
      argv: ["sagax-desktop", "start"],
      env: { SAGAX_VNC_FULL: passwords.full, SAGAX_VNC_VIEW: passwords.view },
      timeoutSec: 30,
    });
    if (result.exitCode !== 0) throw new UserSandboxUnavailable("The desktop of the server environment did not start.", "desktop_failed");
    return passwords;
  }

  /** The live view's byte stream to the desktop's VNC port. Never starts a
   * stopped environment. */
  async desktopStream(principalId: string, options: { control: boolean }): Promise<Duplex> {
    this.refuseIfOut(principalId);
    try {
      return await this.options.client.desktopStream(this.keyFor(principalId), options);
    } catch (error) {
      if (error instanceof SandboxdRequestError) throw new UserSandboxUnavailable(error.message, error.code);
      throw new UserSandboxUnavailable("The server environment could not be reached. Try again in a moment.", "unreachable");
    }
  }

  async workspaceOverQuota(principalId: string): Promise<boolean> {
    try {
      return (await this.options.client.status(this.keyFor(principalId))).overQuota;
    } catch {
      return false;
    }
  }

  /** Throw away the environment (container, network and /workspace) and
   * create a fresh one. Only the person themselves asks for this. */
  async reset(principalId: string): Promise<UserSandboxView> {
    this.refuseIfOut(principalId);
    const key = this.keyFor(principalId);
    await this.options.client.remove(key);
    await this.options.client.ensure(key);
    return this.status(principalId);
  }

  /** Perspicax signed the person out: stop now, delete after the grace. */
  async personOut(principalId: string): Promise<void> {
    if (!this.pending.has(principalId)) {
      this.pending.set(principalId, this.now() + this.graceMs);
      this.persist();
    }
    try {
      await this.options.client.stop(this.keyFor(principalId));
    } catch (error) {
      console.error(`user-sandbox: could not stop an environment of a person signed out: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The person is back before the grace ended: keep their environment. */
  personBack(principalId: string): void {
    if (this.pending.delete(principalId)) this.persist();
  }

  /** Delete the environments whose grace has ended. */
  async sweepDeletions(): Promise<string[]> {
    const removed: string[] = [];
    const now = this.now();
    for (const [principalId, dueAt] of new Map(this.pending)) {
      if (dueAt > now) continue;
      try {
        await this.options.client.remove(this.keyFor(principalId));
        this.pending.delete(principalId);
        removed.push(principalId);
      } catch (error) {
        console.error(`user-sandbox: deletion failed, retrying later: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (removed.length) this.persist();
    return removed;
  }

  start(intervalMs = 5 * 60_000): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.sweepDeletions(); }, intervalMs);
    this.timer.unref?.();
    void this.sweepDeletions();
  }

  stopTimers(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

const VNC_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
/** VNC authentication reads at most 8 characters. */
function vncPassword(): string {
  let value = "";
  for (let index = 0; index < 8; index++) value += VNC_ALPHABET[randomInt(VNC_ALPHABET.length)];
  return value;
}

/** The manager this server runs, or null when organization mode or the
 * provisioner is not configured (solo servers never have one). */
export function userSandboxSettingsFromEnv(env: NodeJS.ProcessEnv = process.env): { url: string; keyFile: string; instance: string; graceMs: number } | null {
  const url = env.SAGAX_SANDBOXD_URL?.trim();
  if (!url) return null;
  const hours = env.SAGAX_SANDBOX_DELETE_GRACE_HOURS?.trim();
  const graceHours = hours ? Number(hours) : DEFAULT_DELETE_GRACE_MS / 3600_000;
  if (!Number.isFinite(graceHours) || graceHours < 0 || graceHours > 24 * 90) throw new Error("SAGAX_SANDBOX_DELETE_GRACE_HOURS must be between 0 and 2160");
  return {
    url,
    keyFile: env.SAGAX_SANDBOXD_KEY_FILE?.trim() || "/run/sagax-sandboxd/key",
    instance: env.SAGAX_SANDBOX_INSTANCE?.trim() || "default",
    graceMs: graceHours * 3600_000,
  };
}
