// Slice 4 of the Perspicax organization through the real server, against the
// local fake provider (teams claim, directory teams and provider_keys, the
// owner key resolve) and the fake Claude and Codex CLIs:
//
//   S4-1  teams from the id_token and the directory reach the session and
//         /api/org/directory
//   S4-3  a bot shared with a person and a team; the owner's key answers
//         another speaker; someone outside sees nothing
//   S4-5  levels: use, run, edit, manage
//   S4-6  a team manager administers grants of their team with the anchor
//   S4-7  an admin administers a bot they cannot open
//   S4-4  removal from the team through the directory, then through a
//         refreshed id_token, narrows at once
//   S4-9  a person's own Codex subscription, only for them
//   S4-10 a section shared with a team; a room with a team
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_CODEX_LOGIN = join(SERVER_DIR, "testing", "fake-codex-login-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const ALICE_KEY = "sk-ant-test-alice-key-0001";
const TEAM_T = "01J9S4TEAMT0000000000000TT";
const TEAM_U = "01J9S4TEAMU0000000000000UU";
const ALICE: FakeOidcUser = { sub: "01J9S4ALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9S4BOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };
const CAROL: FakeOidcUser = { sub: "01J9S4CAROL0000000000000C", name: "Carol", preferred_username: "carol", role: "employee", teams: [{ id: TEAM_T, name: "T", manager: false }] };
const DAVE: FakeOidcUser = { sub: "01J9S4DAVE00000000000000D", name: "Dave", preferred_username: "dave", role: "employee", teams: [{ id: TEAM_U, name: "U", manager: false }] };
const MIA: FakeOidcUser = { sub: "01J9S4MIA000000000000000M", name: "Mia", preferred_username: "mia", role: "manager", teams: [{ id: TEAM_T, name: "T", manager: true }] };
const ERIN: FakeOidcUser = { sub: "01J9S4ERIN00000000000000E", name: "Erin", preferred_username: "erin", role: "employee", teams: [] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let dump = "";
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth?.cookie ? { cookie: auth.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try { parsed = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body: parsed, text };
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

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

async function openStream(auth: Auth): Promise<{ text: () => string; ended: Promise<void>; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      const ended = new Promise<void>((done) => { res.on("end", () => done()); res.on("close", () => done()); res.on("error", () => done()); });
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, ended, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

const botIds = async (auth: Auth) => ((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string }> ?? []).map((b) => b.id);
const botOf = async (auth: Auth, id: string) => ((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; messages: Array<{ kind: string; role: string; text?: string; access?: any }> }>).find((b) => b.id === id);

async function createBot(auth: Auth, name: string, instanceId: string): Promise<{ id: string; threadId: string }> {
  const created = await api("POST", "/api/bots", auth, { name });
  expect(created.status, created.text).toBe(201);
  const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, auth, { modelSelection: { instanceId, model: "fake-model" } });
  expect(patched.status, patched.text).toBe(200);
  return { id: created.body.bot.id, threadId: created.body.bot.threadId };
}

function setDirectoryTeams(tMembers: string[]) {
  idp.directoryTeams = [
    { id: TEAM_T, name: "T", managers: [MIA.sub], members: tMembers },
    { id: TEAM_U, name: "U", managers: [], members: [DAVE.sub] },
  ];
}

async function start() {
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1),
      OMB_IDENTITY: "perspicax",
      OMB_PERSPICAX_ISSUER: idp.issuer,
      OMB_PUBLIC_URL: BASE,
      OMB_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      // the directory refreshes at boot and at every sign-in only, so each
      // path (directory, refreshed id_token) is proven on its own
      OMB_PERSPICAX_DIRECTORY_SECONDS: "3600",
      OMB_OIDC_REFRESH_AFTER_SECONDS: "2",
      OMB_ANTHROPIC_API_KEY: ORG_KEY,
      OMB_ORG_NAME: "Acme",
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

posixOnly("Perspicax organization, slice 4: rights, teams, owner keys, sections", () => {
  let alice: Auth;
  const ids: Record<string, string> = {};
  let x: { id: string; threadId: string };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_CODEX_LOGIN, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL, DAVE, MIA, ERIN].map((user) => idp.personOf(user));
    setDirectoryTeams([CAROL.sub]);
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-rights-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    dump = join(home, "claude-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_DUMP: dump }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        codex: { driver: "codex", environment: { OMB_DEVICE_AUTH_FIXTURE: "1" }, config: { cli: FAKE_CODEX_LOGIN } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 6 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("S4-1: the teams claim and the directory reach the session and the directory", async () => {
    const carol = await signIn(CAROL);
    expect((await api("GET", "/api/auth/session", carol)).body).toMatchObject({ perspicaxRole: "employee", teams: [{ id: TEAM_T, name: "T", manager: false }] });
    const mia = await signIn(MIA);
    expect((await api("GET", "/api/auth/session", mia)).body).toMatchObject({ perspicaxRole: "manager", teams: [{ id: TEAM_T, manager: true }] });
    const directory = (await api("GET", "/api/org/directory", mia)).body;
    expect(directory.teams.find((t: { id: string }) => t.id === TEAM_T)).toEqual({ id: TEAM_T, name: "T", managers: [ids.mia], members: [ids.carol] });
    expect(directory.viewer).toMatchObject({ principalId: ids.mia, orgRole: "member", perspicaxRole: "manager", managedTeamIds: [TEAM_T] });
  });

  it("S4-3: shared with bob and team T; alice's own key answers bob; dave sees none of it", async () => {
    idp.providerKeys.set(`${ALICE.sub}/anthropic`, ALICE_KEY);
    alice = await signIn(ALICE); // a sign-in refreshes the directory: provider_keys now lists alice
    x = await createBot(alice, "Xavier", "claude");
    expect((await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "use" })).status).toBe(200);
    const team = await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `team:${TEAM_T}`, level: "use" });
    expect(team.status, team.text).toBe(200);
    expect(team.body.grants.find((g: { target: string }) => g.target === `team:${TEAM_T}`)).toMatchObject({ kind: "team", label: "T", level: "use" });
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const dave = await signIn(DAVE);
    const daveStream = await openStream(dave);
    expect(await botIds(bob)).toContain(x.id);
    expect(await botIds(carol)).toContain(x.id);
    expect(await botIds(dave)).not.toContain(x.id);
    await waitFor(async () => (await api("GET", "/api/me/engines", alice)).body.engines?.find((e: { instanceId: string }) => e.instanceId === "claude")?.ownerKey === true);
    expect((await api("POST", `/api/bots/${x.id}/messages`, bob, { text: "ping from bob" })).status).toBe(202);
    await waitFor(async () => (await botOf(bob, x.id))?.messages.some((m) => m.role === "bot" && m.kind === "text" && m.text), 30_000);
    await waitFor(async () => existsSync(dump));
    const env = (JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string> }).env;
    expect(env.ANTHROPIC_API_KEY).toBe(ALICE_KEY);
    expect(idp.resolveRequests.at(-1)).toEqual({ sub: ALICE.sub, provider: "anthropic" });
    expect(log).not.toContain(ALICE_KEY);
    expect([403, 404]).toContain((await api("GET", `/api/threads/${x.threadId}/messages`, dave)).status);
    expect([403, 404]).toContain((await api("GET", `/api/bots/${x.id}/grants`, dave)).status);
    expect((await api("GET", `/api/search?q=${encodeURIComponent("ping from bob")}`, dave)).text).not.toContain(x.id);
    await sleep(300);
    expect(daveStream.text()).not.toContain(x.id);
    daveStream.close();
  }, 60_000);

  it("S4-5: levels", async () => {
    const bob = await signIn(BOB);
    expect((await api("PATCH", `/api/bots/${x.id}`, bob, { name: "X2" })).status).toBe(403);
    const routine = await api("POST", "/api/routines", alice, { name: "Daily", botId: x.id, prompt: "Report.", enabled: false, schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 } });
    expect(routine.status, routine.text).toBe(201);
    const run = await api("POST", `/api/routines/${routine.body.routine.id}/run`, bob);
    expect(run).toMatchObject({ status: 403, body: { code: "needs_run" } });
    await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "run" });
    expect((await api("POST", `/api/routines/${routine.body.routine.id}/run`, bob)).status).toBe(201);
    await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "edit" });
    expect((await api("PATCH", `/api/bots/${x.id}`, bob, { name: "Xavier 2" })).status).toBe(200);
    expect((await api("PATCH", `/api/bots/${x.id}`, bob, { approvalMode: "full" })).status).toBe(403);
    await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "manage" });
    expect((await api("PUT", `/api/bots/${x.id}/grants`, bob, { target: `user:${ids.dave}`, level: "use" })).status).toBe(200);
    expect((await api("PUT", `/api/bots/${x.id}/grants`, bob, { target: `user:${ids.dave}`, level: "manage" })).status).toBe(403);
    expect((await api("DELETE", `/api/bots/${x.id}`, bob)).status).toBe(403);
    // back to use for what follows; dave's grant goes
    await api("DELETE", `/api/bots/${x.id}/grants/${encodeURIComponent(`user:${ids.dave}`)}`, alice);
    await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "use" });
  }, 60_000);

  it("S4-6: the manager administers her team's grants under the anchor, never opening the bot", async () => {
    const mia = await signIn(MIA);
    expect([403, 404]).toContain((await api("GET", `/api/threads/${x.threadId}/messages`, mia)).status);
    const listed = (await api("GET", "/api/org/bots", mia)).body.bots as Array<{ id: string; grants: Array<{ target: string }> }>;
    expect(listed.find((b) => b.id === x.id)?.grants.map((g) => g.target)).toEqual([`team:${TEAM_T}`]);
    expect((await api("PUT", `/api/bots/${x.id}/grants`, mia, { target: `team:${TEAM_T}`, level: "run" })).status).toBe(403);
    expect((await api("PUT", `/api/bots/${x.id}/grants`, mia, { target: `user:${ids.carol}`, level: "use" })).status).toBe(200);
    expect((await api("PUT", `/api/bots/${x.id}/grants`, mia, { target: `user:${ids.dave}`, level: "use" })).status).toBe(403);
    expect((await api("DELETE", `/api/bots/${x.id}/grants/${encodeURIComponent(`team:${TEAM_T}`)}`, mia)).status).toBe(200);
    const carol = await signIn(CAROL);
    expect(await botIds(carol)).toContain(x.id); // through her own grant now
    const y = await createBot(alice, "Yan", "claude");
    expect((await api("PUT", `/api/bots/${y.id}/grants`, mia, { target: `team:${TEAM_T}`, level: "use" })).body.code).toBe("not_allowed");
    // restore: team T at use, carol's own grant gone
    await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `team:${TEAM_T}`, level: "use" });
    await api("DELETE", `/api/bots/${x.id}/grants/${encodeURIComponent(`user:${ids.carol}`)}`, alice);
  }, 60_000);

  it("S4-7: an admin administers a member's bot she cannot open", async () => {
    const erin = await signIn(ERIN);
    const z = await createBot(erin, "Zed", "claude");
    alice = await signIn(ALICE);
    expect(await botIds(alice)).not.toContain(z.id);
    expect([403, 404]).toContain((await api("GET", `/api/threads/${z.threadId}/messages`, alice)).status);
    expect((await api("PUT", `/api/bots/${z.id}/grants`, alice, { target: `user:${ids.bob}`, level: "use" })).status).toBe(200);
    expect(((await api("GET", "/api/org/bots", alice)).body.bots as Array<{ id: string }>).map((b) => b.id)).toContain(z.id);
    // bob speaking to erin's bot: no key of erin's and no org key
    const bob = await signIn(BOB);
    expect((await api("POST", `/api/bots/${z.id}/messages`, bob, { text: "hello erin's bot" })).status).toBe(202);
    const card = await waitFor(async () => (await botOf(bob, z.id))?.messages.find((m) => m.kind === "access") ?? null);
    expect(card.access).toMatchObject({ reason: "no_access", keysUrl: `${idp.issuer}/console/pulsabot/keys` });
  }, 60_000);

  it("S4-4: leaving the team through the directory, then through a refreshed id_token, narrows at once", async () => {
    let carol = await signIn(CAROL);
    expect(await botIds(carol)).toContain(x.id);
    const stream = await openStream(carol);
    // 1. the directory: carol leaves T; a sign-in by someone else refreshes it
    setDirectoryTeams([]);
    idp.setTeams(CAROL.sub, []);
    await signIn(DAVE);
    await Promise.race([stream.ended, sleep(10_000).then(() => { throw new Error(`carol's stream stayed open\n${log.slice(-2000)}`); })]);
    expect(await botIds(carol)).not.toContain(x.id);
    expect([403, 404]).toContain((await api("POST", `/api/bots/${x.id}/messages`, carol, { text: "still?" })).status);
    // back in T
    setDirectoryTeams([CAROL.sub]);
    idp.setTeams(CAROL.sub, CAROL.teams);
    await signIn(DAVE);
    carol = await signIn(CAROL);
    await waitFor(async () => (await botIds(carol)).includes(x.id));
    // 2. the id_token: only the claim changes; her next refresh applies it
    idp.setTeams(CAROL.sub, []);
    await waitFor(async () => !(await botIds(carol)).includes(x.id), 20_000);
    idp.setTeams(CAROL.sub, CAROL.teams);
  }, 90_000);

  it("S4-9: erin's own Codex subscription answers for her only", async () => {
    const erin = await signIn(ERIN);
    const started = await api("POST", "/api/me/engines/codex/login/start", erin, {});
    expect(started.status, started.text).toBe(200);
    const flowId = started.body.auth.flowId as string;
    writeFileSync(join(home, ".omb-fake-codex-login-approved"), "yes");
    await waitFor(async () => (await api("GET", `/api/me/engines/codex/login/status?flowId=${encodeURIComponent(flowId)}`, erin)).body.auth?.phase === "succeeded", 20_000);
    const engines = (await api("GET", "/api/me/engines", erin)).body.engines as Array<{ instanceId: string; subscription: { signedIn: boolean }; answersFor: string }>;
    expect(engines.find((e) => e.instanceId === "codex")).toMatchObject({ subscription: { supported: true, signedIn: true }, answersFor: "me" });
    const dir = join(home, ".openmausbot", "principals", ids.erin!, "codex");
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, ".pulsabot-login.json")).mode & 0o777).toBe(0o600);
    // another person's session cannot read erin's flow, and no engine without personal sign-in
    const bob = await signIn(BOB);
    expect((await api("GET", `/api/me/engines/codex/login/status?flowId=${encodeURIComponent(flowId)}`, bob)).status).toBe(404);
    expect((await api("GET", "/api/me/engines", bob)).body.engines.find((e: { instanceId: string }) => e.instanceId === "codex")).toMatchObject({ subscription: { signedIn: false }, answersFor: "nobody" });
    // bob speaking to erin's codex bot: not her subscription
    const w = await createBot(erin, "Wendy", "codex");
    expect((await api("PUT", `/api/bots/${w.id}/grants`, erin, { target: `user:${ids.bob}`, level: "use" })).status).toBe(200);
    expect((await api("POST", `/api/bots/${w.id}/messages`, bob, { text: "hi wendy" })).status).toBe(202);
    const card = await waitFor(async () => (await botOf(bob, w.id))?.messages.find((m) => m.kind === "access") ?? null);
    expect(card.access).toMatchObject({ reason: "no_access" });
    expect((await api("POST", "/api/me/engines/codex/login/sign-out", erin, {})).status).toBe(200);
    expect(existsSync(join(dir, ".pulsabot-login.json"))).toBe(false);
  }, 60_000);

  it("S4-10 and S4-11: a section shared with a team, and a room with a team", async () => {
    const v = await createBot(alice, "Vera", "claude");
    const created = await api("POST", "/api/org/sections", alice, { name: "Ventes" });
    expect(created.status, created.text).toBe(201);
    const id = created.body.section.id as string;
    expect((await api("PUT", `/api/org/sections/${id}/bots`, alice, { add: [v.id] })).status).toBe(200);
    const dave = await signIn(DAVE);
    const carol = await signIn(CAROL);
    expect(await botIds(dave)).not.toContain(v.id);
    const shared = await api("PUT", `/api/org/sections/${id}/members`, alice, { members: [{ target: `team:${TEAM_U}`, role: "participant" }], defaultLevel: "use" });
    expect(shared.status, shared.text).toBe(200);
    const roomId = shared.body.section.roomId as string;
    expect(roomId).toBeTruthy();
    expect(await botIds(dave)).toContain(v.id);
    expect(await botIds(carol)).not.toContain(v.id);
    const groups = async (auth: Auth) => ((await api("GET", "/api/bots", auth)).body.groups as Array<{ id: string }>).map((g) => g.id);
    expect(await groups(dave)).toContain(roomId);
    expect((await api("GET", "/api/bots", dave)).body.sections).toContain("Ventes");
    expect((await api("GET", "/api/bots", carol)).body.sections ?? []).not.toContain("Ventes");
    const posted = await api("POST", `/api/groups/${roomId}/messages`, dave, { text: "room hello" });
    expect(posted.status, posted.text).toBe(202);
    await api("PUT", `/api/org/sections/${id}/members`, alice, { members: [{ target: `team:${TEAM_U}`, role: "readonly" }] });
    expect((await api("POST", `/api/groups/${roomId}/messages`, dave, { text: "read only now" })).status).toBe(403);
    // the room's turn must settle before a rename (the store refuses busy sections)
    const renamed = await waitFor(async () => {
      const got = await api("PATCH", `/api/org/sections/${id}`, alice, { name: "Ventes QC" });
      return got.status === 200 ? got : null;
    }, 30_000);
    expect(renamed.body.section).toMatchObject({ name: "Ventes QC", members: [{ target: `team:${TEAM_U}` }] });
    expect((await api("PUT", "/api/org/sections/general/members", alice, { members: [] })).body.code).toBe("general_is_personal");
    await api("PUT", `/api/org/sections/${id}/members`, alice, { members: [] });
    expect(await botIds(dave)).not.toContain(v.id);
    await waitFor(async () => (await api("DELETE", `/api/org/sections/${id}`, alice)).status === 200, 30_000);

    // a room listing team U: dave sees and posts, carol does not see it
    const u = await createBot(alice, "Ursula", "claude");
    const room = await api("POST", "/api/groups", alice, { name: "Team U room", memberIds: [u.id], humanIds: [`team:${TEAM_U}`], setup: { bulletin: "", defaultResponder: { kind: "everyone" } } });
    expect(room.status, room.text).toBe(201);
    expect(await groups(dave)).toContain(room.body.group.id);
    expect(await groups(carol)).not.toContain(room.body.group.id);
    expect((await api("POST", "/api/groups", alice, { name: "Bad", memberIds: [u.id], humanIds: ["team:NOPE"] })).status).toBe(400);
  }, 60_000);
});
