// The identity provider grants behind "Sign in with Pulsatrix" sessions
// (slice 2): the sealed vault, refresh on use, the unreachable grace, role
// changes, release on revoke, the sweep and back-channel logout. The
// provider is a scripted stand-in; the session and principal stores are the
// real ones on a temp dir.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_REFRESH_AFTER_SECONDS,
  IDP_KEY_FILE,
  IDP_RETRY_AFTER_FAILURE_MS,
  IDP_SWEEP_INTERVAL_MS,
  IDP_SWEEP_SLACK_MS,
  IDP_UNREACHABLE_GRACE_MS,
  IDP_VAULT_FILE,
  IdpGrantVault,
  IdpSessionManager,
  refreshAfterMs,
  resolveIdpVaultKey,
  type IdpRelyingParty,
} from "./idp-session.ts";
import type { RefreshOutcome } from "./oidc-rp.ts";
import { PrincipalRegistry } from "./principals.ts";
import { SessionRegistry, type Scope } from "./sessions.ts";

const ISS = "https://px.example.test";
const KEY = "a".repeat(64);
let dir: string;
let clock: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "omb-idp-"));
  clock = 1_800_000_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the grant vault", () => {
  it("round-trips grants sealed, and removes the file when empty", () => {
    const vault = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    vault.set({ grantRef: "g1", iss: ISS, sub: "S", refreshToken: "pxlr1.secret", createdAt: 1, refreshedAt: 1, lastOkAt: 1 });
    const raw = readFileSync(join(dir, IDP_VAULT_FILE), "utf8");
    expect(raw).not.toContain("pxlr1.secret");
    if (process.platform !== "win32") expect(statSync(join(dir, IDP_VAULT_FILE)).mode & 0o777).toBe(0o600);
    const reread = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    expect(reread.get("g1")).toMatchObject({ sub: "S", refreshToken: "pxlr1.secret" });
    expect(reread.list()).toHaveLength(1);
    expect(reread.delete("g1")).toBe(true);
    expect(existsSync(join(dir, IDP_VAULT_FILE))).toBe(false);
  });

  it("never overwrites a file it cannot read", () => {
    const vault = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    vault.set({ grantRef: "g1", iss: ISS, sub: "S", refreshToken: "t", createdAt: 1, refreshedAt: 1, lastOkAt: 1 });
    const before = readFileSync(join(dir, IDP_VAULT_FILE), "utf8");
    const wrong = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from("b".repeat(64), "hex") }));
    expect(wrong.unavailableReason()).toMatch(/decrypted/);
    expect(wrong.list()).toEqual([]);
    expect(() => wrong.set({ grantRef: "g2", iss: ISS, sub: "S", refreshToken: "t", createdAt: 1, refreshedAt: 1, lastOkAt: 1 })).toThrow();
    expect(readFileSync(join(dir, IDP_VAULT_FILE), "utf8")).toBe(before);
    writeFileSync(join(dir, IDP_VAULT_FILE), "garbage");
    const damaged = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
    expect(damaged.unavailableReason()).not.toBeNull();
    expect(() => damaged.delete("g1")).toThrow();
    expect(readFileSync(join(dir, IDP_VAULT_FILE), "utf8")).toBe("garbage");
  });

  it("takes its key from OMB_IDP_VAULT_KEY, OMB_IDP_VAULT_KEY_FILE or a 0600 file beside the data", () => {
    expect(resolveIdpVaultKey(dir, { OMB_IDP_VAULT_KEY: KEY.toUpperCase() })).toEqual({ kind: "key", key: Buffer.from(KEY, "hex") });
    expect(resolveIdpVaultKey(dir, { OMB_IDP_VAULT_KEY: "short" }).kind).toBe("unavailable");
    expect(resolveIdpVaultKey(dir, { OMB_DESKTOP_PARENT: "1" }).kind).toBe("unavailable");
    const keyFile = join(dir, "elsewhere", "grants.key");
    const fromFile = resolveIdpVaultKey(dir, { OMB_IDP_VAULT_KEY_FILE: keyFile });
    expect(fromFile.kind).toBe("key");
    expect(readFileSync(keyFile, "utf8").trim()).toMatch(/^[0-9a-f]{64}$/);
    writeFileSync(keyFile, "not a key");
    expect(resolveIdpVaultKey(dir, { OMB_IDP_VAULT_KEY_FILE: keyFile }).kind).toBe("unavailable");
    const first = resolveIdpVaultKey(dir, {});
    const second = resolveIdpVaultKey(dir, {});
    expect(first).toEqual(second);
    if (process.platform !== "win32") expect(statSync(join(dir, IDP_KEY_FILE)).mode & 0o777).toBe(0o600);
  });

  it("reads OMB_OIDC_REFRESH_AFTER_SECONDS as 1 to 3000, else the default", () => {
    expect(refreshAfterMs(undefined)).toBe(DEFAULT_REFRESH_AFTER_SECONDS * 1000);
    expect(refreshAfterMs("1")).toBe(1000);
    expect(refreshAfterMs("3000")).toBe(3_000_000);
    for (const bad of ["0", "3001", "1.5", "abc", "", "-4"]) expect(refreshAfterMs(bad)).toBe(3_000_000);
  });
});

