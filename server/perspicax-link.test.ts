// The link file Perspicax writes, and the directory it opens (slice 3, PB1).
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { directoryIntervalMs, PerspicaxDirectory, readLinkFile, type Directory } from "./perspicax-link.ts";
import { PrincipalRegistry } from "./principals.ts";

const ISSUER = "https://px.example.test";
const ORIGIN = "https://bot.example.test";
const EXPECT = { issuer: ISSUER, publicOrigin: ORIGIN, clientId: "pulsa-bot" };
const SERVER_ID = "01j9s3server0000000000000a";
const TOKEN_A = `pxat1.${"a".repeat(43)}`;
const TOKEN_B = `pxat1.${"b".repeat(43)}`;

function linkDoc(patch: Record<string, unknown> = {}) {
  return { version: 1, issuer: ISSUER, client_id: "pulsa-bot", server_id: SERVER_ID, origin: ORIGIN, link_token: TOKEN_A, ...patch };
}

function writeLink(path: string, doc: unknown, mode = 0o640) {
  writeFileSync(path, typeof doc === "string" ? doc : JSON.stringify(doc));
  chmodSync(path, mode);
}

function tempDir() {
  return mkdtempSync(join(tmpdir(), "px-link-"));
}

describe("readLinkFile", () => {
  it("accepts 0640 and 0600 files that match this server", () => {
    const dir = tempDir();
    const path = join(dir, "pulsabot.json");
    writeLink(path, linkDoc(), 0o640);
    expect(readLinkFile(path, EXPECT)).toMatchObject({ ok: true, link: { serverId: SERVER_ID, linkToken: TOKEN_A, clientId: "pulsa-bot" } });
    chmodSync(path, 0o600);
    expect(readLinkFile(path, EXPECT).ok).toBe(true);
    // a trailing slash on the configured issuer is the same issuer
    expect(readLinkFile(path, { ...EXPECT, issuer: `${ISSUER}/` }).ok).toBe(true);
  });

  it("refuses a file other users can read, a missing file, an oversized file", () => {
    const dir = tempDir();
    const path = join(dir, "pulsabot.json");
    expect(readLinkFile(path, EXPECT)).toMatchObject({ ok: false, code: "missing" });
    writeLink(path, linkDoc(), 0o644);
    expect(readLinkFile(path, EXPECT)).toMatchObject({ ok: false, code: "mode" });
    writeLink(path, JSON.stringify({ ...linkDoc(), pad: "x".repeat(5000) }), 0o600);
    expect(readLinkFile(path, EXPECT)).toMatchObject({ ok: false, code: "size" });
  });

  it("refuses mismatched fields, extra keys and a bad token, and never echoes the token", () => {
    const dir = tempDir();
    const path = join(dir, "pulsabot.json");
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ issuer: "https://other.example.test" }, "mismatch"],
      [{ origin: "https://elsewhere.example.test" }, "mismatch"],
      [{ client_id: "other" }, "mismatch"],
      [{ version: 2 }, "fields"],
      [{ link_token: "pxat1.short" }, "fields"],
      [{ link_token: "pxlo1.aaaaaaaaaaaaaaaaaaaaaaaaaaaa" }, "fields"],
      [{ server_id: "NOT A ULID" }, "fields"],
      [{ extra: true }, "fields"],
    ];
    for (const [patch, code] of cases) {
      writeLink(path, linkDoc(patch), 0o600);
      const read = readLinkFile(path, EXPECT);
      expect(read, JSON.stringify(patch)).toMatchObject({ ok: false, code });
      expect(JSON.stringify(read)).not.toContain(TOKEN_A);
    }
    writeLink(path, "not json", 0o600);
    expect(readLinkFile(path, EXPECT)).toMatchObject({ ok: false, code: "json" });
  });
});

describe("OMB_PERSPICAX_DIRECTORY_SECONDS", () => {
  it("defaults to 300 s and takes 5 to 3600", () => {
    expect(directoryIntervalMs(undefined)).toBe(300_000);
    expect(directoryIntervalMs("5")).toBe(5_000);
    expect(directoryIntervalMs("3600")).toBe(3_600_000);
    expect(() => directoryIntervalMs("4")).toThrow();
    expect(() => directoryIntervalMs("1.5")).toThrow();
    expect(() => directoryIntervalMs("3601")).toThrow();
  });
});

type Reply = { status: number; body?: unknown; etag?: string } | "hang" | "throw";

