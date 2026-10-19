// Personal cloud agent runs (Perspicax #384, lot P1.9, spec section 4.4): a
// run whose `token_source` is `personnel` calls its model through
// Perspicax's proxy with the SHORT access token of its requester's own
// engine subscription. Perspicax keeps that token in memory only and never
// sees a refresh token; this server, which holds the person's sign-in
// (principal-engine-logins.ts), hands it over and renews it:
//
//   - when the run turns live (Perspicax refuses a deposit while it is
//     `queued` or ended): a run launched from Sagax is watched closely
//     (`watch`), every other one (the console, an MCP client, an
//     automation) is found by the regular sweep of `GET /runs?mine=true`;
//   - again before the token expires, while the run stays live;
//   - never for someone else's run (only runs this person asked for, with
//     their own rights), never when the person has no sign-in for the
//     run's engine: the run then shows why (`status`), in the Code view.
//
// A personal API key the person keeps in Perspicax's vault is Perspicax's
// to read, never this server's. Nothing here writes a token to disk or logs
// one; the in-memory record keeps a digest of what was handed over.
import { createHash } from "node:crypto";

import type { PerspicaxRun } from "../../shared/cloud-agents.ts";
import type { CodeSubscription } from "../../shared/code-runs.ts";
import type { SubscriptionTokenBody, SubscriptionTokenDeposit } from "../perspicax-link.ts";
import { ENGINE_DRIVER, runEngine, type RunEngine, type SubscriptionAccess, type SubscriptionDriver } from "./subscription-access.ts";

/** What the Code view says about a personal run's subscription: `ok`
 * (handed over, valid until `until`), `missing` (no sign-in on this server
 * for the run's engine), `expired` (the sign-in ran out and the CLI could
 * not renew it), `refused` (Perspicax said no: personal subscriptions off,
 * a bad token). */
export type SubscriptionStatus = CodeSubscription;

export interface DepositorDeps {
  /** The people to sweep: those with a live sign-in on this server. */
  people: () => string[];
  /** The person's Perspicax user id (their subject), to keep to their runs. */
  subjectOf: (principalId: string) => string | null;
  /** The person's live sign-in access token, or null. */
  subjectToken: (principalId: string) => Promise<string | null>;
  /** The person's runs (`GET /runs?mine=true`), with their sign-in token. */
  runs: (subjectToken: string) => Promise<PerspicaxRun[]>;
  signedIn: (principalId: string, driver: SubscriptionDriver) => boolean;
  read: (principalId: string, engine: RunEngine) => SubscriptionAccess | null;
  /** The engine CLI renews the person's sign-in in its directory. */
  renew: (principalId: string, engine: RunEngine) => Promise<void>;
  deposit: (subjectToken: string, runId: string, body: SubscriptionTokenBody) => Promise<SubscriptionTokenDeposit>;
  now?: () => number;
  log?: (line: string) => void;
}

/** Hand the token over again when this little life is left. */
export const RENEW_MARGIN_MS = 15 * 60_000;
/** Perspicax refuses a token said to live longer (24 h); stay under it. */
export const MAX_DECLARED_MS = 23 * 3_600_000;
/** A token whose file gives no expiry is declared for this long. */
export const UNKNOWN_LIFE_MS = 30 * 60_000;
export const SWEEP_MS = 60_000;
/** A run launched here is looked at this often until its token is in. */
export const WATCH_MS = 4_000;
export const WATCH_FOR_MS = 5 * 60_000;

const LIVE = new Set(["waking", "provisioning", "setup", "running", "waiting_for_approval", "idle"]);

interface Handed {
  digest: string;
  until: number;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export class SubscriptionDepositor {
  private readonly deps: DepositorDeps;
  private readonly now: () => number;
  private readonly handed = new Map<string, Handed>();
  private readonly statuses = new Map<string, SubscriptionStatus>();
  private readonly watched = new Map<string, { principalId: string; until: number }>();
  private sweepTimer: NodeJS.Timeout | null = null;
  private watchTimer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;

  constructor(deps: DepositorDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
  }

  /** What the Code view shows for a run (undefined: not a personal run seen here). */
  status(runId: string): SubscriptionStatus | undefined {
    return this.statuses.get(runId);
  }

  /** Before a launch: the person can run this engine on their own
   * subscription. The refusal is the text the bot or the Code view shows. */
  ready(principalId: string, engineName: string): { ok: true } | { ok: false; message: string } {
    const engine = runEngine(engineName);
    if (!engine) return { ok: true };
    if (this.deps.signedIn(principalId, ENGINE_DRIVER[engine])) return { ok: true };
    return { ok: false, message: missingMessage(engine) };
  }

  /** A run launched here: looked at often until its token is handed over. */
  watch(principalId: string, runId: string): void {
    this.watched.set(runId, { principalId, until: this.now() + WATCH_FOR_MS });
    if (!this.watchTimer) {
      this.watchTimer = setInterval(() => { void this.tickWatched(); }, WATCH_MS);
      this.watchTimer.unref?.();
    }
  }

  start(): void {
    this.stop();
    this.sweepTimer = setInterval(() => { void this.sweep(); }, SWEEP_MS);
    this.sweepTimer.unref?.();
  }

  stop(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.watchTimer) clearInterval(this.watchTimer);
    this.sweepTimer = null;
    this.watchTimer = null;
  }