/** A provider stand-in: each refresh answers the next scripted outcome. */
function scriptedProvider() {
  const script: Array<RefreshOutcome | Promise<RefreshOutcome>> = [];
  const calls: string[] = [];
  const revoked: string[] = [];
  let n = 0;
  const rp: IdpRelyingParty = {
    refresh: async (token) => {
      calls.push(token);
      const next = script.shift();
      return next ?? { ok: true, refreshToken: `pxlr1.rot${++n}` };
    },
    revokeToken: async (token) => { revoked.push(token); return true; },
  };
  return { rp, script, calls, revoked };
}

function setup(options: { refreshAfterMs?: number } = {}) {
  const provider = scriptedProvider();
  const sessions = new SessionRegistry({ file: join(dir, "sessions.json"), now: () => clock });
  let id = 0;
  const principals = new PrincipalRegistry({ path: join(dir, "principals.json"), now: () => clock, newId: () => `pr_00000000-0000-4000-8000-${String(++id).padStart(12, "0")}` });
  const vault = new IdpGrantVault(dir, () => ({ kind: "key", key: Buffer.from(KEY, "hex") }));
  const logs: string[] = [];
  const timers: Array<{ run: () => void; at: number }> = [];
  const manager = new IdpSessionManager({ vault, rp: provider.rp, sessions, principals, now: () => clock, refreshAfterMs: options.refreshAfterMs ?? 3_000_000, log: (l) => logs.push(l), schedule: (run, delayMs) => { timers.push({ run, at: clock + delayMs }); } });
  sessions.onSessionRevoked((sessionId) => manager.release(sessionId, { revokeAtIdp: true }));
  sessions.onExchanged((session) => { if (session.idp?.grantRef) manager.bindSession(session.idp.grantRef, session.id); });
  /** A web sign-in: principal, grant, session bound to it. */
  const signIn = (sub: string, role = "employee", scopes: Scope[] = role === "admin" ? ["admin", "client"] : ["client"]) => {
    const principal = principals.forSubject({ iss: ISS, sub, orgRole: role === "admin" ? "admin" : "member" });
    const grantRef = manager.createGrant({ iss: ISS, sub, refreshToken: `pxlr1.first-${sub}-${clock}`, bindBy: clock + 60_000 });
    const issued = sessions.issue({ label: "web", scopes, principalId: principal.id, idp: { iss: ISS, sub, role, grantRef } });
    manager.bindSession(grantRef, issued.session.id);
    return { principal, grantRef, sessionId: issued.session.id, record: () => sessions.byId(issued.session.id) };
  };
  /** Advance the clock, firing the timers that come due. */
  const advance = (ms: number) => {
    clock += ms;
    for (const timer of timers.splice(0).sort((a, b) => a.at - b.at)) {
      if (timer.at <= clock) timer.run();
      else timers.push(timer);
    }
  };
  return { provider, sessions, principals, vault, manager, signIn, logs, timers, advance };
}