function harness(initial: Directory) {
  const clock = { now: 1_000_000 };
  const dir = tempDir();
  const linkFile = join(dir, "pulsabot.json");
  writeLink(linkFile, linkDoc());
  let n = 0;
  const principals = new PrincipalRegistry({ path: join(dir, "principals.json"), now: () => clock.now, newId: () => `pr_00000000-0000-4000-8000-${String(n++).padStart(12, "0")}` });
  const out: string[] = [];
  const narrowed: string[] = [];
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  let directory = initial;
  let validToken = TOKEN_A;
  const queue: Reply[] = [];
  const keys = new Map<string, { key?: string; status?: number }>();
  const resolveCalls: Array<{ sub: string; provider: string; authorization: string }> = [];
  const teamNames: Array<Array<{ id: string; name: string }>> = [];
  const delegationCalls: Array<{ present: (sub: string) => boolean | undefined; at: number }> = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    if (String(input).endsWith("/api/v1/pulsabot/provider-keys/resolve")) {
      const asked = JSON.parse(String(init?.body)) as { sub: string; provider: string };
      resolveCalls.push({ ...asked, authorization: headers.authorization ?? "" });
      if (headers.authorization !== `Bearer ${validToken}`) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
      const held = keys.get(`${asked.sub}/${asked.provider}`);
      if (held?.status) return new Response(JSON.stringify({ error: held.status === 409 ? "user_inactive" : "x" }), { status: held.status });
      if (!held?.key) return new Response(JSON.stringify({ error: "no_key" }), { status: 404 });
      return new Response(JSON.stringify({ provider: asked.provider, key: held.key, fingerprint: `fp-${held.key.slice(-4)}` }), { status: 200, headers: { "cache-control": "no-store" } });
    }
    requests.push({ url: String(input), headers });
    const next = queue.shift();
    if (next === "throw") throw new Error("connect ECONNREFUSED");
    if (next === "hang") {
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("timed out"))));
    }
    if (next) return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status, headers: next.etag ? { etag: next.etag } : {} });
    if (headers.authorization !== `Bearer ${validToken}`) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    const etag = `"${JSON.stringify(directory).length.toString(16).padStart(32, "0")}"`;
    if (headers["if-none-match"] === etag) return new Response(null, { status: 304, headers: { etag } });
    return new Response(JSON.stringify(directory), { status: 200, headers: { etag, "cache-control": "no-store" } });
  }) as typeof fetch;
  const sync = new PerspicaxDirectory({
    issuer: ISSUER,
    serverBase: "http://perspicax:8787",
    linkFile,
    expect: EXPECT,
    principals,
    onPersonOut: (iss, sub) => { out.push(sub); principals.markDisabled(iss, sub); },
    onRoleNarrowed: (id) => narrowed.push(id),
    onDelegations: (present, at) => delegationCalls.push({ present, at }),
    version: "0.1.89",
    teamNames: { replaceFromDirectory: (teams) => { teamNames.push([...teams]); return true; } },
    now: () => clock.now,
    fetch: fetcher,
    log: () => {},
    timeoutMs: 200,
  });
  return {
    sync, principals, out, narrowed, requests, queue, linkFile, keys, resolveCalls, teamNames, clock, delegationCalls,
    setDirectory: (next: Directory) => { directory = next; },
    rotate: (token: string) => { validToken = token; },
  };
}

const person = (sub: string, patch: Partial<Directory["people"][number]> = {}): Directory["people"][number] => ({
  sub, login: sub.toLowerCase(), name: sub, email: `${sub.toLowerCase()}@example.test`, role: "employee", status: "active", locale: null, ...patch,
});
const directoryOf = (people: Directory["people"]): Directory => ({ server_id: SERVER_ID, people, teams: [] });

