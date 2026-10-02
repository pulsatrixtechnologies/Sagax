// Private threads on a Perspicax organization server, through the real
// server, the fake provider (server/testing/fake-oidc-provider.ts) and the
// fake Claude CLI (JC: "When talking to a shared bot, we should not be able
// to use the same thread. Being multiple in the same chat is for groups."):
//
//   PT-1  bob opens alice's shared bot on his own thread; neither reads,
//         writes, exports, streams, searches or fetches the files of the
//         other's thread; an edit holder changes the bot, never reads it;
//         an organization admin holding a grant reads nobody's thread
//   PT-2  a group chat with alice, bob and the bot: both read and write it,
//         erin (not in it) gets nothing; removing bob closes it to him
//   PT-3  the one-time migration ran and logged its counts only
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key";
const ALICE: FakeOidcUser = { sub: "01J9PTALICE0000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9PTBOB00000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9PTCAROL0000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };
const DAVE: FakeOidcUser = { sub: "01J9PTDAVE00000000000000D", email: "dave@example.test", name: "Dave", preferred_username: "dave", role: "admin" };
const ERIN: FakeOidcUser = { sub: "01J9PTERIN00000000000000E", email: "erin@example.test", name: "Erin", preferred_username: "erin", role: "employee" };
// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(auth?.cookie ? { cookie: auth.cookie } : {}),
    },
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