describe("refresh on use", () => {
  it("hands back the refresh in flight, so the request that found it due can wait for the new role", async () => {
    const { manager, provider, signIn, sessions } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S9", "admin");
    await expect(manager.touch(a.record()!)).resolves.toBeUndefined();
    expect(provider.calls).toEqual([]);
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.demoted", identity: { iss: ISS, sub: "S9", role: "employee" } });
    const first = manager.touch(a.record()!);
    expect(manager.touch(a.record()!)).toBe(first); // single flight, the same promise
    await first;
    expect(sessions.byId(a.sessionId)?.scopes).toEqual(["client"]);
  });

  it("does nothing before it is due, then refreshes once in the background and keeps the rotated token", async () => {
    const { manager, provider, vault, signIn } = setup();
    const a = signIn("S1");
    manager.touch(a.record()!);
    await manager.settled();
    expect(provider.calls).toEqual([]);
    clock += 3_000_000;
    manager.touch(a.record()!);
    manager.touch(a.record()!); // single flight
    await manager.settled();
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatch(/^pxlr1\.first-S1/);
    expect(vault.get(a.grantRef)).toMatchObject({ refreshToken: "pxlr1.rot1", refreshedAt: clock, lastOkAt: clock });
    // not due again until another period has passed
    manager.touch(a.record()!);
    await manager.settled();
    expect(provider.calls).toHaveLength(1);
  });

  it("revokes every session of a grant the provider rejects, without calling revoke", async () => {
    const { manager, provider, vault, signIn, sessions } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    const b = signIn("S2");
    clock += 1000;
    provider.script.push({ ok: false, kind: "rejected", error: "invalid_grant" });
    manager.touch(a.record()!);
    await manager.settled();
    expect(sessions.byId(a.sessionId)).toBeNull();
    expect(vault.get(a.grantRef)).toBeUndefined();
    expect(provider.revoked).toEqual([]);
    expect(sessions.byId(b.sessionId)).not.toBeNull();
  });

  it("a rejected refresh puts the person out: their paired devices, other sign-ins and open codes end, even without a back-channel push", async () => {
    const { manager, provider, vault, signIn, sessions, principals } = setup({ refreshAfterMs: 1000 });
    const bob = signIn("B1");
    clock += 1;
    const bobWeb2 = signIn("B1");
    const otherToken = vault.get(bobWeb2.grantRef)!.refreshToken;
    // a phone Bob paired himself from the web: principal-bound, no grant of its own
    const phone = sessions.issue({ label: "phone", scopes: ["client"], principalId: bob.principal.id });
    sessions.openPairing({ principalId: bob.principal.id, scopes: ["client"] });
    const alice = signIn("A1", "admin");
    clock += 1000;
    provider.script.push({ ok: false, kind: "rejected", error: "invalid_grant" });
    manager.touch(bob.record()!);
    await manager.settled();
    for (const id of [bob.sessionId, bobWeb2.sessionId, phone.session.id]) expect(sessions.byId(id)).toBeNull();
    expect(vault.get(bob.grantRef)).toBeUndefined();
    expect(vault.get(bobWeb2.grantRef)).toBeUndefined();
    expect(sessions.openPairings()).toHaveLength(0);
    expect(principals.byId(bob.principal.id)?.disabledAt).toBe(clock);
    await new Promise((resolve) => setImmediate(resolve));
    // the rejected grant is dead; the other one may still be live at the provider
    expect(provider.revoked).toEqual([otherToken]);
    expect(sessions.byId(alice.sessionId)).not.toBeNull();
    expect(principals.byId(alice.principal.id)?.disabledAt).toBeUndefined();
  });

  it("a rotated grant that cannot be kept ends only its own session, not the person", async () => {
    const { manager, vault, signIn, sessions, principals } = setup({ refreshAfterMs: 1000 });
    const bob = signIn("B1");
    const phone = sessions.issue({ label: "phone", scopes: ["client"], principalId: bob.principal.id });
    clock += 1000;
    const set = vault.set.bind(vault);
    vault.set = () => { throw new Error("disk full"); };
    manager.touch(bob.record()!);
    await manager.settled();
    vault.set = set;
    expect(sessions.byId(bob.sessionId)).toBeNull();
    expect(sessions.byId(phone.session.id)).not.toBeNull();
    expect(principals.byId(bob.principal.id)?.disabledAt).toBeUndefined();
  });

  it("keeps the session on a transient failure, waits a minute, and ends it after 24 hours without success", async () => {
    const { manager, provider, vault, signIn, sessions } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    clock += 1000;
    provider.script.push({ ok: false, kind: "transient", error: "HTTP 503" });
    manager.touch(a.record()!);
    await manager.settled();
    expect(sessions.byId(a.sessionId)).not.toBeNull();
    expect(vault.get(a.grantRef)).toMatchObject({ failedAt: clock, failingSince: clock });
    expect(manager.mustRefuse(a.record()!)).toBeNull();
    // no new attempt inside the minute
    clock += IDP_RETRY_AFTER_FAILURE_MS - 1;
    manager.touch(a.record()!);
    await manager.settled();
    expect(provider.calls).toHaveLength(1);
    // failing for a day ends it
    const since = vault.get(a.grantRef)!.failingSince!;
    for (let i = 0; i < 3; i++) {
      clock += IDP_RETRY_AFTER_FAILURE_MS;
      provider.script.push({ ok: false, kind: "transient", error: "timeout" });
      manager.touch(a.record()!);
      await manager.settled();
    }
    expect(vault.get(a.grantRef)!.failingSince).toBe(since);
    clock = since + IDP_UNREACHABLE_GRACE_MS;
    expect(manager.mustRefuse(a.record()!)).toBe("idp_unreachable");
    // a success in between clears the failure
    const b = signIn("S2");
    clock += 1000;
    provider.script.push({ ok: false, kind: "transient", error: "timeout" });
    manager.touch(b.record()!);
    await manager.settled();
    clock += IDP_RETRY_AFTER_FAILURE_MS;
    manager.touch(b.record()!);
    await manager.settled();
    expect(vault.get(b.grantRef)!.failingSince).toBeUndefined();
    clock += IDP_UNREACHABLE_GRACE_MS;
    expect(manager.mustRefuse(b.record()!)).toBeNull();
  });

  it("refuses a provider session with no grant", () => {
    const { manager, sessions, vault, signIn } = setup();
    const a = signIn("S1");
    vault.delete(a.grantRef);
    expect(manager.mustRefuse(a.record()!)).toBe("idp_session_ended");
    const legacy = sessions.issue({ label: "slice 1", scopes: ["client"], idp: { iss: ISS, sub: "S9" } });
    expect(manager.mustRefuse(sessions.byId(legacy.session.id)!)).toBe("idp_session_ended");
    const paired = sessions.issue({ label: "phone", scopes: ["client"] });
    expect(manager.mustRefuse(sessions.byId(paired.session.id)!)).toBeNull();
  });

  it("a device paired from a signed-in session follows its person's live grants, and ends with the last one", async () => {
    const { manager, sessions, signIn } = setup();
    const web = signIn("P1", "admin");
    const phone = sessions.issue({ label: "phone", scopes: ["admin", "client"], principalId: web.principal.id, idp: { iss: ISS, sub: "P1" } });
    const record = () => sessions.byId(phone.session.id)!;
    expect(manager.mustRefuse(record())).toBeNull();
    // an unbound grant (a native sign-in not yet exchanged) does not keep it
    manager.createGrant({ iss: ISS, sub: "P1", refreshToken: "pxlr1.unbound", bindBy: clock + 60_000 });
    sessions.revoke(web.sessionId);
    expect(manager.mustRefuse(record())).toBe("idp_session_ended");
    // another person's live grant does not either
    signIn("P2");
    expect(manager.mustRefuse(record())).toBe("idp_session_ended");
  });

  it("a device with no grant of its own is refused as unreachable when every grant of its person is past the grace", async () => {
    const { manager, sessions, vault, signIn } = setup();
    const web = signIn("P1");
    const phone = sessions.issue({ label: "phone", scopes: ["client"], principalId: web.principal.id, idp: { iss: ISS, sub: "P1" } });
    vault.set({ ...vault.get(web.grantRef)!, failingSince: clock });
    clock += IDP_UNREACHABLE_GRACE_MS;
    expect(manager.mustRefuse(sessions.byId(phone.session.id)!)).toBe("idp_unreachable");
    const web2 = signIn("P1");
    expect(manager.mustRefuse(sessions.byId(phone.session.id)!)).toBeNull();
    expect(web2.grantRef).toBeTruthy();
  });

  it("a device with no grant of its own refreshes its person's freshest grant: a demotion narrows it, a refusal ends it", async () => {
    const { manager, provider, sessions, vault, signIn } = setup({ refreshAfterMs: 1000 });
    const older = signIn("P1", "admin");
    clock += 10;
    const newer = signIn("P1", "admin");
    const phone = sessions.issue({ label: "phone", scopes: ["admin", "client"], principalId: older.principal.id, idp: { iss: ISS, sub: "P1" } });
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.demoted", identity: { iss: ISS, sub: "P1", role: "employee" } });
    manager.touch(sessions.byId(phone.session.id)!);
    await manager.settled();
    expect(provider.calls).toEqual([`pxlr1.first-P1-${clock - 1000}`]);
    expect(vault.get(newer.grantRef)!.refreshToken).toBe("pxlr1.demoted");
    expect(sessions.byId(phone.session.id)!.scopes).toEqual(["client"]);
    clock += 1000;
    provider.script.push({ ok: false, kind: "rejected", error: "invalid_grant" });
    manager.touch(sessions.byId(phone.session.id)!);
    await manager.settled();
    expect(sessions.byId(phone.session.id)).toBeNull();
    expect(sessions.byId(older.sessionId)).toBeNull();
  });

  it("clamps a device with no grant of its own to its person's organization role", () => {
    const { manager, sessions, signIn } = setup();
    const web = signIn("P1", "admin");
    const phone = sessions.issue({ label: "phone", scopes: ["admin", "client"], principalId: web.principal.id, idp: { iss: ISS, sub: "P1" } });
    const record = sessions.byId(phone.session.id)!;
    expect(manager.clampScopes(record, "admin")).toBeNull();
    expect(manager.clampScopes(record, "member")).toEqual(["client"]);
    expect(manager.clampScopes(record, undefined)).toEqual(["client"]);
    // a session on its own grant follows its refresh instead
    expect(manager.clampScopes(web.record()!, "member")).toBeNull();
  });

  it("follows a role change: the grant's sessions take the new scopes, the person's other devices only narrow", async () => {
    const { manager, provider, signIn, sessions, principals } = setup({ refreshAfterMs: 1000 });
    const carol = signIn("C1", "admin");
    // a phone Carol paired with an admin code, and a chat-only one
    const phone = sessions.issue({ label: "phone", scopes: ["admin", "client"], principalId: carol.principal.id });
    const chat = sessions.issue({ label: "chat", scopes: ["client"], principalId: carol.principal.id });
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.r", identity: { iss: ISS, sub: "C1", role: "employee", name: "Carol" } });
    manager.touch(carol.record()!);
    await manager.settled();
    expect(carol.record()).toMatchObject({ scopes: ["client"], idp: { role: "employee" } });
    expect(sessions.byId(phone.session.id)!.scopes).toEqual(["client"]);
    expect(sessions.byId(chat.session.id)!.scopes).toEqual(["client"]);
    expect(principals.byId(carol.principal.id)).toMatchObject({ orgRole: "member", name: "Carol" });
    // promoted again: the grant's own session widens, the others do not
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.r2", identity: { iss: ISS, sub: "C1", role: "admin" } });
    manager.touch(carol.record()!);
    await manager.settled();
    expect(carol.record()!.scopes).toEqual(["admin", "client"]);
    expect(sessions.byId(phone.session.id)!.scopes).toEqual(["client"]);
    // a role that no longer signs in ends the grant
    clock += 1000;
    provider.script.push({ ok: true, refreshToken: "pxlr1.r3", identity: { iss: ISS, sub: "C1", role: "service" } });
    manager.touch(carol.record()!);
    await manager.settled();
    expect(carol.record()).toBeNull();
  });

  it("revokes a rotated token that arrives after the session was released", async () => {
    const { manager, provider, signIn, sessions } = setup({ refreshAfterMs: 1000 });
    const a = signIn("S1");
    clock += 1000;
    let answer!: (value: RefreshOutcome) => void;
    provider.script.push(new Promise<RefreshOutcome>((resolve) => { answer = resolve; }));
    manager.touch(a.record()!);
    sessions.revoke(a.sessionId);
    expect(provider.revoked).toHaveLength(1); // the grant went with the session
    answer({ ok: true, refreshToken: "pxlr1.late" });
    await manager.settled();
    expect(provider.revoked).toContain("pxlr1.late");
  });
});

