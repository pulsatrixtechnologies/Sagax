// The identity provider grant behind each "Sign in with Pulsatrix" session
// (spec section 2 "Session sur le serveur Sagax", section 8 and T3, T4,
// T8, T12). Slice 1 threw the provider's refresh token away; from slice 2 the
// server keeps it, sealed, and a session lives exactly as long as Perspicax
// keeps refreshing it:
//
//   - one grant per sign-in, in an AES-256-GCM vault beside the data
//     (idp-grants.enc, key from OMB_IDP_VAULT_KEY, OMB_IDP_VAULT_KEY_FILE or
//     a 0600 idp-grants.key), never in sessions.json, never logged;
//   - on use, at most every OMB_OIDC_REFRESH_AFTER_SECONDS, the grant is
//     refreshed in the background (one flight per grant): a refusal puts the
//     person out like a back-channel logout that never arrived (every session
//     and paired device of theirs ends), a transient failure keeps the
//     session and retries a minute later,
//     and a provider unreachable for 24 hours ends it;
//   - a refresh carries the current role: the session's scopes follow it,
//     and the person's other sessions can only narrow;
//   - any session revoke releases its grant (and revokes it at the provider);
//   - a back-channel logout revokes every session of that person at once,
//     cancels their pairing codes and marks them out until they sign in again.
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";

import { writeFileAtomic } from "./atomic.ts";
import type { VaultKeySource } from "./mcp-oauth.ts";
import { orgRoleForRole, scopesForRole } from "./oidc-login.ts";
import type { OidcIdentity, RefreshOutcome } from "./oidc-rp.ts";
import type { Principal } from "./principals.ts";
import type { Scope, SessionRecord } from "./sessions.ts";

export const IDP_VAULT_FILE = "idp-grants.enc";
export const IDP_KEY_FILE = "idp-grants.key";
const VAULT_AAD = "pulsa-bot idp-grants v1";
const HEX_KEY = /^[0-9a-f]{64}$/;
/** A provider that has not answered a refresh for this long ends the session. */
export const IDP_UNREACHABLE_GRACE_MS = 24 * 60 * 60_000;
/** After a transient failure, no new attempt for this long. */
export const IDP_RETRY_AFTER_FAILURE_MS = 60_000;
export const DEFAULT_REFRESH_AFTER_SECONDS = 3000;
/** A grant created for a web sign-in binds to its session at once; this is
 * only the window in which a crash could leave it unbound. */
export const IDP_WEB_BIND_MS = 60_000;

/** OMB_OIDC_REFRESH_AFTER_SECONDS: a whole number from 1 to 3000, else the
 * default (a typo is not silently turned into a policy). */
export function refreshAfterMs(value: string | undefined): number {
  const seconds = Number(value);
  const ok = value !== undefined && value.trim() !== "" && Number.isInteger(seconds) && seconds >= 1 && seconds <= DEFAULT_REFRESH_AFTER_SECONDS;
  return (ok ? seconds : DEFAULT_REFRESH_AFTER_SECONDS) * 1000;
}

// ── vault ────────────────────────────────────────────────────────────────

const grantSchema = z.object({
  grantRef: z.string().min(1).max(64),
  iss: z.string().min(1).max(2048),
  sub: z.string().min(1).max(255),
  refreshToken: z.string().min(1).max(4096),
  createdAt: z.number(),
  /** Last successful refresh (or the sign-in). */
  refreshedAt: z.number(),
  lastOkAt: z.number(),
  /** The session this grant keeps alive, once there is one. */
  sessionId: z.string().max(64).optional(),
  /** An unbound grant (a desktop or phone sign-in waiting for its pairing
   * exchange) is revoked by the sweep after this time. */
  bindBy: z.number().optional(),
  /** Last transient failure, and the first one since the last success. */
  failedAt: z.number().optional(),
  failingSince: z.number().optional(),
  /** Slice 6: "session" (a sign-in, the default) or "routines" (a routine
   * delegation: never bound to a session, never swept, one per principal;
   * RoutineDelegations owns it, IdpSessionManager never touches it). */
  kind: z.enum(["session", "routines"]).default("session"),
  /** The principal a routines grant acts for. */
  principalId: z.string().max(64).optional(),
});
export type IdpGrant = z.input<typeof grantSchema>;
/** Whether a grant belongs to a sign-in (IdpSessionManager's), not a routine delegation. */
export function isSessionGrant(grant: Pick<IdpGrant, "kind">): boolean {
  return grant.kind !== "routines";
}

