// Routine delegations (slice 6, spec sections 4 "Délégation pour les
// routines", 4 bis and 11): a person allows the routines that run as them to
// act in their name while they are away. The permission is an ordinary
// `pulsa-bot` grant whose scope carries `pulsabot:routines`; Perspicax keeps
// it 30 days, sliding, and each run renews it with one refresh. It lives in
// the same sealed vault as the sign-in grants (`kind: "routines"`, one per
// principal, never bound to a session) and IdpSessionManager never touches
// it: this class owns it.
//
//   - `prepare` is the admission of a run: a refresh at most every
//     ROUTINE_CONSENT_RENEW_MS, one flight per principal; within the window
//     a cached access token with at least 10 minutes left is reused;
//   - a refusal (`invalid_grant`, a role that no longer signs in) drops the
//     grant and ends the person's routines (`onEnded`), a transient failure
//     keeps it and only skips the run;
//   - no token ever reaches a log line, an error or the wire.
import { randomUUID } from "node:crypto";

import {
  IDP_REFRESH_WAIT_MS,
  IDP_SUBJECT_MIN_LIFE_MS,
  isSessionGrant,
  perspicaxRoleOf,
  settledWithin,
  type IdpGrant,
  type IdpGrantVault,
  type IdpPrincipalStore,
  type IdpRelyingParty,
  type SubjectTokenOutcome,
} from "./idp-session.ts";
import { orgRoleForRole } from "./oidc-login.ts";
import type { OidcIdentity } from "./oidc-rp.ts";

/** A run renews the delegation at most this often (D6). */
export const ROUTINE_CONSENT_RENEW_MS = 600_000;
/** Perspicax keeps a delegation this long after its last renewal. */
export const ROUTINE_CONSENT_LIFE_MS = 30 * 86_400_000;
/** The directory may end a delegation only if it was created this long
 * before the fetch started (a consent racing a poll is not undone). */
export const ROUTINE_CONSENT_RECONCILE_SLACK_MS = 5_000;

export type RoutineConsentEnd = "delegation_ended" | "delegation_revoked" | "person_out";

export type RoutineConsentStatus =
  | { state: "active"; consentedAt: number; renewedAt: number; expiresAt: number }
  | { state: "none" };

export type RoutineConsentPrepare = { ok: true } | { ok: false; error: "missing" | "ended" | "unreachable" };

export interface RoutineConsentsOptions {
  vault: IdpGrantVault;
  rp: IdpRelyingParty;
  principals: Pick<IdpPrincipalStore, "forSubject" | "bySubject">;
  now?: () => number;
  log?: (line: string) => void;
  /** The person's routines stop (suspendFor, forget MCP entries, audit). */
  onEnded?: (principalId: string, reason: RoutineConsentEnd) => void;
  /** The person consented: their suspended routines resume. */
  onActive?: (principalId: string) => void;
}

type RefreshResult = "ok" | "ended" | "unreachable";

export class RoutineConsents {
  private readonly vault: IdpGrantVault;
  private readonly rp: IdpRelyingParty;
  private readonly principals: RoutineConsentsOptions["principals"];
  private readonly now: () => number;
  private readonly log: (line: string) => void;
  private readonly onEnded: (principalId: string, reason: RoutineConsentEnd) => void;
  private readonly onActive: (principalId: string) => void;
  /** principalId -> the latest access token (memory only). */
  private readonly access = new Map<string, { token: string; expiresAt: number }>();
  /** principalId -> the refresh in flight. */
  private readonly inflight = new Map<string, Promise<RefreshResult>>();
  /** Principals whose reuse window was dropped (an exchange refused the
   * cached subject): the next prepare refreshes at once. */
  private readonly stale = new Set<string>();

  constructor(options: RoutineConsentsOptions) {
    this.vault = options.vault;
    this.rp = options.rp;
    this.principals = options.principals;
    this.now = options.now ?? Date.now;
    this.log = options.log ?? ((line) => console.warn(line));
    this.onEnded = options.onEnded ?? (() => {});
    this.onActive = options.onActive ?? (() => {});
  }

  /** Null when delegations can be kept. */
  unavailableReason(): string | null {
    return this.vault.unavailableReason();
  }

  private grantOf(principalId: string): IdpGrant | undefined {
    return this.vault.list().find((grant) => !isSessionGrant(grant) && grant.principalId === principalId);
  }

  private safeGrantOf(principalId: string): IdpGrant | undefined | null {
    try {
      return this.grantOf(principalId);
    } catch {
      return null;
    }
  }

  status(principalId: string): RoutineConsentStatus {
    const grant = this.safeGrantOf(principalId);
    if (!grant) return { state: "none" };
    return { state: "active", consentedAt: grant.createdAt, renewedAt: grant.lastOkAt, expiresAt: grant.lastOkAt + ROUTINE_CONSENT_LIFE_MS };
  }

