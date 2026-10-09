// The Perspicax console's Sagax admin routes (console design 2026-10-08,
// section 5) through the real server, with the local fake provider signing
// console assertions and the fake Claude CLI answering turns.
//
// Fixture: Alice (organization admin), Bob (member, team T), Mona (manager
// of T), Zoe (member, outside T). Two bots: Atlas (Alice's) and Beacon
// (Bob's, held open so it raises an approval card). A routine on Atlas. A
// pending admin approval on Beacon.
//
//   C1  capabilities and overview
//   C2  people: list, detail, disable, reset access, connections revoke
//   C3  bots: list, detail, clone, archive and restore, transfer, model,
//       bulk, package and import, stop and delete
//   C4  routines and approvals
//   C5  connections, usage, logs, incidents, audit, settings
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
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
const TEAM_T = "01J9C1TEAMT0000000000000TT";
const ALICE: FakeOidcUser = { sub: "01J9C1ALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9C1BOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [{ id: TEAM_T, name: "T", manager: false }] };
const MONA: FakeOidcUser = { sub: "01J9C1MONA00000000000000M", name: "Mona", preferred_username: "mona", role: "manager", teams: [{ id: TEAM_T, name: "T", manager: true }] };
const ZOE: FakeOidcUser = { sub: "01J9C1ZOE00000000000000Z", name: "Zoe", preferred_username: "zoe", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
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

type AssertionExtra = Partial<Parameters<FakeOidcProvider["consoleAssertion"]>[0]>;
const console$ = (user: FakeOidcUser, extra: AssertionExtra = {}): Auth => ({
  bearer: idp.consoleAssertion({ sub: user.sub, aud: BASE, role: user.role === "admin" || user.role === "manager" ? user.role : "employee", teams: user.teams ?? [], ...extra }),
});
/** One console call: `GET overview`, `POST bots/x/clone`. */
const admin = (method: string, sub: string, user: FakeOidcUser, body?: unknown, extra: AssertionExtra = {}) =>
  api(method, `/api/org/admin/${sub}`, console$(user, extra), body);
const french = { claims: (c: Record<string, unknown>) => ({ ...c, locale: "fr" }) };

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
      SAGAX_IMAGE: "sagax:test",
      SAGAX_IMAGE_COMMIT: "c0ffee",
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

posixOnly("Perspicax console: the Sagax admin routes", () => {
  let alice: Auth;
  let bob: Auth;
  let zoe: Auth;
  const ids: Record<string, string> = {};
  const bots: Record<string, { id: string; threadId: string }> = {};
  let routineId = "";
  const sockets: Socket[] = [];
  let cardId = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, MONA, ZOE].map((user) => idp.personOf(user));
    idp.directoryTeams = [{ id: TEAM_T, name: "T", managers: [MONA.sub], members: [BOB.sub] }];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-console-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "backup-status.json"), JSON.stringify({ enabled: true, schedule: "daily 03:00 UTC", lastAt: "2026-10-08T03:00:00Z", ok: true }));
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_DUMP: join(home, "claude-dump.json") }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        hold: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: join(home, "hold-dump.json") }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        broken: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "api-error", FAKE_CLAUDE_API_ERROR: "429 Too Many Requests: rate limit reached" }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 4 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    bob = await signIn(BOB);
    await signIn(MONA);
    zoe = await signIn(ZOE);
    bots.atlas = await createBot(alice, "Atlas", "claude");
    bots.beacon = await createBot(bob, "Beacon", "hold");
    const routine = await api("POST", "/api/routines", alice, { name: "Daily digest", botId: bots.atlas.id, prompt: "Write the digest.", enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } });
    expect(routine.status, routine.text).toBe(201);
    routineId = routine.body.routine.id;
    // one settled turn on Atlas (usage, latency)
    expect((await api("POST", `/api/bots/${bots.atlas.id}/messages`, alice, { text: "hello" })).status).toBe(202);
    // a pending admin card on Beacon (a member's server command)
    expect((await api("POST", `/api/bots/${bots.beacon.id}/messages`, bob, { text: "hold for cards" })).status).toBe(202);
    const holdDump = join(home, "hold-dump.json");
    await waitFor(async () => existsSync(holdDump), 20_000);
    const socketPath = (JSON.parse(readFileSync(holdDump, "utf8")) as { mcpConfig: any }).mcpConfig.mcpServers.ogb.args.at(-1) as string;
    const socket = connect(socketPath);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
    cardId = "c1-bash-1";
    socket.write(JSON.stringify({ t: "ask", id: cardId, kind: "permission", tool: "Bash", input: { command: "uptime" } }) + "\n");
    await waitFor(async () => {
      const got = await api("GET", `/api/threads/${bots.beacon.threadId}/messages?limit=100`, bob);
      return (got.body.messages as Array<{ card?: any }> | undefined)?.some((m) => m.card?.requestId === cardId);
    });
  }, 120_000);

  afterAll(async () => {
    for (const socket of sockets) socket.destroy();
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("C1: capabilities name the release and every route; the overview counts what happened", async () => {
    const caps = await admin("GET", "capabilities", ZOE);
    expect(caps.status, caps.text).toBe(200);
    expect(caps.headers.get("x-sagax-admin-api")).toBe("1");
    const pkg = JSON.parse(readFileSync(join(SERVER_DIR, "..", "package.json"), "utf8")) as { forkVersion: string };
    expect(caps.body).toMatchObject({ version: pkg.forkVersion, api: 2 });
    expect(caps.body.routes).toEqual(expect.arrayContaining(["GET capabilities", "GET overview", "GET bots", "GET usage", "GET audit"]));

    expect((await admin("GET", "overview", ZOE)).body.code).toBe("forbidden_role");
    const overview = await waitFor(async () => {
      const got = await admin("GET", "overview", ALICE);
      return got.body.turns?.last24h >= 1 && got.body.latency?.some((row: { p50Ms: number | null }) => row.p50Ms !== null) ? got : null;
    }, 30_000);
    expect(overview.body).toMatchObject({
      version: pkg.forkVersion,
      deploy: { image: "sagax:test", commit: "c0ffee", builtAt: null },
      sandboxes: { enabled: false, running: 0, limit: null },
      routines: { runs24h: 0, failed24h: 0 },
      backup: { lastAt: Date.UTC(2026, 9, 8, 3), ok: true },
    });
    expect(overview.body.host.memTotalBytes).toBeGreaterThan(0);
    expect(overview.body.host.load).toHaveLength(3);
    expect(overview.body.engines.map((engine: { id: string }) => engine.id)).toEqual(expect.arrayContaining(["claude", "hold", "broken"]));
    expect(overview.body.latency.find((row: { engine: string }) => row.engine === "claude")).toMatchObject({ turns: 1, p50Ms: expect.any(Number), p90Ms: expect.any(Number) });
    expect(overview.body.presence).toEqual({ online: expect.any(Number), idle: 0, away: expect.any(Number), offline: expect.any(Number) });
    // a manager counts their reach: Mona reaches Bob and herself, not Alice's turn
    const mona = await admin("GET", "overview", MONA);
    expect(mona.body.turns.last24h).toBe(0);
    expect(JSON.stringify(overview.body)).not.toContain("sk-ant-");
  }, 60_000);

  it("C1: a failed turn is an error by readable reason, in the console's language", async () => {
    const broken = await createBot(alice, "Brittle", "broken");
    expect((await api("POST", `/api/bots/${broken.id}/messages`, alice, { text: "fail please" })).status).toBe(202);
    const got = await waitFor(async () => {
      const reply = await admin("GET", "overview", ALICE, undefined, french);
      return reply.body.errors?.last24h >= 1 ? reply : null;
    }, 30_000);
    expect(got.body.errors.byReason).toContainEqual({ reason: "rate_limited", label: "Le fournisseur limite le débit", count: expect.any(Number) });
    bots.brittle = broken;
  }, 60_000);

  it("C1: bots carry status, label and threads, page and filter; usage rows name their engine; audit filters", async () => {
    const all = await admin("GET", "bots", ALICE);
    const atlas = (all.body.bots as Array<any>).find((bot) => bot.id === bots.atlas!.id);
    expect(atlas).toMatchObject({ status: "active", label: null, threads: 1, routines: 1 });
    expect(routineId).toMatch(/\w/);
    const paged = await admin("GET", `bots?owner=${ids.bob}&limit=1`, ALICE);
    expect(paged.body).toMatchObject({ items: [{ id: bots.beacon!.id, owner: { name: "Bob" } }], next: null });
    expect((await admin("GET", "bots?q=atl", ALICE)).body.items.map((bot: { id: string }) => bot.id)).toEqual([bots.atlas!.id]);
    const usage = await admin("GET", "usage", ALICE);
    expect((usage.body.rows as Array<any>).find((row) => row.botId === bots.atlas!.id)).toMatchObject({ engine: "claude", turns: 1 });
    const audit = await admin("GET", `audit?category=rights&target=${bots.atlas!.id}`, ALICE);
    expect(audit.status, audit.text).toBe(200);
    expect((audit.body.rows as Array<any>).every((row) => row.category === "rights" && row.target?.id === bots.atlas!.id)).toBe(true);
  });

  it("C2: people, a person's page, disable and enable, reset access, revoke connections", async () => {
    const list = await admin("GET", "people", ALICE);
    expect(list.status, list.text).toBe(200);
    expect(list.body.items.map((row: { name: string }) => row.name)).toEqual(["Alice", "Bob", "Mona", "Zoe"]);
    expect(list.body.items.find((row: any) => row.name === "Bob")).toMatchObject({ principalId: ids.bob, sub: BOB.sub, role: "member", disabled: false, bots: 1 });
    expect(list.body.items.find((row: any) => row.name === "Alice")).toMatchObject({ role: "admin", turns30d: expect.any(Number) });
    expect((await admin("GET", "people?role=admin", ALICE)).body.items.map((row: { name: string }) => row.name)).toEqual(["Alice"]);
    // Mona manages T (Bob): herself and Bob, never Alice or Zoe
    expect((await admin("GET", "people", MONA)).body.items.map((row: { name: string }) => row.name)).toEqual(["Bob", "Mona"]);
    expect((await admin("GET", `people/${ids.alice}`, MONA)).status).toBe(404);
    expect((await admin("GET", "people", ZOE)).body.code).toBe("forbidden_role");

    const page = await admin("GET", `people/${ids.bob}`, ALICE);
    expect(page.status, page.text).toBe(200);
    expect(page.body).toMatchObject({ name: "Bob", bots: [{ id: bots.beacon!.id }], connections: { engines: expect.any(Array), mcpServers: [], composioApps: [] }, routinesAsRunner: [] });
    expect((await admin("GET", `people/${ids.alice}`, ALICE)).body.routinesAsRunner).toEqual([{ id: routineId, name: "Daily digest", botId: bots.atlas!.id }]);

    // Disable: Mona cannot; Alice cannot disable herself; Zoe's session ends
    expect((await admin("POST", `people/${ids.zoe}/disable`, MONA, { disabled: true })).body.code).toBe("forbidden_role");
    expect((await admin("POST", `people/${ids.alice}/disable`, ALICE, { disabled: true })).body.code).toBe("self");
    expect((await api("GET", "/api/bots", zoe)).status).toBe(200);
    const off = await admin("POST", `people/${ids.zoe}/disable`, ALICE, { disabled: true, reason: "Contract ended" });
    expect(off.status, off.text).toBe(200);
    expect(off.body.person).toMatchObject({ principalId: ids.zoe, disabled: true, disabledBy: "sagax" });
    expect((await api("GET", "/api/bots", zoe)).status).toBe(401);
    const again = await signIn(ZOE);
    expect((await api("GET", "/api/bots", again)).status).toBe(401);
    expect((await admin("GET", "capabilities", ZOE)).body.code).toBe("person_disabled");
    const on = await admin("POST", `people/${ids.zoe}/disable`, ALICE, { disabled: false });
    expect(on.body.person).toMatchObject({ disabled: false, disabledBy: null });
    zoe = await signIn(ZOE);
    expect((await api("GET", "/api/bots", zoe)).status).toBe(200);

    // Reset access: Zoe's sessions end
    const reset = await admin("POST", `people/${ids.zoe}/reset-access`, ALICE, { scope: "sessions" });
    expect(reset.status, reset.text).toBe(200);
    expect(reset.body.cleared).toMatchObject({ engineLogins: 0, sessions: expect.any(Number) });
    expect(reset.body.cleared.sessions).toBeGreaterThanOrEqual(1);
    expect((await api("GET", "/api/bots", zoe)).status).toBe(401);
    zoe = await signIn(ZOE);
    expect((await admin("POST", `people/${ids.zoe}/reset-access`, ALICE, { scope: "keys" })).body.code).toBe("bad_request");

    // Revoke: nothing to remove; a bad body is refused
    const revoked = await admin("POST", `people/${ids.bob}/connections/revoke`, ALICE, { all: true });
    expect(revoked.status, revoked.text).toBe(200);
    expect(revoked.body).toMatchObject({ removed: [], connections: { principalId: ids.bob, connections: [] } });
    expect((await admin("POST", `people/${ids.bob}/connections/revoke`, ALICE, { kind: "nope" })).body.code).toBe("bad_request");

    const audit = await waitFor(async () => {
      const rows = (await admin("GET", `audit?category=people&target=${ids.zoe}`, ALICE)).body.rows as Array<any> | undefined;
      return rows && rows.some((row) => row.action === "person.reset_access") ? rows : null;
    });
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(["person.console_disable", "person.console_enable", "person.reset_access"]));
    expect(audit.find((row) => row.action === "person.console_disable")).toMatchObject({ actor: { kind: "person", principalId: ids.alice, via: "console" }, after: { disabled: true, reason: "Contract ended" } });
  }, 60_000);

  it("C3: a bot's page, clone, archive and restore, transfer, model, bulk, package and import, stop and delete", async () => {
    const page = await admin("GET", `bots/${bots.atlas!.id}`, ALICE);
    expect(page.status, page.text).toBe(200);
    expect(page.body.bot).toMatchObject({
      id: bots.atlas!.id, name: "Atlas", status: "active", threads: { count: 1 }, soul: { chars: expect.any(Number) },
      permissions: { approvalMode: expect.any(String), fullAccess: false },
      routineList: [{ id: routineId, name: "Daily digest", enabled: false, schedule: "Every hour" }],
    });
    expect(page.text).not.toContain('"prompt"');
    expect((await admin("GET", `bots/${bots.atlas!.id}`, MONA)).status).toBe(404);

    // clone Atlas for Bob: model and settings, no grants, no routines, no threads
    const cloned = await admin("POST", `bots/${bots.atlas!.id}/clone`, ALICE, { ownerSub: BOB.sub, name: "Atlas for Bob" });
    expect(cloned.status, cloned.text).toBe(201);
    expect(cloned.body.bot).toMatchObject({ name: "Atlas for Bob", owner: { principalId: ids.bob }, engine: { instanceId: "claude" }, model: "fake-model", grants: [], routines: 0, threads: 1, status: "active" });
    const copyId = cloned.body.bot.id as string;
    expect(((await api("GET", "/api/bots", bob)).body.bots as Array<{ id: string }>).map((bot) => bot.id)).toContain(copyId);
    // a manager clones in reach only (Bob's Beacon, for herself)
    expect((await admin("POST", `bots/${bots.atlas!.id}/clone`, MONA, {})).status).toBe(404);
    const monaCopy = await admin("POST", `bots/${bots.beacon!.id}/clone`, MONA, { ownerPrincipalId: ids.mona });
    expect(monaCopy.status, monaCopy.text).toBe(201);
    expect((await admin("POST", `bots/${bots.beacon!.id}/clone`, MONA, { ownerPrincipalId: ids.alice })).body.code).toBe("owner_not_found");

    // archive and restore
    const cirrus = await createBot(alice, "Cirrus", "claude");
    const archived = await admin("POST", `bots/${cirrus.id}/archive`, ALICE, {});
    expect(archived.body.bot.status, archived.text).toBe("archived");
    expect((await admin("GET", "bots?status=archived", ALICE)).body.items.map((bot: { id: string }) => bot.id)).toContain(cirrus.id);
    expect((await admin("POST", `bots/${cirrus.id}/restore`, ALICE, {})).body.bot.status).toBe("active");

    // model: another installed engine; an unknown engine is refused
    const model = await admin("POST", `bots/${cirrus.id}/model`, ALICE, { engineInstanceId: "hold", model: null });
    expect(model.status, model.text).toBe(200);
    expect(model.body.bot).toMatchObject({ engine: { instanceId: "hold" }, model: expect.any(String) });
    expect((await admin("POST", `bots/${cirrus.id}/model`, ALICE, { engineInstanceId: "ghost", model: "x" })).body.code).toBe("engine_not_installed");

    // transfer: Bob owns it, Alice keeps manage; a manager may not
    expect((await admin("POST", `bots/${cirrus.id}/transfer`, MONA, { ownerPrincipalId: ids.mona })).body.code).toBe("forbidden_role");
    const moved = await admin("POST", `bots/${cirrus.id}/transfer`, ALICE, { ownerSub: BOB.sub });
    expect(moved.status, moved.text).toBe(200);
    expect(moved.body.bot.owner).toMatchObject({ principalId: ids.bob, name: "Bob" });
    expect(moved.body.bot.grants).toContainEqual(expect.objectContaining({ target: `user:${ids.alice}`, level: "manage" }));

    // bulk
    const bulk = await admin("POST", "bots/bulk", ALICE, { action: "archive", ids: [cirrus.id, copyId, "nope-bot"] });
    expect(bulk.body.results).toEqual([{ id: cirrus.id, ok: true }, { id: copyId, ok: true }, { id: "nope-bot", ok: false, code: "not_found", message: "No such bot." }]);

    // package and import
    const pkg = await fetch(`${BASE}/api/org/admin/bots/${bots.atlas!.id}/package`, { headers: { authorization: `Bearer ${console$(ALICE).bearer}` } });
    expect(pkg.status).toBe(200);
    expect(pkg.headers.get("content-disposition")).toContain("attachment");
    const document = await pkg.json() as Record<string, unknown>;
    expect(document).toMatchObject({ format: "openmaus.package", version: 2 });
    expect(JSON.stringify(document)).not.toContain("sk-ant-");
    const imported = await admin("POST", "bots/import", ALICE, { package: document, ownerSub: ZOE.sub, name: "Atlas for Zoe" });
    expect(imported.status, imported.text).toBe(201);
    expect(imported.body.bot).toMatchObject({ name: "Atlas for Zoe", owner: { principalId: ids.zoe } });
    expect(imported.body.warnings).toEqual(expect.any(Array));
    expect((await admin("POST", "bots/import", ALICE, { package: { format: "nope" } })).body.code).toBe("invalid_package");

    // stop and delete
    expect((await admin("POST", `bots/${bots.atlas!.id}/stop`, ALICE, {})).status).toBe(200);
    expect((await admin("POST", `bots/${copyId}/delete`, ALICE, { confirm: "wrong" })).body.code).toBe("confirm_required");
    const deleted = await admin("POST", `bots/${copyId}/delete`, ALICE, { confirm: "Atlas for Bob" });
    expect(deleted.status, deleted.text).toBe(200);
    expect(deleted.body).toEqual({ deleted: copyId });
    expect((await admin("GET", `bots/${copyId}`, ALICE)).status).toBe(404);

    const audit = await waitFor(async () => {
      const rows = (await admin("GET", "audit?category=bot&limit=100", ALICE)).body.rows as Array<any> | undefined;
      return rows && rows.some((row) => row.action === "bot.force_delete") ? rows : null;
    });
    for (const action of ["bot.clone", "bot.archive", "bot.restore", "bot.model", "bot.transfer", "bot.export", "bot.import", "bot.force_stop", "bot.force_delete"]) {
      expect(audit.map((row) => row.action), action).toContain(action);
    }
    expect(audit.find((row) => row.action === "bot.transfer")).toMatchObject({ actor: { via: "console", principalId: ids.alice }, after: { ownerPrincipalId: ids.bob } });
  }, 90_000);

  it("C4: the organization's approval queue, a console decision in the history", async () => {
    const queue = await admin("GET", "approvals?scope=org", ALICE);
    expect(queue.status, queue.text).toBe(200);
    const card = (queue.body.approvals as Array<any>).find((entry) => entry.requestId === cardId);
    expect(card).toMatchObject({ botId: bots.beacon!.id, kind: "admin", tool: "Bash", decidable: true, owner: { principalId: ids.bob } });
    expect((await admin("GET", "approvals?scope=org", MONA)).body.code).toBe("forbidden_role");
    // Bob's own list never carries the admin card
    expect(((await admin("GET", "approvals", BOB)).body.approvals as Array<any>).map((entry) => entry.requestId)).not.toContain(cardId);
    const answered = await admin("POST", `approvals/${bots.beacon!.threadId}/${cardId}`, ALICE, { decision: "allow" });
    expect(answered.status, answered.text).toBe(200);
    const history = await waitFor(async () => {
      const got = await admin("GET", "approvals/history", ALICE);
      return (got.body.items as Array<any> | undefined)?.find((entry) => entry.requestId === cardId) ? got : null;
    });
    expect((history.body.items as Array<any>).find((entry) => entry.requestId === cardId)).toMatchObject({
      botId: bots.beacon!.id, threadId: bots.beacon!.threadId, type: "tool", tool: "Bash", decision: "allow", by: { principalId: ids.alice, name: "Alice" }, at: expect.any(Number),
    });
    expect(((await admin("GET", "approvals?scope=org", ALICE)).body.approvals as Array<any>).map((entry) => entry.requestId)).not.toContain(cardId);
    expect((await admin("GET", "approvals/history", MONA)).body.code).toBe("forbidden_role");
  }, 30_000);

  it("C4: routines across members, resume, run now, the run history", async () => {
    // the package imported for Zoe in C3 brought its routine along, off
    expect((await admin("GET", "routines", ALICE)).body.items).toHaveLength(2);
    const list = await admin("GET", `routines?bot=${bots.atlas!.id}`, ALICE);
    expect(list.status, list.text).toBe(200);
    expect(list.body.items).toEqual([expect.objectContaining({
      id: routineId, name: "Daily digest", botId: bots.atlas!.id, botName: "Atlas", owner: expect.objectContaining({ principalId: ids.alice }),
      runAs: expect.objectContaining({ principalId: ids.alice }), schedule: "Every hour", enabled: false, nextRunAt: null, lastRun: null, failures7d: 0,
    })]);
    expect(list.text).not.toContain("Write the digest.");
    expect((await admin("GET", "routines?status=paused", ALICE)).body.items).toHaveLength(2);
    expect((await admin("GET", "routines", MONA)).body.items).toEqual([]);
    expect((await admin("GET", `routines/${routineId}`, MONA)).status).toBe(404);
    expect((await admin("POST", `routines/${routineId}/pause`, MONA, { paused: false })).status).toBe(404);

    const resumed = await admin("POST", `routines/${routineId}/pause`, ALICE, { paused: false });
    expect(resumed.status, resumed.text).toBe(200);
    expect(resumed.body.routine).toMatchObject({ enabled: true, nextRunAt: expect.any(Number) });
    const run = await admin("POST", `routines/${routineId}/run`, ALICE, {});
    expect(run.status, run.text).toBe(200);
    expect(run.body.run).toMatchObject({ id: expect.any(String), status: "running" });
    const runs = await waitFor(async () => {
      const got = await admin("GET", `routines/${routineId}/runs`, ALICE);
      const items = got.body.items as Array<any> | undefined;
      return items?.[0] && items[0].status !== "running" ? items : null;
    }, 40_000);
    expect(runs[0]).toMatchObject({ id: run.body.run.id, status: "ok", reason: null, threadId: expect.any(String), endedAt: expect.any(Number) });
    expect((await admin("GET", `routines/${routineId}`, ALICE)).body.routine.lastRun).toMatchObject({ status: "ok" });
    const paused = await admin("POST", `routines/${routineId}/pause`, ALICE, { paused: true });
    expect(paused.body.routine.enabled).toBe(false);
    const audit = (await admin("GET", `audit?category=bot&target=${routineId}`, ALICE)).body.rows as Array<any>;
    expect(audit.map((row) => row.action)).toEqual(expect.arrayContaining(["routine.resume", "routine.run_now", "routine.pause"]));
    expect(audit.find((row) => row.action === "routine.run_now")).toMatchObject({ actor: { via: "console", principalId: ids.alice } });
  }, 60_000);
});