const vaultSchema = z.object({ version: z.literal(1), grants: z.record(z.string(), grantSchema) });
type VaultDocument = z.infer<typeof vaultSchema>;

/** Where the grant vault's key comes from: OMB_IDP_VAULT_KEY (64 hex), else
 * the file OMB_IDP_VAULT_KEY_FILE names, else <data>/idp-grants.key created
 * 0600. A desktop child without the environment key must not invent one. */
export function resolveIdpVaultKey(dataDir: string, env: NodeJS.ProcessEnv = process.env): VaultKeySource {
  const fromEnv = env.OMB_IDP_VAULT_KEY?.trim().toLowerCase();
  if (fromEnv) {
    return HEX_KEY.test(fromEnv)
      ? { kind: "key", key: Buffer.from(fromEnv, "hex") }
      : { kind: "unavailable", reason: "OMB_IDP_VAULT_KEY must be 64 hexadecimal characters." };
  }
  if (env.OMB_DESKTOP_PARENT === "1") {
    return { kind: "unavailable", reason: "The sign-in grant store has no key on this launch." };
  }
  const configured = env.OMB_IDP_VAULT_KEY_FILE?.trim();
  const file = configured || join(dataDir, IDP_KEY_FILE);
  try {
    const existing = readFileSync(file, "utf8").trim().toLowerCase();
    if (HEX_KEY.test(existing)) return { kind: "key", key: Buffer.from(existing, "hex") };
    return { kind: "unavailable", reason: "The sign-in grant key file does not hold 64 hexadecimal characters." };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") return { kind: "unavailable", reason: "The sign-in grant key file could not be read." };
  }
  try {
    const key = randomBytes(32).toString("hex");
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileAtomic(file, `${key}\n`, { mode: 0o600 });
    return { kind: "key", key: Buffer.from(key, "hex") };
  } catch {
    return { kind: "unavailable", reason: "The sign-in grant key could not be created." };
  }
}

export class IdpVaultError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdpVaultError";
  }
}

/** The sealed grant store. Same rules as McpOAuthVault: a file that cannot
 * be read (wrong key, damaged) is never overwritten; writes then fail. */
export class IdpGrantVault {
  private readonly file: string;
  private readonly keySource: () => VaultKeySource;
  private cached: VaultDocument | null = null;
  private unreadable: string | null = null;

  constructor(dataDir: string, keySource: () => VaultKeySource) {
    this.file = join(dataDir, IDP_VAULT_FILE);
    this.keySource = keySource;
  }