describe("release, sweep and back-channel logout", () => {
  it("releases a grant once when its session ends (logout, admin revoke, expiry)", async () => {
    const { manager, provider, vault, signIn, sessions } = setup();
    const a = signIn("S1");
    sessions.revoke(a.sessionId);
    sessions.revoke(a.sessionId);
    await manager.settled();
    expect(provider.revoked).toEqual([expect.stringMatching(/^pxlr1\.first-S1/)]);
    expect(vault.get(a.grantRef)).toBeUndefined();
    const b = signIn("S2");
    clock += 31 * 24 * 60 * 60_000; // past the session term
    sessions.list(); // prune
    expect(vault.get(b.grantRef)).toBeUndefined();
    expect(provider.revoked).toHaveLength(2);
  });

  it("sweeps an unredeemed desktop or phone grant after its window, and one whose session is gone", () => {
    const { manager, provider, vault, sessions, principals, signIn } = setup();
    const p = principals.forSubject({ iss: ISS, sub: "D1", orgRole: "member" });
    const pending = manager.createGrant({ iss: ISS, sub: "D1", refreshToken: "pxlr1.pending", bindBy: clock + 180_000 });
    const redeemed = manager.createGrant({ iss: ISS, sub: "D1", refreshToken: "pxlr1.redeemed", bindBy: clock + 180_000 });
    const pairing = sessions.openPairing({ principalId: p.id, scopes: ["client"], ttlMs: 120_000, idp: { iss: ISS, sub: "D1", role: "employee", grantRef: redeemed } });
    const exchanged = sessions.exchange({ code: pairing.credential, label: "desktop", source: "x" });
    expect(exchanged.ok).toBe(true);
    expect(vault.get(redeemed)?.sessionId).toBe(exchanged.ok ? exchanged.session.id : "");
    const web = signIn("W1");
    expect(manager.sweep()).toBe(0);
    clock += 180_001;
    expect(manager.sweep()).toBe(1);
    expect(vault.get(pending)).toBeUndefined();
    expect(provider.revoked).toEqual(["pxlr1.pending"]);
    // an orphan: its session vanished without the listener (unclean restart)
    const orphanVault = vault.get(web.grantRef)!;
    vault.set({ ...orphanVault, sessionId: "gone" });
    expect(manager.sweep()).toBe(1);
    expect(provider.revoked).toContain(orphanVault.refreshToken);
    expect(vault.get(redeemed)).toBeDefined();
  });

  it("revokes an unredeemed native grant at the provider as soon as its window closes, not at the next periodic sweep", async () => {
    const { manager, provider, vault, advance } = setup();
    // a desktop sign-in: 120 s credential plus the bind grace
    const pending = manager.createGrant({ iss: ISS, sub: "D2", refreshToken: "pxlr1.never-redeemed", bindBy: clock + 180_000 });
    advance(180_000);
    expect(vault.get(pending)).toBeDefined();
    advance(IDP_SWEEP_SLACK_MS);
    expect(vault.get(pending)).toBeUndefined();
    await manager.settled();
    expect(provider.revoked).toEqual(["pxlr1.never-redeemed"]);
    // the periodic backstop (a restart lost the timer) is at most a minute late
    expect(IDP_SWEEP_INTERVAL_MS).toBeLessThanOrEqual(60_000);
  });

  it("back-channel logout revokes by subject and by principal, drops grants silently, cancels codes and marks the person out", async () => {
    const { manager, provider, vault, sessions, principals, signIn } = setup();
    const bob = signIn("B1");
    const bob2 = signIn("B1");
    const bobPhone = sessions.issue({ label: "phone", scopes: ["client"], principalId: bob.principal.id });
    const unbound = manager.createGrant({ iss: ISS, sub: "B1", refreshToken: "pxlr1.unbound", bindBy: clock + 180_000 });
    sessions.openPairing({ principalId: bob.principal.id, scopes: ["client"] });
    const alice = signIn("A1", "admin");
    const done = manager.backchannelLogout({ iss: ISS, sub: "B1" });
    expect(done).toEqual({ sessions: 3, pairings: 1 });
    for (const id of [bob.sessionId, bob2.sessionId, bobPhone.session.id]) expect(sessions.byId(id)).toBeNull();
    expect(vault.get(bob.grantRef)).toBeUndefined();
    expect(vault.get(unbound)).toBeUndefined();
    await manager.settled();
    expect(provider.revoked).toEqual([]);
    expect(sessions.openPairings()).toHaveLength(0);
    expect(principals.byId(bob.principal.id)?.disabledAt).toBe(clock);
    expect(sessions.byId(alice.sessionId)).not.toBeNull();
    // an unknown subject: nothing happens
    expect(manager.backchannelLogout({ iss: ISS, sub: "nobody" })).toEqual({ sessions: 0, pairings: 0 });
    // signing in again clears the mark, same person
    const back = signIn("B1");
    expect(back.principal.id).toBe(bob.principal.id);
    expect(principals.byId(bob.principal.id)?.disabledAt).toBeUndefined();
  });
});
