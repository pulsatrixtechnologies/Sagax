// The member API (server/org-member-routes.ts, Perspicax plan lot C.1)
// through the real server: the local fake provider signs the assertions an
// AI client's calls carry (`act.sub` perspicax-mcp) and the fake Claude CLI
// answers the turns.
//
// Fixture: Alice (organization admin), Bob (member, member defaults), Zoe
// (member whose profiles grant no client key, never signed in to Sagax).
// Orion is Bob's bot on the `slow` engine (answers after 0.8 s, or when a
// gate file appears for a `[gate:NAME]` prompt). Atlas is Alice's bot, with a
// routine.
//
//   M1  a member lists their bots and sends with a wait: the reply comes back
//   M2  a long job answers pending with the thread id, then reads back
//   M3  permission refusals name the key; a bot out of reach stays out
//   M4  an admin runs a routine, reads its run, nudges a person
//   M5  the admin API still refuses an AI client's assertion; audit rows
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const ALICE: FakeOidcUser = { sub: "01J9M1ALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9M1BOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
const ZOE: FakeOidcUser = { sub: "01J9M1ZOE00000000000000Z", name: "Zoe", preferred_username: "zoe", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let gates: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string; bearer?: string };
type Reply = { status: number; body: any; text: string; headers: Headers };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<Reply> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
      ...(auth?.bearer ? { authorization: `Bearer ${auth.bearer}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text, headers: res.headers };
};
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signIn(user: FakeOidcUser): Promise<Auth> {
  idp.user = { ...user };
  const start = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return { cookie: cookiePair(session!) };
}

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

/** One AI client call for this person, as Perspicax signs it. */
const member = (method: string, sub: string, user: FakeOidcUser, body?: unknown, actor = "perspicax-mcp") =>
  api(method, `/api/org/member/${sub}`, {
    bearer: idp.consoleAssertion({
      sub: user.sub, aud: BASE, role: user.role === "admin" ? "admin" : "employee", teams: user.teams ?? [],
      claims: (c) => ({ ...c, act: { sub: actor } }),
    }),
  }, body);

async function createBot(auth: Auth, name: string, instanceId: string): Promise<{ id: string; threadId: string }> {
  const created = await api("POST", "/api/bots", auth, { name });
  expect(created.status, created.text).toBe(201);
  const bot = created.body.bot;
  const patched = await api("PATCH", `/api/bots/${bot.id}`, auth, { modelSelection: { instanceId, model: "fake-model" } });
  expect(patched.status, patched.text).toBe(200);
  return { id: bot.id, threadId: bot.threadId };
}

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5",
      SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
      SAGAX_ORG_NAME: "Acme",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
    await sleep(150);
  }
}

posixOnly("Perspicax AI clients: the Sagax member API", () => {
  let alice: Auth;
  let bob: Auth;
  const ids: Record<string, string> = {};
  const bots: Record<string, { id: string; threadId: string }> = {};
  let routineId = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    // Zoe's profiles grant bots.create and nothing for AI clients.
    idp.directoryPeople = [idp.personOf(ALICE), idp.personOf(BOB), { ...idp.personOf(ZOE), permissions: ["bots.create"] }];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-member-"));
    gates = join(home, "gates");
    mkdirSync(gates, { recursive: true });
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } },
        slow: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_GATE_DIR: gates }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 3 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    bob = await signIn(BOB);
    bots.orion = await createBot(bob, "Orion", "slow");
    bots.atlas = await createBot(alice, "Atlas", "claude");
    const routine = await api("POST", "/api/routines", alice, { name: "Daily digest", botId: bots.atlas.id, prompt: "Write the digest.", enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } });
    expect(routine.status, routine.text).toBe(201);
    routineId = routine.body.routine.id;
  }, 120_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("M1: a member lists the bots they can use and sends with a wait: the reply comes back", async () => {
    const caps = await member("GET", "capabilities", BOB);
    expect(caps.status, caps.text).toBe(200);
    expect(caps.headers.get("x-sagax-member-api")).toBe("1");
    expect(caps.body.routes).toEqual(expect.arrayContaining(["GET bots", "POST bots/{id}/messages"]));

    const listed = await member("GET", "bots", BOB);
    expect(listed.status, listed.text).toBe(200);
    const orion = (listed.body.bots as Array<any>).find((bot) => bot.id === bots.orion!.id);
    expect(orion).toMatchObject({ name: "Orion", source: "mine", status: "idle", canMessage: true, owner: { principalId: ids.bob, sub: BOB.sub, name: "Bob" } });
    // Alice's private bot is not Bob's to see
    expect((listed.body.bots as Array<any>).some((bot) => bot.id === bots.atlas!.id)).toBe(false);

    const sent = await member("POST", `bots/${bots.orion!.id}/messages`, BOB, { text: "count the open tickets", wait: 30 });
    expect(sent.status, sent.text).toBe(200);
    expect(sent.body).toMatchObject({ botId: bots.orion!.id, status: "done", pending: false, reply: expect.stringContaining("count the open tickets") });
    expect(sent.body.threadId).toMatch(/\w/);
    // the message is Bob's, in Bob's own conversation
    const thread = await api("GET", `/api/threads/${sent.body.threadId}/messages?limit=50`, bob);
    const mine = (thread.body.messages as Array<any>).find((m) => m.id === sent.body.messageId);
    expect(mine).toMatchObject({ role: "user", text: "count the open tickets" });
  }, 60_000);

  it("M2: a long job answers pending with the thread id, and the thread read gives the reply later", async () => {
    const sent = await member("POST", `bots/${bots.orion!.id}/messages`, BOB, { text: "[gate:long] rebuild the report", wait: 2, newThread: true });
    expect(sent.status, sent.text).toBe(200);
    expect(sent.body).toMatchObject({ pending: true, status: "working", reply: null });
    const threadId = sent.body.threadId as string;
    const cursor = sent.body.cursor as string;
    const working = await member("GET", `threads/${threadId}?since=${cursor}`, BOB);
    expect(working.body).toMatchObject({ threadId, status: "working", messages: [] });
    writeFileSync(join(gates, "long"), "");
    const done = await waitFor(async () => {
      const got = await member("GET", `threads/${threadId}?since=${cursor}`, BOB);
      return got.body.status === "idle" && got.body.messages?.some((m: any) => m.role === "bot") ? got : null;
    }, 30_000);
    expect(done.body.messages.at(-1)).toMatchObject({ role: "bot", kind: "text", text: expect.stringContaining("rebuild the report") });
    expect(done.body.cursor).not.toBe(cursor);
  }, 60_000);

  it("M3: a missing permission is refused by name; a bot out of reach stays out; an unknown actor is refused", async () => {
    const zoe = await member("GET", "bots", ZOE);
    expect(zoe.status, zoe.text).toBe(403);
    expect(zoe.body).toMatchObject({ code: "forbidden_permission", permission: "clients.botsRead" });
    const run = await member("POST", `routines/${routineId}/run`, BOB, {});
    expect(run.status).toBe(403);
    expect(run.body).toMatchObject({ code: "forbidden_permission", permission: "clients.routinesRun" });
    const nudge = await member("POST", `people/${ALICE.sub}/nudge`, BOB, {});
    expect(nudge.body.permission).toBe("clients.peopleNudge");
    // Bob may message, but not a bot that is not his to see
    const hidden = await member("POST", `bots/${bots.atlas!.id}/messages`, BOB, { text: "hello" });
    expect(hidden.status, hidden.text).toBe(404);
    const thread = await member("GET", `threads/${bots.atlas!.threadId}`, BOB);
    expect(thread.status, thread.text).toBeGreaterThanOrEqual(403);
    expect((await member("GET", "bots", BOB, undefined, "someone")).body.code).toBe("assertion_invalid");
  }, 60_000);

  it("M4: an admin runs a routine, reads its run and nudges a person by Perspicax user id", async () => {
    const run = await member("POST", `routines/${routineId}/run`, ALICE, {});
    expect(run.status, run.text).toBe(201);
    expect(run.body.run).toMatchObject({ routineId, id: expect.any(String) });
    const read = await waitFor(async () => {
      const got = await member("GET", `routines/runs/${run.body.run.id}`, ALICE);
      return got.status === 200 && got.body.run.status === "completed" ? got : null;
    }, 30_000);
    expect(read.body.run).toMatchObject({ routineId, botId: bots.atlas!.id, status: "completed" });
    const nudge = await member("POST", `people/${BOB.sub}/nudge`, ALICE, {});
    expect(nudge.status, nudge.text).toBe(200);
    expect(nudge.body).toMatchObject({ ok: true, id: expect.any(String) });
  }, 60_000);

  it("M5: the admin API refuses an AI client's assertion; the audit names the client and never the text", async () => {
    const refused = await api("GET", "/api/org/admin/capabilities", {
      bearer: idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin", claims: (c) => ({ ...c, act: { sub: "perspicax-mcp" } }) }),
    });
    expect(refused.status).toBe(401);
    expect(refused.body.code).toBe("assertion_invalid");
    const audit = await api("GET", "/api/org/admin/audit?category=client", { bearer: idp.consoleAssertion({ sub: ALICE.sub, aud: BASE, role: "admin" }) });
    expect(audit.status, audit.text).toBe(200);
    const rows = audit.body.rows as Array<any>;
    expect(rows.map((row) => row.action)).toEqual(expect.arrayContaining(["client.message", "client.routine_run", "client.nudge"]));
    expect(rows.find((row) => row.action === "client.message").actor).toMatchObject({ kind: "person", name: "Bob", via: "perspicax-mcp" });
    expect(JSON.stringify(rows)).not.toContain("open tickets");
  }, 60_000);
});