  private load(): VaultDocument | null {
    if (this.cached) return this.cached;
    const source = this.keySource();
    if (source.kind === "unavailable") {
      this.unreadable = source.reason;
      return null;
    }
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.cached = { version: 1, grants: {} };
        this.unreadable = null;
        return this.cached;
      }
      this.unreadable = "The sign-in grant store could not be read.";
      return null;
    }
    try {
      const envelope = JSON.parse(raw) as { v?: unknown; iv?: unknown; tag?: unknown; data?: unknown };
      if (envelope.v !== 1 || typeof envelope.iv !== "string" || typeof envelope.tag !== "string" || typeof envelope.data !== "string") throw new Error("format");
      const decipher = createDecipheriv("aes-256-gcm", source.key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(Buffer.from(VAULT_AAD));
      decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.data, "base64")), decipher.final()]).toString("utf8");
      const parsed = vaultSchema.safeParse(JSON.parse(plain));
      if (!parsed.success) throw new Error("schema");
      this.cached = parsed.data;
      this.unreadable = null;
      return this.cached;
    } catch {
      this.unreadable = "The sign-in grant store could not be decrypted on this launch.";
      return null;
    }
  }

  /** Null when the store works. */
  unavailableReason(): string | null {
    this.load();
    return this.unreadable;
  }

  get(grantRef: string): IdpGrant | undefined {
    const grant = this.load()?.grants[grantRef];
    return grant ? structuredClone(grant) : undefined;
  }

  list(): IdpGrant[] {
    return Object.values(this.load()?.grants ?? {}).map((grant) => structuredClone(grant));
  }

  set(grant: IdpGrant): void {
    const parsed = grantSchema.parse(grant);
    this.write((grants) => { grants[parsed.grantRef] = structuredClone(parsed); });
  }

  delete(grantRef: string): boolean {
    let found = false;
    this.write((grants) => {
      found = grantRef in grants;
      delete grants[grantRef];
    });
    return found;
  }

  private write(change: (grants: Record<string, IdpGrant>) => void): void {
    const document = this.load();
    if (!document) throw new IdpVaultError(this.unreadable ?? "The sign-in grant store is unavailable.");
    const next: VaultDocument = { version: 1, grants: { ...document.grants } };
    change(next.grants);
    this.persist(next);
    this.cached = next;
  }

  private persist(document: VaultDocument): void {
    const source = this.keySource();
    if (source.kind === "unavailable") throw new IdpVaultError(source.reason);
    if (Object.keys(document.grants).length === 0) {
      rmSync(this.file, { force: true });
      return;
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", source.key, iv);
    cipher.setAAD(Buffer.from(VAULT_AAD));
    const data = Buffer.concat([cipher.update(JSON.stringify(document), "utf8"), cipher.final()]);
    const envelope = { v: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    writeFileAtomic(this.file, JSON.stringify(envelope), { mode: 0o600 });
  }
}

// ── manager ──────────────────────────────────────────────────────────────

export interface IdpRelyingParty {
  refresh(refreshToken: string, expect: { sub: string }): Promise<RefreshOutcome>;
  revokeToken(token: string, hint?: "refresh_token" | "access_token"): Promise<boolean>;
}

export interface IdpSessionStore {
  byId(id: string): SessionRecord | null;
  forPrincipal(principalId: string): SessionRecord[];
  revokeWhere(pick: (session: Readonly<SessionRecord>) => boolean): string[];
  setScopes(id: string, scopes: Scope[]): boolean;
  setIdpRole(id: string, role: string | undefined): boolean;
  cancelPairingsFor(principalId: string): number;
}

export interface IdpPrincipalStore {
  forSubject(input: { iss: string; sub: string; claims?: { email?: string; name?: string; login?: string }; orgRole?: "admin" | "member"; teams?: { id: string; manager: boolean }[]; perspicaxRole?: "admin" | "manager" | "employee" }): Principal;
  bySubject(iss: string, sub: string): Principal | null;
  markDisabled(iss: string, sub: string, at?: number): Principal | null;
}

export interface IdpSessionManagerOptions {
  vault: IdpGrantVault;
  rp: IdpRelyingParty;
  sessions: IdpSessionStore;
  principals: IdpPrincipalStore;
  now?: () => number;
  refreshAfterMs?: number;
  log?: (line: string) => void;
  /** Runs `run` after `delayMs` (tests pass a recorder). The default is an
   * unref'd `setTimeout`. */
  schedule?: (run: () => void, delayMs: number) => void;
  /** Slice 4: the team names a refreshed id_token carries (org-teams.ts). */
  teamNames?: (teams: { id: string; name: string }[]) => void;
}

/** The Perspicax role claim as a known role, or undefined. */
export function perspicaxRoleOf(role: string | undefined): "admin" | "manager" | "employee" | undefined {
  return role === "admin" || role === "manager" || role === "employee" ? role : undefined;
}

/** How long a request that found its grant due waits for the refresh before
 * it is served anyway (the refresh then finishes in the background). */
export const IDP_REFRESH_WAIT_MS = 5_000;

/** Resolves when `promise` settles or after `ms`, whichever comes first. */
export function settledWithin(promise: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => { timer = setTimeout(resolve, ms); });
  return Promise.race([promise.then(() => {}, () => {}), bound]).finally(() => clearTimeout(timer));
}