  /** The principals holding a delegation now. */
  principalsWithConsent(): string[] {
    try {
      return this.vault.list().filter((grant) => !isSessionGrant(grant) && grant.principalId).map((grant) => grant.principalId!);
    } catch {
      return [];
    }
  }

  /** Keep a fresh consent; the previous one of that person is revoked at
   * the provider and dropped. Throws when the vault is unavailable. */
  create(input: { principalId: string; iss: string; sub: string; refreshToken: string; accessToken?: string; accessExpiresAt?: number }): void {
    const previous = this.grantOf(input.principalId);
    const now = this.now();
    this.vault.set({
      grantRef: randomUUID(), iss: input.iss, sub: input.sub, refreshToken: input.refreshToken,
      createdAt: now, refreshedAt: now, lastOkAt: now, kind: "routines", principalId: input.principalId,
    });
    if (previous) {
      this.safeDelete(previous.grantRef);
      this.revokeAtProvider(previous.refreshToken, "replaced");
    }
    this.stale.delete(input.principalId);
    if (input.accessToken && input.accessExpiresAt !== undefined) this.access.set(input.principalId, { token: input.accessToken, expiresAt: input.accessExpiresAt });
    else this.access.delete(input.principalId);
    this.onActive(input.principalId);
  }

  /** The admission of a run: renews the delegation when due. Never throws. */
  async prepare(principalId: string): Promise<RoutineConsentPrepare> {
    const grant = this.safeGrantOf(principalId);
    if (grant === null) return { ok: false, error: "unreachable" };
    if (!grant) return { ok: false, error: "missing" };
    if (!this.stale.has(principalId) && this.now() - grant.refreshedAt < ROUTINE_CONSENT_RENEW_MS && this.usable(principalId)) return { ok: true };
    const result = await this.refreshWithin(principalId, grant);
    if (result === "ok") return { ok: true };
    return { ok: false, error: result === "ended" ? "ended" : "unreachable" };
  }

  /** The delegation's access token, the subject of a token exchange for the
   * routine's Perspicax tools (slice 5 shape). */
  async subjectToken(principalId: string): Promise<SubjectTokenOutcome> {
    const grant = this.safeGrantOf(principalId);
    if (grant === null) return { ok: false, error: "unreachable" };
    if (!grant) return { ok: false, error: "no_session" };
    const cached = this.stale.has(principalId) ? undefined : this.usable(principalId);
    if (cached) return { ok: true, token: cached.token, expiresAt: cached.expiresAt };
    const result = await this.refreshWithin(principalId, grant);
    if (result === "ended") return { ok: false, error: "ended" };
    const renewed = this.usable(principalId);
    if (result === "ok" && renewed) return { ok: true, token: renewed.token, expiresAt: renewed.expiresAt };
    return { ok: false, error: "unreachable" };
  }

  /** Forget the cached access token and the reuse window: the next prepare
   * or subjectToken refreshes (an exchange refused the cached subject). */
  dropCache(principalId: string): void {
    this.access.delete(principalId);
    this.stale.add(principalId);
  }

  /** The person withdraws the permission from Sagax. */
  revoke(principalId: string): boolean {
    const grant = this.safeGrantOf(principalId);
    if (!grant) return false;
    this.safeDelete(grant.grantRef);
    this.forget(principalId);
    this.revokeAtProvider(grant.refreshToken, "revoked");
    this.onEnded(principalId, "delegation_revoked");
    return true;
  }

  /** Perspicax put the person out (back-channel logout, a directory disable):
   * the provider already ended the family, no call. */
  endForSubject(iss: string, sub: string): number {
    let grants: IdpGrant[];
    try {
      grants = this.vault.list().filter((grant) => !isSessionGrant(grant) && grant.iss === iss && grant.sub === sub);
    } catch {
      return 0;
    }
    for (const grant of grants) {
      this.safeDelete(grant.grantRef);
      if (grant.principalId) {
        this.forget(grant.principalId);
        this.onEnded(grant.principalId, "person_out");
      }
    }
    return grants.length;
  }

  /** The directory reported each person's delegation: `false` (null in the
   * directory) ends ours, if it is older than the fetch; `undefined` (an
   * older Perspicax without the field) never ends anything. */
  reconcile(present: (sub: string) => boolean | undefined, fetchStartedAt: number): number {
    let grants: IdpGrant[];
    try {
      grants = this.vault.list().filter((grant) => !isSessionGrant(grant));
    } catch {
      return 0;
    }
    let ended = 0;
    for (const grant of grants) {
      if (present(grant.sub) !== false) continue;
      if (grant.createdAt >= fetchStartedAt - ROUTINE_CONSENT_RECONCILE_SLACK_MS) continue;
      if (this.inflight.has(grant.principalId ?? "")) continue;
      this.safeDelete(grant.grantRef);
      if (grant.principalId) {
        this.forget(grant.principalId);
        this.onEnded(grant.principalId, "delegation_ended");
      }
      ended += 1;
    }
    return ended;
  }