async function openStream(auth: Auth): Promise<{ text: () => string; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  expect(body.ticket).toMatch(/^sgx_tick_/);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      expect(res.statusCode).toBe(200);
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

type WireBot = { id: string; threadId: string; tasks: Array<{ threadId: string; title: string; ownerPrincipalId?: string }>; messages: Array<{ kind: string; role: string; text?: string }> };
const botOf = async (auth: Auth, id: string) => ((await api("GET", "/api/bots", auth)).body.bots as WireBot[]).find((bot) => bot.id === id);

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
      OMB_PERSPICAX_DIRECTORY_SECONDS: "5",
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

posixOnly("Perspicax organization: private threads with a shared bot, group chats shared", () => {
  let alice: Auth;
  let ids: Record<"alice" | "bob" | "carol" | "dave" | "erin", string>;
  let botId = "";
  let aliceThread = "";
  let bobThread = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL, DAVE, ERIN].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-private-threads-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = await api("GET", "/api/org/directory", alice);
      const list = got.body.people as Array<{ principalId: string; login: string }> | undefined;
      return list && list.length === 5 ? list : null;
    });
    const idOf = (login: string) => people.find((person) => person.login === login)!.principalId;
    ids = { alice: idOf("alice"), bob: idOf("bob"), carol: idOf("carol"), dave: idOf("dave"), erin: idOf("erin") };
    // the organization's key (OMB_ANTHROPIC_API_KEY) serves by itself since 2026-10-01
  }, 40_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("PT-3: the one-time migration ran and logged counts, never an id", async () => {
    const line = log.split("\n").find((entry) => entry.includes("[private-threads] migration:"));
    expect(line, log.slice(-2000)).toBeTruthy();
    expect(line).not.toMatch(/pr_|@/);
  });

  it("PT-1: bob talks to alice's shared bot in his own private thread, and nobody reads anyone else's", async () => {
    const created = await api("POST", "/api/bots", alice, { name: "Xavier" });
    expect(created.status, created.text).toBe(201);
    botId = created.body.bot.id;
    aliceThread = created.body.bot.threadId;
    expect((await api("PATCH", `/api/bots/${botId}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
    for (const [who, level] of [["bob", "use"], ["carol", "edit"], ["dave", "use"]] as const) {
      const shared = await api("PUT", `/api/bots/${botId}/grants`, alice, { target: `user:${ids[who]}`, level });
      expect(shared.status, shared.text).toBe(200);
    }
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const dave = await signIn(DAVE);
    const aliceStream = await openStream(alice);
    const bobStream = await openStream(bob);
    const daveStream = await openStream(dave);

    expect((await api("POST", `/api/bots/${botId}/messages`, alice, { text: "alice secret plan" })).status).toBe(202);
    const bobsView = await botOf(bob, botId);
    expect(bobsView, "bob lists the shared bot").toBeTruthy();
    bobThread = bobsView!.threadId;
    expect(bobThread).toBeTruthy();
    expect(bobThread).not.toBe(aliceThread);
    expect(bobsView!.tasks.map((task) => task.threadId)).toEqual([bobThread]);
    expect(bobsView!.tasks[0]!.ownerPrincipalId).toBe(ids.bob);
    const bobSent = await api("POST", `/api/bots/${botId}/messages`, bob, { text: "bob private note" });
    expect(bobSent.status, bobSent.text).toBe(202);
    await waitFor(async () => (await botOf(bob, botId))?.messages.some((m) => m.role === "bot" && m.kind === "text" && m.text), 30_000);
    await waitFor(async () => (await botOf(alice, botId))?.messages.some((m) => m.role === "bot" && m.kind === "text" && m.text), 30_000);

    // list: each sees their own thread only
    const alicesView = (await botOf(alice, botId))!;
    expect(alicesView.threadId).toBe(aliceThread);
    expect(alicesView.tasks.map((task) => task.threadId)).toEqual([aliceThread]);
    expect(JSON.stringify(alicesView)).not.toContain("bob private note");
    expect(JSON.stringify(alicesView)).not.toContain(bobThread);
    const bobsNow = (await botOf(bob, botId))!;
    expect(bobsNow.messages.some((m) => m.text === "bob private note")).toBe(true);
    expect(JSON.stringify(bobsNow)).not.toContain("alice secret plan");
    expect(JSON.stringify(bobsNow)).not.toContain(aliceThread);

    // read, post, export, events, switch, rename, delete: the other's thread reads as missing
    const refused = async (auth: Auth, thread: string) => [
      await api("GET", `/api/threads/${thread}/messages`, auth),
      await api("GET", `/api/threads/${thread}/export`, auth),
      await api("GET", `/api/threads/${thread}/events`, auth),
      await api("GET", `/api/threads/${thread}/files`, auth),
      await api("POST", `/api/bots/${botId}/messages`, auth, { text: "intruding", threadId: thread }),
      await api("POST", `/api/bots/${botId}/tasks/${thread}`, auth),
      await api("PATCH", `/api/bots/${botId}/tasks/${thread}`, auth, { title: "mine now" }),
      await api("DELETE", `/api/bots/${botId}/tasks/${thread}`, auth),
      // Regenerate title (from upstream) reads the thread to name it.
      await api("POST", `/api/bots/${botId}/tasks/${thread}/title`, auth),
      await api("POST", `/api/bots/${botId}/read`, auth, { threadId: thread }),
      await api("POST", `/api/bots/${botId}/compact`, auth, { threadId: thread }),
      await api("POST", `/api/bots/${botId}/interrupt`, auth, { threadId: thread }),
      await api("POST", `/api/threads/${thread}/respond`, auth, { requestId: "nope", behavior: "allow" }),
      await api("GET", `/api/bots/${botId}/requests/aaaaaaaaaaaaaaaaaaaa?threadId=${thread}`, auth),
    ].map((got) => got.status);
    const bobOnAlice = await refused(bob, aliceThread);
    expect(bobOnAlice.every((status) => status === 404 || status === 403), JSON.stringify(bobOnAlice)).toBe(true);
    const aliceOnBob = await refused(alice, bobThread);
    expect(aliceOnBob.every((status) => status === 404 || status === 403), JSON.stringify(aliceOnBob)).toBe(true);
    // an edit holder changes the bot, never reads a thread
    expect((await api("PATCH", `/api/bots/${botId}`, carol, { name: "Xavier 2" })).status).toBe(200);
    const carolOnBoth = [...await refused(carol, aliceThread), ...await refused(carol, bobThread)];
    expect(carolOnBoth.every((status) => status === 404 || status === 403), JSON.stringify(carolOnBoth)).toBe(true);
    // an organization admin holding a grant reads nobody's thread
    const daveOnBoth = [...await refused(dave, aliceThread), ...await refused(dave, bobThread)];
    expect(daveOnBoth.every((status) => status === 404 || status === 403), JSON.stringify(daveOnBoth)).toBe(true);
    expect(JSON.stringify(await botOf(dave, botId))).not.toMatch(/alice secret plan|bob private note/);
    // nothing was written into the other's thread
    expect(JSON.stringify((await api("GET", `/api/threads/${aliceThread}/messages`, alice)).body)).not.toContain("intruding");
    expect(JSON.stringify((await api("GET", `/api/threads/${bobThread}/messages`, bob)).body)).not.toContain("intruding");

    // search: no hit in someone else's thread, even an admin's search
    const searchText = async (auth: Auth, q: string) => (await api("GET", `/api/search?q=${encodeURIComponent(q)}`, auth)).text;
    expect(await searchText(bob, "alice secret plan")).not.toContain(aliceThread);
    expect(await searchText(alice, "bob private note")).not.toContain(bobThread);
    expect(await searchText(dave, "bob private note")).not.toContain(bobThread);
    expect(await searchText(bob, "bob private note")).toContain(bobThread);
    expect(await searchText(bob, "secret plan")).not.toContain("secret plan");

    // files: a file in bob's thread is bob's
    const uploaded = await fetch(`${BASE}/api/attachments`, { method: "POST", headers: { "content-type": "image/png", cookie: bob.cookie! }, body: PNG });
    expect(uploaded.status).toBe(201);
    const saved = await uploaded.json() as { path: string };
    const file = `/api/attachments/${saved.path.split("/").pop()}`;
    expect((await api("POST", `/api/bots/${botId}/messages`, bob, { text: `bob's picture ![x](${file})`, threadId: bobThread })).status).toBe(202);
    await waitFor(async () => JSON.stringify((await api("GET", `/api/threads/${bobThread}/messages`, bob)).body).includes(file.split("/").pop()!));
    // the reference scan is kept a minute: wait it out before reading as alice
    const name = file.split("/").pop()!;
    await waitFor(async () => (await fetch(`${BASE}/api/attachments/${name}`, { headers: { cookie: alice.cookie! } })).status === 404, 70_000);
    expect((await fetch(`${BASE}/api/attachments/${name}`, { headers: { cookie: dave.cookie! } })).status).toBe(404);
    expect((await fetch(`${BASE}/api/attachments/${name}`, { headers: { cookie: bob.cookie! } })).status).toBe(200);

    // live frames: each stream carries its own thread only
    await sleep(500);
    expect(aliceStream.text()).toContain("alice secret plan");
    expect(aliceStream.text()).not.toContain("bob private note");
    expect(aliceStream.text()).not.toContain(bobThread);
    expect(bobStream.text()).toContain("bob private note");
    expect(bobStream.text()).not.toContain("alice secret plan");
    expect(bobStream.text()).not.toContain(aliceThread);
    expect(daveStream.text()).not.toMatch(/alice secret plan|bob private note/);
    for (const stream of [aliceStream, bobStream, daveStream]) stream.close();

    // a new thread is its creator's, and only theirs
    const fresh = await api("POST", `/api/bots/${botId}/tasks`, bob, { title: "Bob's second" });
    expect(fresh.status, fresh.text).toBe(201);
    expect(fresh.body.task.ownerPrincipalId).toBe(ids.bob);
    expect(fresh.body.bot.threadId).toBe(fresh.body.task.threadId);
    expect((await botOf(bob, botId))!.tasks.map((task) => task.threadId).sort()).toEqual([bobThread, fresh.body.task.threadId].sort());
    expect((await botOf(alice, botId))!.tasks.map((task) => task.threadId)).toEqual([aliceThread]);
    expect((await botOf(alice, botId))!.threadId).toBe(aliceThread);
  }, 180_000);

  it("PT-2: a group chat is shared by its people and the bot speaks there; removing a person closes it to them", async () => {
    const bob = await signIn(BOB);
    const erin = await signIn(ERIN);
    const room = await api("POST", "/api/groups", alice, {
      name: "Dumpling & co.", memberIds: [botId], humanIds: [ids.alice, ids.bob, ids.erin],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
    });
    expect(room.status, room.text).toBe(201);
    const roomId = room.body.group.id as string;
    const roomThread = room.body.group.threadId as string;
    // erin holds no grant on the bot, yet talks to it in the group
    expect((await botOf(erin, botId))).toBeUndefined();
    for (const [auth, text] of [[alice, "group hello from alice"], [bob, "group hello from bob"], [erin, "group hello from erin"]] as const) {
      const posted = await api("POST", `/api/groups/${roomId}/messages`, auth, { text });
      expect(posted.status, posted.text).toBe(202);
    }
    for (const auth of [alice, bob, erin]) {
      const transcript = await waitFor(async () => {
        const got = await api("GET", `/api/threads/${roomThread}/messages`, auth);
        const text = JSON.stringify(got.body);
        return got.status === 200 && text.includes("group hello from alice") && text.includes("group hello from bob") && text.includes("group hello from erin") ? text : null;
      });
      expect(transcript).toBeTruthy();
    }
    await waitFor(async () => {
      const got = await api("GET", `/api/threads/${roomThread}/messages`, erin);
      return (got.body.messages as Array<{ role: string; kind: string; text?: string }> | undefined)?.some((m) => m.role === "bot" && m.kind === "text" && m.text) ?? false;
    }, 30_000);
    // erin still reads none of the private threads
    expect((await api("GET", `/api/threads/${bobThread}/messages`, erin)).status).toBe(404);
    // carol is not in the group
    const carol = await signIn(CAROL);
    expect((await api("GET", `/api/threads/${roomThread}/messages`, carol)).status).toBe(404);
    expect((await api("POST", `/api/groups/${roomId}/messages`, carol, { text: "let me in" })).status).toBe(404);

    // alice removes erin: the group closes to her at once
    const removed = await api("PATCH", `/api/groups/${roomId}`, alice, { humanIds: [ids.alice, ids.bob] });
    expect(removed.status, removed.text).toBe(200);
    expect((await api("GET", `/api/threads/${roomThread}/messages`, erin)).status).toBe(404);
    expect((await api("POST", `/api/groups/${roomId}/messages`, erin, { text: "still here?" })).status).toBe(404);
    expect((await api("GET", `/api/threads/${roomThread}/messages`, bob)).status).toBe(200);
  }, 120_000);
});