/** A cached sign-in access token with less than this left is refreshed
 * before it is used as a token exchange subject (slice 5, D7). */
export const IDP_SUBJECT_MIN_LIFE_MS = 600_000;

/** The speaker's sign-in access token for a token exchange, or why none. */
export type SubjectTokenOutcome =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; error: "no_session" | "unreachable" | "ended" };

/** A grant left unbound is swept this long after its `bindBy` at the latest. */
export const IDP_SWEEP_SLACK_MS = 1_000;
/** The periodic sweep, a backstop for the per-grant timers (a restart, a
 * clock jump): short enough that no unredeemed grant outlives its window by
 * more than a minute. */
export const IDP_SWEEP_INTERVAL_MS = 60_000;

/** Why a session must not be served, as the 401 `code`. */
export type IdpRefusal = "idp_unreachable" | "idp_session_ended";

export class IdpSessionManager {
  private readonly vault: IdpGrantVault;
  private readonly rp: IdpRelyingParty;
  private readonly sessions: IdpSessionStore;
  private readonly principals: IdpPrincipalStore;
  private readonly now: () => number;
  private readonly refreshAfter: number;
  private readonly log: (line: string) => void;
  private readonly inflight = new Map<string, Promise<void>>();
  /** The latest access token of each grant: memory only, never in the vault,
   * never logged, never in an error (slice 5, D7). */
  private readonly access = new Map<string, { token: string; expiresAt: number }>();
  private readonly schedule: (run: () => void, delayMs: number) => void;
  private readonly teamNames?: (teams: { id: string; name: string }[]) => void;

  constructor(options: IdpSessionManagerOptions) {
    this.teamNames = options.teamNames;
    this.vault = options.vault;
    this.rp = options.rp;
    this.sessions = options.sessions;
    this.principals = options.principals;
    this.now = options.now ?? Date.now;
    this.refreshAfter = options.refreshAfterMs ?? DEFAULT_REFRESH_AFTER_SECONDS * 1000;
    this.log = options.log ?? ((line) => console.warn(line));
    this.schedule = options.schedule ?? ((run, delayMs) => { setTimeout(run, delayMs).unref(); });
  }

  /** Null when grants can be kept; a reason otherwise (sign-in is refused). */
  unavailableReason(): string | null {
    return this.vault.unavailableReason();
  }

  /** Keep a new sign-in's refresh token. Unbound until `bindSession`; the
   * sweep revokes it after `bindBy`. Throws when the vault is unavailable. */
  createGrant(input: { iss: string; sub: string; refreshToken: string; bindBy: number; accessToken?: string; accessExpiresAt?: number }): string {
    const now = this.now();
    const grantRef = randomUUID();
    this.vault.set({ grantRef, iss: input.iss, sub: input.sub, refreshToken: input.refreshToken, createdAt: now, refreshedAt: now, lastOkAt: now, bindBy: input.bindBy });
    if (input.accessToken && input.accessExpiresAt !== undefined) this.access.set(grantRef, { token: input.accessToken, expiresAt: input.accessExpiresAt });
    // Revoked at the provider as soon as its window closes unredeemed, not
    // at the next periodic sweep.
    this.schedule(() => {
      try {
        this.sweep();
      } catch {
        /* the periodic sweep retries */
      }
    }, Math.max(0, input.bindBy - now) + IDP_SWEEP_SLACK_MS);
    return grantRef;
  }