  /** For tests: the refresh in flight. */
  settled(principalId?: string): Promise<void> {
    const flights = principalId ? [this.inflight.get(principalId)].filter(Boolean) : [...this.inflight.values()];
    return Promise.all(flights).then(() => {});
  }

  private usable(principalId: string): { token: string; expiresAt: number } | undefined {
    const cached = this.access.get(principalId);
    return cached && cached.expiresAt - this.now() >= IDP_SUBJECT_MIN_LIFE_MS ? cached : undefined;
  }

  private forget(principalId: string): void {
    this.access.delete(principalId);
    this.stale.delete(principalId);
  }

  /** Join or start the single flight, waiting at most IDP_REFRESH_WAIT_MS. */
  private async refreshWithin(principalId: string, grant: IdpGrant): Promise<RefreshResult> {
    let flight = this.inflight.get(principalId);
    if (!flight) {
      flight = this.refresh(principalId, grant.grantRef).catch((error: unknown) => {
        this.log(`routine delegation: refresh failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
        return "unreachable" as const;
      }).finally(() => this.inflight.delete(principalId));
      this.inflight.set(principalId, flight);
    }
    let result: RefreshResult = "unreachable";
    await settledWithin(flight.then((value) => { result = value; }), IDP_REFRESH_WAIT_MS);
    return result;
  }

  private async refresh(principalId: string, ref: string): Promise<RefreshResult> {
    const grant = this.vault.get(ref);
    if (!grant) return "ended";
    const outcome = await this.rp.refresh(grant.refreshToken, { sub: grant.sub });
    let current: IdpGrant | undefined;
    try {
      current = this.vault.get(ref);
    } catch {
      current = undefined;
    }
    if (outcome.ok) {
      if (!current) {
        // Revoked or ended while the refresh was out: the rotated token must
        // not outlive it.
        this.revokeAtProvider(outcome.refreshToken, "ended during a refresh");
        return "ended";
      }
      const now = this.now();
      const next: IdpGrant = { ...current, refreshToken: outcome.refreshToken, refreshedAt: now, lastOkAt: now };
      delete next.failedAt;
      delete next.failingSince;
      // The rotated token is persisted first: the old one is dead.
      try {
        this.vault.set(next);
      } catch (error) {
        this.log(`routine delegation: could not keep a rotated grant: ${error instanceof Error ? error.message : String(error)}`);
        this.revokeAtProvider(outcome.refreshToken, "unkept");
        this.end(principalId, ref, "the rotated grant could not be kept");
        return "ended";
      }
      this.stale.delete(principalId);
      if (outcome.accessToken) this.access.set(principalId, { token: outcome.accessToken, expiresAt: now + (outcome.expiresIn ?? 3600) * 1000 });
      if (outcome.identity && !this.applyIdentity(next, outcome.identity)) {
        this.revokeAtProvider(outcome.refreshToken, "role gone");
        this.end(principalId, ref, "the role no longer signs in");
        return "ended";
      }
      return "ok";
    }
    if (!current) return "ended";
    if (outcome.kind === "rejected") {
      this.end(principalId, ref, outcome.error);
      return "ended";
    }
    const now = this.now();
    try {
      this.vault.set({ ...current, failedAt: now, failingSince: current.failingSince ?? now });
    } catch {
      /* nothing to keep */
    }
    this.log(`routine delegation: renewal deferred (${outcome.error}); the run is skipped, the permission kept`);
    return "unreachable";
  }

  /** The refreshed claims flow into the person. False: the role no longer signs in. */
  private applyIdentity(grant: IdpGrant, identity: OidcIdentity): boolean {
    const orgRole = orgRoleForRole(identity.role);
    if (!orgRole) return false;
    this.principals.forSubject({
      iss: grant.iss,
      sub: grant.sub,
      claims: { email: identity.email, name: identity.name, login: identity.preferredUsername },
      orgRole,
      ...(identity.teams ? { teams: identity.teams.map(({ id, manager }) => ({ id, manager })) } : {}),
      ...(perspicaxRoleOf(identity.role) ? { perspicaxRole: perspicaxRoleOf(identity.role) } : {}),
    });
    return true;
  }

  private end(principalId: string, ref: string, why: string): void {
    this.safeDelete(ref);
    this.forget(principalId);
    this.log(`routine delegation: ended (${why})`);
    this.onEnded(principalId, "delegation_ended");
  }

  private safeDelete(grantRef: string): void {
    try {
      this.vault.delete(grantRef);
    } catch (error) {
      this.log(`routine delegation: could not drop a grant: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private revokeAtProvider(refreshToken: string, why: string): void {
    void this.rp.revokeToken(refreshToken, "refresh_token").then((ok) => {
      if (!ok) this.log(`routine delegation: revoking a grant (${why}) at the provider did not succeed; it expires on its own`);
    }, () => {});
  }
}