describe("PerspicaxDirectory", () => {
  it("creates principals for people who never signed in and sends the link token, version and accept", async () => {
    const h = harness(directoryOf([person("BOB"), person("ALICE", { role: "admin" })]));
    expect(h.sync.state()).toMatchObject({ state: "missing" });
    expect(await h.sync.refresh()).toMatchObject({ state: "ok", syncedAt: expect.any(Number) });
    expect(h.requests[0]).toMatchObject({
      url: "http://perspicax:8787/api/v1/pulsabot/directory",
      headers: { authorization: `Bearer ${TOKEN_A}`, "x-pulsabot-version": "0.1.89", accept: "application/json" },
    });
    expect(h.principals.bySubject(ISSUER, "BOB")).toMatchObject({ name: "BOB", login: "bob", email: "bob@example.test", orgRole: "member" });
    expect(h.principals.bySubject(ISSUER, "ALICE")?.orgRole).toBe("admin");
    expect(h.sync.people().map((p) => p.sub)).toEqual(["BOB", "ALICE"]);
    expect(h.sync.serverId()).toBe(SERVER_ID);
  });

  it("updates attributes, keeps a disable newer than the fetch, and a 304 changes nothing", async () => {
    const h = harness(directoryOf([person("BOB")]));
    await h.sync.refresh();
    const later = h.clock.now + 60_000;
    h.principals.markDisabled(ISSUER, "BOB", later);
    h.setDirectory(directoryOf([person("BOB", { name: "Robert" })]));
    await h.sync.refresh();
    expect(h.principals.bySubject(ISSUER, "BOB")).toMatchObject({ name: "Robert", disabledAt: later });
    const before = h.requests.length;
    await h.sync.refresh();
    expect(h.requests[before]?.headers["if-none-match"]).toMatch(/^"/);
    expect(h.sync.state().state).toBe("ok");
  });

  it("re-enables a person the directory lists active again, once (S7-9)", async () => {
    const h = harness(directoryOf([person("CAROL")]));
    const changes: Array<[string, boolean]> = [];
    h.principals.onDisabledChanged((p, disabled) => changes.push([p.subject?.sub ?? "", disabled]));
    await h.sync.refresh();
    h.setDirectory(directoryOf([person("CAROL", { status: "disabled" })]));
    await h.sync.refresh();
    expect(h.principals.bySubject(ISSUER, "CAROL")?.disabledAt).toBeDefined();
    h.clock.now += 1_000;
    h.setDirectory(directoryOf([person("CAROL", { name: "Carol" })]));
    await h.sync.refresh();
    expect(h.principals.bySubject(ISSUER, "CAROL")?.disabledAt).toBeUndefined();
    await h.sync.refresh();
    expect(changes).toEqual([["CAROL", true], ["CAROL", false]]);
  });

  it("logs out a disabled person and a known subject gone from the directory", async () => {
    const h = harness(directoryOf([person("BOB"), person("DAVE"), person("ERIN")]));
    await h.sync.refresh();
    expect(h.out).toEqual([]);
    h.setDirectory(directoryOf([person("BOB"), person("DAVE", { status: "disabled" })]));
    await h.sync.refresh();
    expect(h.out.sort()).toEqual(["DAVE", "ERIN"]);
    // already out: not signalled again on the next poll
    h.setDirectory(directoryOf([person("BOB"), person("DAVE", { status: "disabled", name: "D" })]));
    await h.sync.refresh();
    expect(h.out.sort()).toEqual(["DAVE", "ERIN"]);
  });

  it("narrows a person demoted from admin at once", async () => {
    const h = harness(directoryOf([person("CAROL", { role: "admin" })]));
    await h.sync.refresh();
    h.setDirectory(directoryOf([person("CAROL", { role: "manager" })]));
    await h.sync.refresh();
    const carol = h.principals.bySubject(ISSUER, "CAROL")!;
    expect(carol.orgRole).toBe("member");
    expect(h.narrowed).toEqual([carol.id]);
  });

  it("on 401 re-reads the rotated link file and retries once", async () => {
    const h = harness(directoryOf([person("BOB")]));
    await h.sync.refresh();
    h.rotate(TOKEN_B);
    writeLink(h.linkFile, linkDoc({ link_token: TOKEN_B }));
    expect(await h.sync.refresh()).toMatchObject({ state: "ok" });
    const last = h.requests.at(-1)!;
    expect(last.headers.authorization).toBe(`Bearer ${TOKEN_B}`);
    // a token nobody rewrote stays refused
    h.rotate(`pxat1.${"c".repeat(43)}`);
    expect(await h.sync.refresh()).toMatchObject({ state: "error", error: "link_refused" });
  });

  it("runs one refresh at a time", async () => {
    const h = harness(directoryOf([person("BOB")]));
    const [a, b] = await Promise.all([h.sync.refresh(), h.sync.refresh()]);
    expect(a).toEqual(b);
    expect(h.requests).toHaveLength(1);
  });

  it("keeps the last good data through a timeout, a network error and a 5xx", async () => {
    const h = harness(directoryOf([person("BOB")]));
    await h.sync.refresh();
    h.queue.push("hang");
    expect(await h.sync.refresh()).toMatchObject({ state: "error", error: "unreachable", syncedAt: expect.any(Number) });
    h.queue.push("throw");
    expect((await h.sync.refresh()).error).toBe("unreachable");
    h.queue.push({ status: 502, body: {} });
    expect((await h.sync.refresh()).error).toBe("http_502");
    expect(h.sync.people().map((p) => p.sub)).toEqual(["BOB"]);
    expect(h.out).toEqual([]);
  });

  it("refuses a directory for another server id and a malformed body", async () => {
    const h = harness(directoryOf([person("BOB")]));
    h.queue.push({ status: 200, body: { ...directoryOf([]), server_id: "other" } });
    expect((await h.sync.refresh()).error).toBe("server_mismatch");
    h.queue.push({ status: 200, body: { people: "nope" } });
    expect((await h.sync.refresh()).error).toBe("malformed");
    expect(h.principals.listBySubjectIssuer(ISSUER)).toEqual([]);
  });

  it("reports a bad link file as an error and a missing one as missing", async () => {
    const h = harness(directoryOf([]));
    chmodSync(h.linkFile, 0o644);
    expect(await h.sync.refresh()).toMatchObject({ state: "error", error: "link_invalid" });
    expect(h.requests).toHaveLength(0);
  });
});

describe("PerspicaxDirectory, slice 4: teams and owner keys", () => {
  const withTeams = (people: Directory["people"], teams: Directory["teams"]): Directory => ({ server_id: SERVER_ID, people, teams });

  it("gives each person the teams the directory lists (manager wins) and hands the names over", async () => {
    const h = harness(withTeams([person("CAROL"), person("MIA", { role: "manager" }), person("DAVE")], [
      { id: "01TEAMT", name: "T", managers: ["MIA"], members: ["CAROL", "MIA"] },
      { id: "01TEAMU", name: "U", managers: [], members: ["DAVE"] },
    ]));
    const changed: string[] = [];
    h.principals.onAccessChanged((id) => changed.push(id));
    await h.sync.refresh();
    expect(h.principals.bySubject(ISSUER, "CAROL")?.teams).toEqual([{ id: "01TEAMT", manager: false }]);
    expect(h.principals.bySubject(ISSUER, "MIA")).toMatchObject({ teams: [{ id: "01TEAMT", manager: true }], perspicaxRole: "manager" });
    expect(h.principals.bySubject(ISSUER, "DAVE")?.teams).toEqual([{ id: "01TEAMU", manager: false }]);
    expect(h.teamNames.at(-1)).toEqual([{ id: "01TEAMT", name: "T" }, { id: "01TEAMU", name: "U" }]);
    expect(changed).toEqual([]);
    // carol leaves T: her teams empty and her access is recomputed
    h.setDirectory(withTeams([person("CAROL"), person("MIA", { role: "manager" }), person("DAVE")], [
      { id: "01TEAMT", name: "T", managers: ["MIA"], members: ["MIA"] },
      { id: "01TEAMU", name: "U", managers: [], members: ["DAVE"] },
    ]));
    await h.sync.refresh();
    expect(h.principals.bySubject(ISSUER, "CAROL")?.teams).toBeUndefined();
    expect(changed).toEqual([h.principals.bySubject(ISSUER, "CAROL")!.id]);
  });

  it("keeps provider_keys per person, names only", async () => {
    const h = harness(withTeams([person("ALICE", { provider_keys: ["anthropic"] }), person("BOB")], []));
    await h.sync.refresh();
    expect(h.sync.providerKeys("ALICE")).toEqual(["anthropic"]);
    expect(h.sync.providerKeys("BOB")).toEqual([]);
    expect(h.sync.providerKeys("NOBODY")).toEqual([]);
  });

  it("resolves an owner key with the link token, caches it 60 s, and invalidates", async () => {
    const h = harness(withTeams([person("ALICE", { provider_keys: ["anthropic"] })], []));
    await h.sync.refresh();
    h.keys.set("ALICE/anthropic", { key: "sk-ant-test-alice-key-0001" });
    expect(await h.sync.resolveProviderKey("ALICE", "anthropic")).toEqual({ ok: true, key: "sk-ant-test-alice-key-0001", fingerprint: "fp-0001" });
    expect(h.resolveCalls).toEqual([{ sub: "ALICE", provider: "anthropic", authorization: `Bearer ${TOKEN_A}` }]);
    // cached: no second call within 60 s
    h.keys.set("ALICE/anthropic", { key: "sk-ant-test-alice-key-0002" });
    expect((await h.sync.resolveProviderKey("ALICE", "anthropic")) as { key: string }).toMatchObject({ key: "sk-ant-test-alice-key-0001" });
    expect(h.resolveCalls).toHaveLength(1);
    h.clock.now += 60_001;
    expect((await h.sync.resolveProviderKey("ALICE", "anthropic")) as { key: string }).toMatchObject({ key: "sk-ant-test-alice-key-0002" });
    h.sync.invalidate("ALICE", "anthropic");
    await h.sync.resolveProviderKey("ALICE", "anthropic");
    expect(h.resolveCalls).toHaveLength(3);
    // the directory dropping the provider drops the cached key
    h.setDirectory(withTeams([person("ALICE")], []));
    await h.sync.refresh();
    await h.sync.resolveProviderKey("ALICE", "anthropic");
    expect(h.resolveCalls).toHaveLength(4);
  });

  it("S4-14: a disabled owner's cached key is dropped at once, by the directory or a back-channel logout", async () => {
    const h = harness(withTeams([person("ERIN", { provider_keys: ["anthropic", "openai"] }), person("BOB")], []));
    await h.sync.refresh();
    h.keys.set("ERIN/anthropic", { key: "sk-ant-test-erin-key-00001" });
    h.keys.set("ERIN/openai", { key: "sk-test-openai-erin-000001" });
    await h.sync.resolveProviderKey("ERIN", "anthropic");
    await h.sync.resolveProviderKey("ERIN", "openai");
    expect(h.resolveCalls).toHaveLength(2);
    // back-channel logout: every cached key of that subject goes
    h.sync.forgetSubject("ERIN");
    h.keys.set("ERIN/anthropic", { status: 409 });
    expect(await h.sync.resolveProviderKey("ERIN", "anthropic")).toEqual({ ok: false, error: "user_inactive" });
    h.keys.set("ERIN/openai", { key: "sk-test-openai-erin-000001" });
    await h.sync.resolveProviderKey("ERIN", "openai");
    expect(h.resolveCalls).toHaveLength(4);
    // the directory says disabled while still listing provider_keys: no key
    // is served from cache and none is advertised
    h.setDirectory(withTeams([person("ERIN", { status: "disabled", provider_keys: ["anthropic", "openai"] }), person("BOB")], []));
    await h.sync.refresh();
    expect(h.sync.providerKeys("ERIN")).toEqual([]);
    h.keys.set("ERIN/openai", { status: 409 });
    expect(await h.sync.resolveProviderKey("ERIN", "openai")).toEqual({ ok: false, error: "user_inactive" });
    expect(h.resolveCalls).toHaveLength(5);
  });

  it("answers no_key, user_inactive, link and unreachable", async () => {
    const h = harness(withTeams([person("ALICE")], []));
    await h.sync.refresh();
    expect(await h.sync.resolveProviderKey("ALICE", "openai")).toEqual({ ok: false, error: "no_key" });
    h.keys.set("ALICE/openai", { status: 409 });
    expect(await h.sync.resolveProviderKey("ALICE", "openai")).toEqual({ ok: false, error: "user_inactive" });
    h.keys.set("ALICE/openai", { status: 500 });
    expect(await h.sync.resolveProviderKey("ALICE", "openai")).toEqual({ ok: false, error: "unreachable" });
    h.rotate(TOKEN_B);
    expect(await h.sync.resolveProviderKey("ALICE", "openai")).toEqual({ ok: false, error: "link" });
    // on 401 it re-reads the link file once
    writeLink(h.linkFile, linkDoc({ link_token: TOKEN_B }));
    h.keys.set("ALICE/openai", { key: "sk-test-openai-key-000000001" });
    expect(await h.sync.resolveProviderKey("ALICE", "openai")).toMatchObject({ ok: true, key: "sk-test-openai-key-000000001" });
    expect(h.resolveCalls.at(-1)!.authorization).toBe(`Bearer ${TOKEN_B}`);
  });
});

describe("PerspicaxDirectory, slice 5: profiles and token exchange", () => {
  type Answer = { status: number; body?: unknown } | "throw";
  function exchangeHarness(answers: Answer[] = []) {
    const dir = tempDir();
    const linkFile = join(dir, "pulsabot.json");
    writeLink(linkFile, linkDoc());
    const principals = new PrincipalRegistry({ path: join(dir, "principals.json") });
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string }> = [];
    const logs: string[] = [];
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), method: String(init?.method), headers: { ...(init?.headers as Record<string, string>) }, body: String(init?.body ?? ""), ...(init?.redirect ? { redirect: init.redirect } : {}) });
      const next = answers.shift() ?? { status: 200, body: {} };
      if (next === "throw") throw new Error("connect ECONNREFUSED");
      return new Response(next.body === undefined ? null : typeof next.body === "string" ? next.body : JSON.stringify(next.body), { status: next.status });
    }) as typeof fetch;
    const sync = new PerspicaxDirectory({
      issuer: `${ISSUER}/`, serverBase: "http://perspicax:8787/", linkFile, expect: EXPECT, principals,
      onPersonOut: () => {}, onRoleNarrowed: () => {}, version: "0.1.89", now: () => 5_000_000, fetch: fetcher, log: (l) => logs.push(l),
    });
    return { sync, calls, answers, linkFile, logs };
  }
  const ok = { status: 200, body: { access_token: "pxlo1.BOB.exchanged-secret", issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer", expires_in: 900, scope: "profile:P1" } };

  it("an old directory without profiles still parses; the new fields are read and sorted", async () => {
    const h = harness(directoryOf([person("BOB")]));
    expect(await h.sync.refresh()).toMatchObject({ state: "ok" });
    expect(h.sync.profileCatalog()).toEqual([]);
    expect(h.sync.profilesOf("BOB")).toEqual([]);
    h.setDirectory({
      ...directoryOf([person("BOB", { profiles: ["P2", "P1", "P1"] }), person("DAVE", { status: "disabled", profiles: ["P1"] }), person("CAROL")]),
      profiles: [{ id: "P2", slug: "billing", name: "Billing", description: "" }, { id: "P1", slug: "dispatch", name: "Dispatch", description: "CW dispatch" }],
    });
    expect(await h.sync.refresh()).toMatchObject({ state: "ok" });
    expect(h.sync.profileCatalog().map((p) => p.id)).toEqual(["P1", "P2"]);
    expect(h.sync.profilesOf("BOB")).toEqual(["P1", "P2"]);
    expect(h.sync.profilesOf("CAROL")).toEqual([]);
    expect(h.sync.profilesOf("DAVE")).toEqual([]);
    expect(h.sync.profilesOf("NOBODY")).toEqual([]);
  });

  it("sends the exchange with the link's Basic header and the contract's form", async () => {
    const h = exchangeHarness([ok]);
    expect(h.sync.mcpEndpoint()).toBe("http://perspicax:8787/mcp");
    expect(await h.sync.exchangeToken("pxlo1.BOB.subject", "P1")).toEqual({ ok: true, token: "pxlo1.BOB.exchanged-secret", expiresAt: 5_000_000 + 900_000 });
    const [call] = h.calls;
    expect(call).toMatchObject({ url: "http://perspicax:8787/oauth/token", method: "POST", redirect: "error" });
    expect(call!.headers.authorization).toBe(`Basic ${Buffer.from(`pulsa-bot-server:${TOKEN_A}`).toString("base64")}`);
    expect(call!.headers["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(call!.body))).toEqual({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "pxlo1.BOB.subject",
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      resource: `${ISSUER}/mcp?profile=P1`,
    });
    expect(call!.body).toContain(`resource=${encodeURIComponent(`${ISSUER}/mcp?profile=P1`)}`);
  });

  it("maps every answer", async () => {
    const cases: Array<[Answer, string]> = [
      [{ status: 400, body: { error: "invalid_target" } }, "not_held"],
      [{ status: 400, body: { error: "invalid_grant" } }, "subject"],
      [{ status: 400, body: { error: "invalid_request" } }, "unreachable"],
      [{ status: 429, body: { error: "slow_down" } }, "rate_limited"],
      [{ status: 500, body: "oops" }, "unreachable"],
      [{ status: 200, body: { token_type: "Bearer" } }, "unreachable"],
      [{ status: 200, body: "x".repeat(9000) }, "unreachable"],
      ["throw", "unreachable"],
    ];
    for (const [answer, error] of cases) {
      const h = exchangeHarness([answer]);
      expect(await h.sync.exchangeToken("pxlo1.BOB.subject", "P1")).toEqual({ ok: false, error });
    }
    const bad = exchangeHarness([ok]);
    expect(await bad.sync.exchangeToken("pxlo1.BOB.subject", "P1&x=y")).toEqual({ ok: false, error: "not_held" });
    expect(bad.calls).toHaveLength(0);
  });

  it("a 401 re-reads the link file once and retries, then answers link", async () => {
    const h = exchangeHarness([{ status: 401, body: { error: "invalid_client" } }, ok]);
    expect(await h.sync.exchangeToken("pxlo1.BOB.subject", "P1")).toMatchObject({ ok: true });
    expect(h.calls).toHaveLength(2);
    const twice = exchangeHarness([{ status: 401 }, { status: 401 }]);
    expect(await twice.sync.exchangeToken("pxlo1.BOB.subject", "P1")).toEqual({ ok: false, error: "link" });
    expect(twice.calls).toHaveLength(2);
    // the retry uses the rotated token from the file
    const rotated = exchangeHarness([{ status: 401 }, ok]);
    await rotated.sync.exchangeToken("pxlo1.BOB.subject", "P1");
    writeLink(rotated.linkFile, linkDoc({ link_token: TOKEN_B }));
    rotated.answers.push({ status: 401 }, ok);
    await rotated.sync.exchangeToken("pxlo1.BOB.subject", "P1");
    expect(rotated.calls.at(-1)!.headers.authorization).toBe(`Basic ${Buffer.from(`pulsa-bot-server:${TOKEN_B}`).toString("base64")}`);
  });

  it("revokes with the Basic header and logs a failure without the token", async () => {
    const h = exchangeHarness([{ status: 200, body: {} }, { status: 503 }, "throw"]);
    expect(await h.sync.revokeExchanged("pxlo1.BOB.exchanged-secret")).toBe(true);
    expect(h.calls[0]).toMatchObject({ url: "http://perspicax:8787/oauth/revoke", method: "POST" });
    expect(h.calls[0]!.headers.authorization).toMatch(/^Basic /);
    expect(Object.fromEntries(new URLSearchParams(h.calls[0]!.body))).toEqual({ token: "pxlo1.BOB.exchanged-secret", token_type_hint: "access_token" });
    expect(await h.sync.revokeExchanged("pxlo1.BOB.exchanged-secret")).toBe(false);
    expect(await h.sync.revokeExchanged("pxlo1.BOB.exchanged-secret")).toBe(false);
    expect(h.logs).toHaveLength(2);
    expect(h.logs.join("\n")).not.toContain("exchanged-secret");
  });
});