  bindSession(grantRef: string, sessionId: string): boolean {
    const grant = this.vault.get(grantRef);
    if (!grant) return false;
    grant.sessionId = sessionId;
    delete grant.bindBy;
    this.vault.set(grant);
    return true;
  }

  /** Drop a grant nobody will use, revoking it at the provider. */
  discard(grantRef: string): void {
    const grant = this.vault.get(grantRef);
    if (!grant) return;
    this.safeDelete(grantRef);
    this.revokeAtProvider(grant, "discarded");
  }

  /** Whether the session must be refused right now (D2 grace, a lost grant).
   * A session with a provider account but no grant of its own (a device
   * paired from a signed-in person's session) is served only while one of
   * that person's grants is live, and follows it. */
  mustRefuse(session: Readonly<SessionRecord>): IdpRefusal | null {
    if (!session.idp) return null;
    const ref = session.idp.grantRef;
    if (!ref) {
      if (this.vault.unavailableReason()) return "idp_unreachable";
      const live = this.liveGrantsFor(session.idp);
      if (!live.length) return "idp_session_ended";
      if (live.every((grant) => this.pastGrace(grant))) return "idp_unreachable";
      return null;
    }
    if (this.vault.unavailableReason()) return "idp_unreachable";
    const grant = this.vault.get(ref);
    if (!grant || !isSessionGrant(grant)) return "idp_session_ended";
    if (this.pastGrace(grant)) return "idp_unreachable";
    return null;
  }

  /** The scopes a session without a grant of its own may keep: never wider
   * than its person's organization role now. Null when nothing changes. */
  clampScopes(session: Readonly<SessionRecord>, orgRole: "admin" | "member" | undefined): Scope[] | null {
    if (!session.idp || session.idp.grantRef) return null;
    const allowed = scopesForRole(orgRole === "admin" ? "admin" : undefined) ?? [];
    const kept = session.scopes.filter((scope) => allowed.includes(scope));
    return kept.length === session.scopes.length ? null : kept;
  }

  /** Start the refresh of the session's grant when it is due, in a single
   * flight per grant. Never throws. Returns the refresh in flight (resolved
   * when nothing is due), so the server can serve the request that found it
   * due with the provider's current answer (role, disabled). A session with
   * no grant of its own refreshes the freshest live grant of its person. */
  touch(session: Readonly<SessionRecord>): Promise<void> {
    const done = Promise.resolve();
    let ref = session.idp?.grantRef;
    if (!ref && session.idp) {
      let live: IdpGrant[];
      try {
        live = this.liveGrantsFor(session.idp);
      } catch {
        return done;
      }
      ref = live.sort((a, b) => b.refreshedAt - a.refreshedAt)[0]?.grantRef;
    }
    if (!ref) return done;
    const pending = this.inflight.get(ref);
    if (pending) return pending;
    let grant: IdpGrant | undefined;
    try {
      grant = this.vault.get(ref);
    } catch {
      return done;
    }
    if (!grant || !isSessionGrant(grant)) return done;
    const now = this.now();
    if (now - grant.refreshedAt < this.refreshAfter) return done;
    if (grant.failedAt !== undefined && now - grant.failedAt < IDP_RETRY_AFTER_FAILURE_MS) return done;
    return this.startRefresh(ref);
  }