  /** One pass over every person's live personal runs. */
  async sweep(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      const seen = new Set<string>();
      for (const principalId of this.deps.people()) {
        for (const id of await this.person(principalId).catch(() => [] as string[])) seen.add(id);
      }
      // Runs that ended or left: forget what was handed over for them.
      for (const id of this.handed.keys()) if (!seen.has(id)) this.handed.delete(id);
      for (const id of this.statuses.keys()) if (!seen.has(id) && !this.watched.has(id)) this.statuses.delete(id);
    })().finally(() => { this.running = null; });
    return this.running;
  }

  private async tickWatched(): Promise<void> {
    const now = this.now();
    const people = new Set<string>();
    for (const [runId, entry] of this.watched) {
      if (entry.until < now || this.handed.has(runId)) this.watched.delete(runId);
      else people.add(entry.principalId);
    }
    if (this.watched.size === 0 && this.watchTimer) {
      clearInterval(this.watchTimer);
      this.watchTimer = null;
    }
    for (const principalId of people) await this.person(principalId).catch(() => []);
  }

  /** One person's live personal runs: hand over or renew each one's token.
   * Returns the ids of the runs it looked at. */
  async person(principalId: string): Promise<string[]> {
    const subject = this.deps.subjectOf(principalId);
    const signIn = await this.deps.subjectToken(principalId);
    if (!subject || !signIn) return [];
    const runs = (await this.deps.runs(signIn)).filter((run) =>
      run.token_source === "personnel" && LIVE.has(run.state)
      && run.requested_by === subject && run.runs_as === subject);
    for (const run of runs) await this.one(principalId, signIn, run);
    return runs.map((run) => run.id);
  }

  private async one(principalId: string, signIn: string, run: PerspicaxRun): Promise<void> {
    const engine = runEngine(run.engine);
    if (!engine) return;
    if (!this.deps.signedIn(principalId, ENGINE_DRIVER[engine])) {
      this.setStatus(run.id, { state: "missing", engine, message: missingMessage(engine) });
      return;
    }
    const now = this.now();
    let access = this.deps.read(principalId, engine);
    if (!access || (access.expiresAt !== null && access.expiresAt - now < RENEW_MARGIN_MS)) {
      await this.deps.renew(principalId, engine).catch(() => {});
      access = this.deps.read(principalId, engine) ?? access;
    }
    if (!access || (access.expiresAt !== null && access.expiresAt <= now + 60_000)) {
      this.setStatus(run.id, { state: "expired", engine, message: expiredMessage(engine) });
      return;
    }
    const until = Math.min(access.expiresAt ?? now + UNKNOWN_LIFE_MS, now + MAX_DECLARED_MS);
    const sum = digest(access.accessToken);
    const before = this.handed.get(run.id);
    if (before && before.digest === sum && before.until - now >= RENEW_MARGIN_MS) return;
    const answer = await this.deps.deposit(signIn, run.id, {
      provider: access.provider,
      access_token: access.accessToken,
      expires_at: new Date(until).toISOString(),
      ...(access.accountId ? { account_id: access.accountId } : {}),
    });
    if (answer.ok) {
      this.handed.set(run.id, { digest: sum, until });
      this.setStatus(run.id, { state: "ok", engine, until: new Date(until).toISOString() });
      return;
    }
    if (answer.error === "forbidden" || answer.error === "rejected") {
      this.setStatus(run.id, { state: "refused", engine, ...(answer.message ? { message: answer.message } : {}) });
    }
    this.deps.log?.(`[cloud-agents] subscription token for run ${run.id} not handed over (${answer.error}${answer.status ? ` ${answer.status}` : ""})`);
  }

  private setStatus(runId: string, next: SubscriptionStatus): void {
    const before = this.statuses.get(runId);
    if (!before || before.state !== next.state) this.deps.log?.(`[cloud-agents] run ${runId}: subscription ${next.state} (${next.engine})`);
    this.statuses.set(runId, next);
  }
}

const ENGINE_LABEL: Readonly<Record<RunEngine, string>> = { "claude-code": "Claude", codex: "ChatGPT (Codex)" };

function missingMessage(engine: RunEngine): string {
  return `This run uses your own ${ENGINE_LABEL[engine]} subscription, and you have no ${ENGINE_LABEL[engine]} sign-in in Sagax. Connect it in Sagax (Settings, My subscriptions and keys), then start the run again.`;
}

function expiredMessage(engine: RunEngine): string {
  return `Your ${ENGINE_LABEL[engine]} sign-in in Sagax expired and could not be renewed. Sign in again in Sagax (Settings, My subscriptions and keys).`;
}