describe("PerspicaxDirectory, slice 6: routine delegations", () => {
  it("reports each person's delegation after each answer, a 304 with the cached people", async () => {
    const dates = { consented_at: "2026-09-30T10:00:00Z", renewed_at: "2026-09-30T10:05:00Z", expires_at: "2026-10-30T10:05:00Z" };
    const h = harness(directoryOf([
      person("ALICE", { routine_delegation: dates }),
      person("BOB", { routine_delegation: null }),
      person("CAROL"),
      person("DAVE", { status: "disabled", routine_delegation: dates }),
    ]));
    h.clock.now = 7_000_000;
    await h.sync.refresh();
    expect(h.delegationCalls).toHaveLength(1);
    const { present, at } = h.delegationCalls[0]!;
    expect(at).toBe(7_000_000);
    expect(present("ALICE")).toBe(true);
    expect(present("BOB")).toBe(false);
    expect(present("CAROL")).toBeUndefined();
    expect(present("DAVE")).toBe(false);
    expect(present("NOBODY")).toBeUndefined();
    h.clock.now = 8_000_000;
    await h.sync.refresh();
    expect(h.delegationCalls).toHaveLength(2);
    expect(h.delegationCalls[1]!.at).toBe(8_000_000);
    expect(h.delegationCalls[1]!.present("BOB")).toBe(false);
  });

  it("refuses a malformed delegation field", async () => {
    const h = harness({ ...directoryOf([]), people: [{ ...person("ALICE"), routine_delegation: { consented_at: 5 } }] } as unknown as Directory);
    expect((await h.sync.refresh()).state).toBe("error");
    expect(h.delegationCalls).toEqual([]);
  });
});