  /** The one refresh in flight for a grant: a second caller joins it. Two
   * refreshes of one grant must never race (rotation reuse would end the
   * whole family at the provider). */
  private startRefresh(ref: string): Promise<void> {
    const pending = this.inflight.get(ref);
    if (pending) return pending;
    const flight = this.refreshGrant(ref).catch((error: unknown) => {
      this.log(`idp: refresh of a grant failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => this.inflight.delete(ref));
    this.inflight.set(ref, flight);
    return flight;
  }

  /** Slice 5 (D7): the person's current sign-in access token, the subject of
   * a token exchange for their MCP tools. Taken from their freshest live
   * grant; a cached token with at least 10 minutes left is returned as is,
   * otherwise the grant is refreshed through the same single flight as
   * `touch` (whatever `refreshAfter` says, but never sooner than the retry
   * delay after a transient failure), waiting at most IDP_REFRESH_WAIT_MS.
   * Never throws; never puts the token in an error or a log line. */
  async subjectToken(subject: { iss: string; sub: string }): Promise<SubjectTokenOutcome> {
    let live: IdpGrant[];
    try {
      live = this.liveGrantsFor(subject);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    const grant = live.sort((a, b) => b.refreshedAt - a.refreshedAt)[0];
    if (!grant) return { ok: false, error: "no_session" };
    const ref = grant.grantRef;
    const usable = () => {
      const cached = this.access.get(ref);
      return cached && cached.expiresAt - this.now() >= IDP_SUBJECT_MIN_LIFE_MS ? cached : undefined;
    };
    const fresh = usable();
    if (fresh) return { ok: true, token: fresh.token, expiresAt: fresh.expiresAt };
    let flight = this.inflight.get(ref);
    if (!flight) {
      if (grant.failedAt !== undefined && this.now() - grant.failedAt < IDP_RETRY_AFTER_FAILURE_MS) return { ok: false, error: "unreachable" };
      flight = this.startRefresh(ref);
    }
    await settledWithin(flight, IDP_REFRESH_WAIT_MS);
    let after: IdpGrant | undefined;
    try {
      after = this.vault.get(ref);
    } catch {
      return { ok: false, error: "unreachable" };
    }
    if (!after) return { ok: false, error: "ended" };
    const renewed = usable();
    if (renewed) return { ok: true, token: renewed.token, expiresAt: renewed.expiresAt };
    return { ok: false, error: "unreachable" };
  }

  /** The person's grants that stand on a live session of their own. */
  private liveGrantsFor(subject: { iss: string; sub: string }): IdpGrant[] {
    return this.vault.list().filter((grant) => isSessionGrant(grant) &&
      grant.iss === subject.iss && grant.sub === subject.sub &&
      grant.sessionId !== undefined && this.sessions.byId(grant.sessionId) !== null);
  }

  private pastGrace(grant: IdpGrant): boolean {
    return grant.failingSince !== undefined && this.now() - grant.failingSince >= IDP_UNREACHABLE_GRACE_MS;
  }

  /** The refresh in flight for a grant, for tests. */
  settled(grantRef?: string): Promise<void> {
    if (grantRef) return this.inflight.get(grantRef) ?? Promise.resolve();
    return Promise.all(this.inflight.values()).then(() => {});
  }

  private async refreshGrant(ref: string): Promise<void> {
    const grant = this.vault.get(ref);
    if (!grant) return;
    const outcome = await this.rp.refresh(grant.refreshToken, { sub: grant.sub });
    const current = this.vault.get(ref);
    if (outcome.ok) {
      if (!current) {
        // Released while the refresh was out (logout, back-channel): the
        // rotated token must not outlive it.
        void this.rp.revokeToken(outcome.refreshToken, "refresh_token");
        return;
      }
      const now = this.now();
      const next: IdpGrant = { ...current, refreshToken: outcome.refreshToken, refreshedAt: now, lastOkAt: now };
      if (outcome.accessToken) this.access.set(ref, { token: outcome.accessToken, expiresAt: now + (outcome.expiresIn ?? 3600) * 1000 });
      delete next.failedAt;
      delete next.failingSince;
      // The rotated token is persisted before anything else: the old one is dead.
      try {
        this.vault.set(next);
      } catch (error) {
        this.log(`idp: could not keep a rotated grant: ${error instanceof Error ? error.message : String(error)}`);
        void this.rp.revokeToken(outcome.refreshToken, "refresh_token");
        this.endGrant(ref, "the rotated grant could not be kept");
        return;
      }
      if (outcome.identity) this.applyIdentity(next, outcome.identity);
      return;
    }
    if (!current) return;
    if (outcome.kind === "rejected") {
      this.endGrant(ref, outcome.error, { personOut: true });
      return;
    }
    const now = this.now();
    try {
      this.vault.set({ ...current, failedAt: now, failingSince: current.failingSince ?? now });
    } catch {
      /* the grace still counts from the last success */
    }
    this.log(`idp: refresh deferred (${outcome.error}); the session stays until the provider answers`);
  }

  /** D3: the provider's current claims flow into the person and the sessions. */
  private applyIdentity(grant: IdpGrant, identity: OidcIdentity): void {
    const scopes = scopesForRole(identity.role);
    const orgRole = orgRoleForRole(identity.role);
    if (!scopes || !orgRole) {
      this.endGrant(grant.grantRef, "the role no longer signs in", { personOut: true });
      return;
    }
    const principal = this.principals.forSubject({
      iss: grant.iss,
      sub: grant.sub,
      claims: { email: identity.email, name: identity.name, login: identity.preferredUsername },
      orgRole,
      ...(identity.teams ? { teams: identity.teams.map(({ id, manager }) => ({ id, manager })) } : {}),
      ...(perspicaxRoleOf(identity.role) ? { perspicaxRole: perspicaxRoleOf(identity.role) } : {}),
    });
    if (identity.teams?.length) this.teamNames?.(identity.teams.map(({ id, name }) => ({ id, name })));
    const narrowed: string[] = [];
    for (const session of this.sessions.forPrincipal(principal.id)) {
      if (session.idp?.grantRef === grant.grantRef) {
        this.sessions.setIdpRole(session.id, identity.role);
        this.sessions.setScopes(session.id, scopes);
        continue;
      }
      // Another device of the same person never widens.
      const kept = session.scopes.filter((scope) => scopes.includes(scope));
      if (!kept.length) narrowed.push(session.id);
      else if (kept.length !== session.scopes.length) this.sessions.setScopes(session.id, kept);
    }
    if (narrowed.length) this.sessions.revokeWhere((session) => narrowed.includes(session.id));
    // A grant not yet bound to a session: its pairing sessions follow on exchange.
  }

  /** Drop a grant (no revoke call: it is dead or unkept) and revoke every
   * session standing on it. With `personOut` (the provider refused it), the
   * person is out, as after a back-channel logout that never arrived (T8):
   * every session of the subject or its principal ends, including devices
   * paired from a session, which have no grant of their own; open pairing
   * codes are cancelled; the person is marked out until the next successful
   * sign-in or refresh. The other grants go with their sessions and are
   * revoked at the provider, which may still hold them. */
  private endGrant(ref: string, why: string, options: { personOut?: boolean } = {}): void {
    let grant: IdpGrant | undefined;
    try {
      grant = this.vault.get(ref);
    } catch {
      grant = undefined;
    }
    this.safeDelete(ref);
    const principal = options.personOut && grant ? this.principals.bySubject(grant.iss, grant.sub) : null;
    const subject = options.personOut && grant ? { iss: grant.iss, sub: grant.sub } : null;
    const revoked = this.sessions.revokeWhere((session) =>
      session.idp?.grantRef === ref ||
      (subject !== null && session.idp?.iss === subject.iss && session.idp.sub === subject.sub) ||
      (principal !== null && session.principalId === principal.id));
    let pairings = 0;
    if (subject) {
      for (const other of this.safeList()) {
        // An unbound grant (a native sign-in waiting for its exchange) has no
        // session to release it: revoke it here.
        if (isSessionGrant(other) && other.iss === subject.iss && other.sub === subject.sub && !other.sessionId) {
          this.safeDelete(other.grantRef);
          this.revokeAtProvider(other, "person out");
        }
      }
      if (principal) {
        pairings = this.sessions.cancelPairingsFor(principal.id);
        this.principals.markDisabled(subject.iss, subject.sub, this.now());
      }
    }
    this.log(`idp: a grant ended (${why}); ${revoked.length} session(s) revoked${subject ? `, ${pairings} pairing code(s) cancelled, person marked out` : ""}`);
  }

  private safeList(): IdpGrant[] {
    try {
      return this.vault.list();
    } catch {
      return [];
    }
  }

  /** D5: a session ended; its grant goes with it. */
  release(sessionId: string, options: { revokeAtIdp: boolean }): void {
    let grants: IdpGrant[];
    try {
      grants = this.vault.list().filter((grant) => isSessionGrant(grant) && grant.sessionId === sessionId);
    } catch {
      return;
    }
    for (const grant of grants) {
      this.safeDelete(grant.grantRef);
      if (options.revokeAtIdp) this.revokeAtProvider(grant, "session ended");
    }
  }

  /** Revoke unbound grants past their window and grants whose session is gone. */
  sweep(): number {
    const now = this.now();
    let swept = 0;
    for (const grant of this.vault.list()) {
      // A routine delegation has no session by design (RoutineDelegations).
      if (!isSessionGrant(grant)) continue;
      const orphan = grant.sessionId
        ? !this.sessions.byId(grant.sessionId)
        : now > (grant.bindBy ?? grant.createdAt + IDP_WEB_BIND_MS);
      if (!orphan) continue;
      this.safeDelete(grant.grantRef);
      this.revokeAtProvider(grant, grant.sessionId ? "orphan" : "unredeemed");
      swept += 1;
    }
    return swept;
  }

  /** Slice 3 (D10): the Perspicax directory says this person is no longer an
   * admin. Every session of theirs keeps only what the role allows now,
   * without waiting for a refresh; a session left with nothing ends.
   * Widening waits for the next refresh. Returns the sessions narrowed. */
  narrowToOrgRole(principalId: string, orgRole: "admin" | "member"): number {
    const allowed = scopesForRole(orgRole === "admin" ? "admin" : undefined) ?? [];
    const emptied: string[] = [];
    let narrowed = 0;
    for (const session of this.sessions.forPrincipal(principalId)) {
      if (!session.idp) continue;
      const kept = session.scopes.filter((scope) => allowed.includes(scope));
      if (kept.length === session.scopes.length) continue;
      narrowed += 1;
      if (!kept.length) emptied.push(session.id);
      else this.sessions.setScopes(session.id, kept);
    }
    if (emptied.length) this.sessions.revokeWhere((session) => emptied.includes(session.id));
    return narrowed;
  }

  /** D6: the provider says this person is out. */
  backchannelLogout(input: { iss: string; sub: string }): { sessions: number; pairings: number } {
    // Grants first, so the session listeners find nothing to revoke at the
    // provider: the provider already ended them.
    for (const grant of this.vault.list()) {
      // A routine delegation is ended by its own manager (the wiring calls
      // RoutineDelegations.endForSubject), so its routines learn why.
      if (isSessionGrant(grant) && grant.iss === input.iss && grant.sub === input.sub) this.safeDelete(grant.grantRef);
    }
    const principal = this.principals.bySubject(input.iss, input.sub);
    const revoked = this.sessions.revokeWhere((session) =>
      (session.idp?.iss === input.iss && session.idp.sub === input.sub) || (principal !== null && session.principalId === principal.id));
    let pairings = 0;
    if (principal) {
      pairings = this.sessions.cancelPairingsFor(principal.id);
      this.principals.markDisabled(input.iss, input.sub, this.now());
    }
    return { sessions: revoked.length, pairings };
  }

  private safeDelete(grantRef: string): void {
    this.access.delete(grantRef);
    try {
      this.vault.delete(grantRef);
    } catch (error) {
      this.log(`idp: could not drop a grant: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private revokeAtProvider(grant: IdpGrant, why: string): void {
    void this.rp.revokeToken(grant.refreshToken, "refresh_token").then((ok) => {
      if (!ok) this.log(`idp: revoking a grant (${why}) at the provider did not succeed; it expires on its own`);
    });
  }
}
