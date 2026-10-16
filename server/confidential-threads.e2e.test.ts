// Confidential threads (server/confidential-threads.ts) on a real Perspicax
// organization server, the fake provider and the fake engines. Ana opens a
// confidential thread on a team bot Bob owns (Bob is also an organization
// admin, the worst case) and Carl shares the bot. Then, of Ana's thread,
// nothing shows in:
//
//   CT-1  the flag: set at creation, refused off (permanent), on later only
//         with the confirmation
//   CT-2  memory: memory_update, memory_log and propose_routine are refused
//         in the thread; no daily log line; the bot's memory files hold
//         nothing of it; session_search by Carl, and by Ana from another
//         thread, finds nothing of it
//   CT-3  Bob's bot zip (owner route) and the console's bot package
//   CT-4  the console's file browser (tasks and attachments roots)
//   CT-5  incidents: the problem log and the console carry the fixed line
//         only; nothing reaches Bob's bots
//   CT-6  the server log ([omb-turn] says "(confidential)") and the console
//         log ring
//   CT-7  approvals: the card is Ana's alone; Bob neither sees nor answers
//         it, and the console's organization queue does not list it
//   CT-8  delete: messages, logs, the folder, the attachment and the
//         decision summaries are gone
//   CT-9  (security review) a peer's ask never lands in a confidential
//         thread, even the bot owner's selected one; from a confidential
//         thread ask_bot is refused and start_thread opens a confidential
//         child; the team backup leaves it out; a thread already working in
//         a shared folder is not converted; notifications carry only
//         « Fil confidentiel »
//   CT-10 (re-review) a bot acting as Ana from her ordinary thread lists
//         and searches nothing of her confidential threads
//   CT-11 (third review) Ana's AI clients (the member API) cannot read,
//         stream, write or answer a card in her confidential thread
//   CT-12 (fourth review) Ana allows a confidential card in Sagax: the bot
//         continues in that thread and the call runs once; her AI client
//         still cannot answer one
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CONFIDENTIAL_INCIDENT_TEXT } from "./confidential-threads.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";
import { ZipReader } from "./zip.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const SECRET = "ULTRASECRET";
const BOB: FakeOidcUser = { sub: "01J9CTBOB00000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "admin" };
const ANA: FakeOidcUser = { sub: "01J9CTANA00000000000000A", email: "ana@example.test", name: "Ana", preferred_username: "ana", role: "employee" };
const CARL: FakeOidcUser = { sub: "01J9CTCARL0000000000000C", email: "carl@example.test", name: "Carl", preferred_username: "carl", role: "employee" };
// 1x1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home = "";
let data = "";
let mcpDump = "";
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie?: string; bearer?: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
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
  return { status: res.status, body: parsed, text };
};
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const console$ = (user: FakeOidcUser): Auth => ({ bearer: idp.consoleAssertion({ sub: user.sub, aud: BASE, role: user.role === "admin" ? "admin" : "employee", teams: [] }) });

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

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
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
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

type Message = { id: string; kind: string; role: string; text?: string; card?: { requestId?: string; answered?: string; tool?: string }; tool?: { name?: string; ok?: boolean } };
const messagesOf = async (auth: Auth, threadId: string): Promise<Message[]> => {
  const got = await api("GET", `/api/threads/${threadId}/messages`, auth);
  return (got.body.messages ?? []) as Message[];
};
const replied = (messages: Message[], after: number) => messages.slice(after).some((m) => m.role === "bot" && m.kind === "text" && m.text);

/** Every text file under a folder, joined: what an operator with the disk
 * would read, here only to prove what the server wrote there. */
function filesText(root: string): string {
  if (!existsSync(root)) return "";
  let out = "";
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.size < 2_000_000) out += `\n${path}\n${readFileSync(path, "utf8")}`;
    }
  };
  walk(root);
  return out;
}

const readDump = (): Array<{ tool: string; ok: boolean; text?: string }> => {
  try { return (JSON.parse(readFileSync(mcpDump, "utf8")) as { calls: Array<{ tool: string; ok: boolean; text?: string }> }).calls; } catch { return []; }
};

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
      SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key",
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

posixOnly("confidential thread of a person on a team bot someone else owns", () => {
  let bob: Auth;
  let ana: Auth;
  let carl: Auth;
  let ids: Record<"bob" | "ana" | "carl", string>;
  let botId = "";
  let secretThread = "";
  let anaOrdinary = "";
  let attachmentName = "";

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    idp = await startFakeOidcProvider({ user: BOB });
    idp.directoryPeople = [BOB, ANA, CARL].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-confidential-"));
    data = join(home, ".sagax");
    mcpDump = join(home, "mcp-dump.json");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      // the organization's key for Grok Build (the asker bot of CT-7)
      xai: { key: "xai-test-org-key" },
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_MCP_DUMP: mcpDump,
            FAKE_CLAUDE_MCP_TEXT_LIMIT: "200000",
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
              { server: "agents", tool: "memory_update", arguments: { action: "append", text: `${SECRET} fact` }, when: "MEM-WRITE" },
              { server: "agents", tool: "memory_log", arguments: { text: `${SECRET} event` }, when: "MEM-LOG" },
              { server: "agents", tool: "propose_routine", arguments: { name: "Leak", instructions: `${SECRET} every day`, schedule: { type: "interval", every_minutes: 60 } }, when: "MAKE-ROUTINE" },
              { server: "agents", tool: "session_search", arguments: { query: SECRET }, when: "SEARCH-SECRET" },
              { server: "agents", tool: "list_threads", arguments: {}, when: "LIST-THREADS" },
              { server: "agents", tool: "ask_bot", arguments: { bot_id: "Equipe", message: "PEER-HELLO from a teammate" }, when: "ASK-EQUIPE" },
              { server: "agents", tool: "start_thread", arguments: { title: "Enfant", message: "child work" }, when: "OPEN-CHILD" },
              { server: "agents", tool: "coordinate_bots", arguments: { bot_ids: ["Messager"], message: "COORD leak", request_key: "leak-1" }, when: "COORD-OUT" },
              { server: "agents", tool: "act", arguments: { method: "GET", path: "/api/bots" }, when: "ACT-LIST" },
              // an outbound tool of another MCP server: the bot's data tools
              { server: "data", tool: "data_sql", arguments: { sql: "CREATE TABLE confidential_probe AS SELECT 1 AS x" }, when: "DATA-WRITE" },
              { server: "data", tool: "data_sql", arguments: { sql: "CREATE TABLE confidential_probe AS SELECT 1 AS x" }, when: "make exactly the call" },
              { server: "agents", tool: "act", arguments: { method: "GET", path: "/api/search", query: { q: `${SECRET}-ALPHA` } }, when: "ACT-SEARCH" },
            ]),
          },
          config: { cli: FAKE_CLAUDE, fullAuto: true },
        },
        asker: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "permission", FAKE_ACP_PERMISSION_TOOL_CALL: JSON.stringify({ kind: "other", title: "mcp__notes__save_note", rawInput: { text: "a note" } }) }, config: { cli: FAKE_ACP, fullAuto: false } },
      },
    }));
    await start();
    bob = await signIn(BOB);
    const people = await waitFor(async () => {
      const list = (await api("GET", "/api/org/directory", bob)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return list && list.length === 3 ? list : null;
    });
    const idOf = (login: string) => people.find((person) => person.login === login)!.principalId;
    ids = { bob: idOf("bob"), ana: idOf("ana"), carl: idOf("carl") };
    const created = await api("POST", "/api/bots", bob, { name: "Equipe" });
    expect(created.status, created.text).toBe(201);
    botId = created.body.bot.id;
    expect((await api("PATCH", `/api/bots/${botId}`, bob, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
    for (const who of ["ana", "carl"] as const) {
      const shared = await api("PUT", `/api/bots/${botId}/grants`, bob, { target: `user:${ids[who]}`, level: "use" });
      expect(shared.status, shared.text).toBe(200);
    }
    ana = await signIn(ANA);
    carl = await signIn(CARL);
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("CT-1: confidential at creation, never off again; an ordinary thread turns confidential only with the confirmation", async () => {
    const created = await api("POST", `/api/bots/${botId}/tasks`, ana, { title: `Projet ${SECRET}`, confidential: true });
    expect(created.status, created.text).toBe(201);
    expect(created.body.task.confidential).toBe(true);
    secretThread = created.body.task.threadId;
    for (const body of [{ confidential: false }, { confidential: false, confirmConfidential: true }]) {
      const off = await api("PATCH", `/api/bots/${botId}/tasks/${secretThread}`, ana, body);
      expect(off.status, off.text).toBe(409);
      expect(off.body.code).toBe("confidential_permanent");
    }
    const ordinary = await api("POST", `/api/bots/${botId}/tasks`, ana, { title: "Ordinaire" });
    expect(ordinary.status).toBe(201);
    expect(ordinary.body.task.confidential).toBeUndefined();
    anaOrdinary = ordinary.body.task.threadId;
    const later = await api("POST", `/api/bots/${botId}/tasks`, ana, { title: "Plus tard" });
    const unconfirmed = await api("PATCH", `/api/bots/${botId}/tasks/${later.body.task.threadId}`, ana, { confidential: true });
    expect(unconfirmed.status).toBe(400);
    const made = await api("PATCH", `/api/bots/${botId}/tasks/${later.body.task.threadId}`, ana, { confidential: true, confirmConfidential: true });
    expect(made.status, made.text).toBe(200);
    expect(made.body.task.confidential).toBe(true);
    expect((await api("PATCH", `/api/bots/${botId}/tasks/${later.body.task.threadId}`, ana, { confidential: false })).status).toBe(409);
    // the owner of the bot cannot touch it either
    expect([403, 404]).toContain((await api("PATCH", `/api/bots/${botId}/tasks/${secretThread}`, bob, { confidential: false })).status);
  }, 60_000);

  it("CT-2: nothing is remembered, logged, scheduled or found elsewhere", async () => {
    const before = (await messagesOf(ana, secretThread)).length;
    const sent = await api("POST", `/api/bots/${botId}/messages`, ana, { text: `${SECRET}-ALPHA MEM-WRITE MEM-LOG MAKE-ROUTINE`, threadId: secretThread });
    expect(sent.status, sent.text).toBe(202);
    await waitFor(async () => replied(await messagesOf(ana, secretThread), before));
    const calls = readDump();
    for (const tool of ["memory_update", "memory_log", "propose_routine"]) {
      const call = calls.find((entry) => entry.tool === tool);
      expect(call, `${tool}: ${JSON.stringify(calls)}`).toBeTruthy();
      expect(call!.ok, tool).toBe(false);
      expect(call!.text ?? "", tool).toMatch(/confidential/i);
    }
    // a file the turn made, and an upload, in the thread
    mkdirSync(join(data, "task-workspaces", botId, secretThread), { recursive: true });
    writeFileSync(join(data, "task-workspaces", botId, secretThread, "plan.md"), `${SECRET} output\n`);
    const uploaded = await fetch(`${BASE}/api/attachments`, { method: "POST", headers: { "content-type": "image/png", cookie: ana.cookie! }, body: PNG });
    expect(uploaded.status).toBe(201);
    const savedPath = ((await uploaded.json()) as { path: string }).path;
    attachmentName = savedPath.split("/").pop()!;
    const withFile = (await messagesOf(ana, secretThread)).length;
    expect((await api("POST", `/api/bots/${botId}/messages`, ana, { text: `${SECRET} picture\n\n<attached-image path="${savedPath}" name="x.png" />`, threadId: secretThread })).status).toBe(202);
    await waitFor(async () => replied(await messagesOf(ana, secretThread), withFile));

    // Ana's ordinary thread and Carl's own thread search for it: nothing
    const anaBefore = (await messagesOf(ana, anaOrdinary)).length;
    expect((await api("POST", `/api/bots/${botId}/messages`, ana, { text: "SEARCH-SECRET LIST-THREADS", threadId: anaOrdinary })).status).toBe(202);
    await waitFor(async () => replied(await messagesOf(ana, anaOrdinary), anaBefore));
    const anaSearch = readDump().find((entry) => entry.tool === "session_search");
    expect(anaSearch?.ok, JSON.stringify(readDump())).toBe(true);
    expect(anaSearch!.text).not.toMatch(/ALPHA|picture|ULTRASECRET-|Projet/);
    expect(anaSearch!.text).not.toContain(secretThread);
    const anaList = readDump().find((entry) => entry.tool === "list_threads");
    expect(anaList?.text ?? "").not.toContain(secretThread);
    expect(anaList?.text ?? "").not.toContain(SECRET);
    const carlBot = await waitFor(async () => ((await api("GET", "/api/bots", carl)).body.bots as Array<{ id: string; threadId: string }>).find((bot) => bot.id === botId));
    const carlBefore = (await messagesOf(carl, carlBot.threadId)).length;
    expect((await api("POST", `/api/bots/${botId}/messages`, carl, { text: "SEARCH-SECRET", threadId: carlBot.threadId })).status).toBe(202);
    await waitFor(async () => replied(await messagesOf(carl, carlBot.threadId), carlBefore));
    const carlSearch = readDump().find((entry) => entry.tool === "session_search");
    expect(carlSearch?.ok).toBe(true);
    expect(carlSearch!.text).not.toMatch(/ALPHA|picture|ULTRASECRET-|Projet/);
    expect(carlSearch!.text).not.toContain(secretThread);

    // the bot's memory files: no fact, no daily log line of the thread, while
    // the ordinary threads did leave theirs
    const memory = filesText(join(data, "workspaces", botId));
    expect(memory).not.toContain(SECRET);
    await waitFor(async () => filesText(join(data, "workspaces", botId, "memory", "log")).includes("Ordinaire"));
    // no routine was made from it
    const routines = await api("GET", "/api/routines", bob);
    expect(JSON.stringify(routines.body)).not.toContain(SECRET);
    expect((await api("POST", "/api/routines", ana, { botId, name: "x", instructions: "y", schedule: { kind: "interval", everyMinutes: 60 }, resultsThreadId: secretThread })).status).toBe(403);
  }, 120_000);

  it("CT-3: the bot owner's zip and the console's package leave it out", async () => {
    const zipText = async (response: Response) => {
      expect(response.status).toBe(200);
      const file = join(home, `export-${Date.now()}.zip`);
      writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      const reader = ZipReader.open(file, { maxEntries: 10_000, maxTotalBytes: 512 * 1024 ** 2, maxEntryBytes: 512 * 1024 ** 2 });
      const names = [...reader.entries.keys()];
      const text = names.map((name) => `${name}\n${reader.read(name).toString("latin1")}`).join("\n");
      return { names, text };
    };
    const owner = await zipText(await fetch(`${BASE}/api/bots/${botId}/export.zip?conversations=1&sharing=1`, { headers: { cookie: bob.cookie! } }));
    const consolePackage = await zipText(await fetch(`${BASE}/api/org/admin/bots/${botId}/package?format=zip&conversations=1`, { headers: { authorization: `Bearer ${console$(BOB).bearer}` } }));
    for (const zip of [owner, consolePackage]) {
      expect(zip.names).toContain("conversations/tasks.json");
      expect(zip.text).not.toContain(SECRET);
      expect(zip.text).not.toContain(secretThread);
      expect(zip.text).not.toContain(attachmentName);
    }
  }, 60_000);

  it("CT-4: the console's file browser shows neither its folder nor its attachment", async () => {
    // one console assertion per call: each is used once
    const tasks = await api("GET", `/api/org/admin/files/${botId}/list?root=tasks&path=`, console$(BOB));
    expect(tasks.status, tasks.text).toBe(200);
    expect(tasks.text).toContain(anaOrdinary);
    expect(tasks.text).not.toContain(secretThread);
    expect((await api("GET", `/api/org/admin/files/${botId}/list?root=tasks&path=${secretThread}`, console$(BOB))).status).toBe(404);
    expect((await api("GET", `/api/org/admin/files/${botId}/read?root=tasks&path=${secretThread}/plan.md`, console$(BOB))).status).toBe(404);
    const attachments = await api("GET", `/api/org/admin/files/${botId}/list?root=attachments&path=`, console$(BOB));
    expect(attachments.status).toBe(200);
    expect(attachments.text).not.toContain(attachmentName);
  }, 30_000);

  it("CT-5 and CT-6: an incident and the logs carry no text of it", async () => {
    const bobStream = await openStream(bob);
    const before = (await messagesOf(ana, secretThread)).length;
    expect((await api("POST", `/api/bots/${botId}/messages`, ana, { text: `${SECRET}-FAIL [fake:api-error]`, threadId: secretThread })).status).toBe(202);
    const incident = await waitFor(async () => {
      const rows = (await api("GET", "/api/org/admin/incidents", console$(BOB))).body.items as Array<{ threadId: string; detail: string; title: string | null }> | undefined;
      return rows?.find((row) => row.threadId === secretThread);
    }, 45_000);
    expect(incident.detail).toBe(CONFIDENTIAL_INCIDENT_TEXT);
    expect(incident.title).toBeNull();
    await waitFor(async () => (await messagesOf(ana, secretThread)).length > before);
    await sleep(1_000);
    expect(filesText(join(data, "problems"))).not.toContain(SECRET);
    // nothing reached any bot of Bob's (his Primary Bot's incidents thread)
    expect(JSON.stringify((await api("GET", "/api/bots", bob)).body)).not.toContain(SECRET);
    expect(bobStream.text()).not.toContain(SECRET);
    bobStream.close();
    // the server log: the turn lines say "(confidential)", no prompt
    expect(log).toContain("text=(confidential)");
    expect(log).not.toContain(SECRET);
    const ring = await api("GET", "/api/org/admin/logs?limit=500", console$(BOB));
    expect(ring.status, ring.text).toBe(200);
    expect(ring.text).not.toContain(SECRET);
  }, 90_000);

  it("CT-7: an approval in it is its owner's alone", async () => {
    const asker = await api("POST", "/api/bots", bob, { name: "Demandeur" });
    expect(asker.status, asker.text).toBe(201);
    const askerId = asker.body.bot.id as string;
    expect((await api("PATCH", `/api/bots/${askerId}`, bob, { modelSelection: { instanceId: "asker", model: "fake" } })).status).toBe(200);
    expect((await api("PUT", `/api/bots/${askerId}/grants`, bob, { target: `user:${ids.ana}`, level: "use" })).status).toBe(200);
    const thread = await api("POST", `/api/bots/${askerId}/tasks`, ana, { title: `Demande ${SECRET}`, confidential: true, approvalMode: "ask" });
    expect(thread.status, thread.text).toBe(201);
    const threadId = thread.body.task.threadId as string;
    const bobStream = await openStream(bob);
    expect((await api("POST", `/api/bots/${askerId}/messages`, ana, { text: `${SECRET} please run it`, threadId })).status).toBe(202);
    const card = await waitFor(async () => (await messagesOf(ana, threadId)).find((m) => m.card?.requestId && m.card.tool && !m.card.answered), 45_000);
    // Bob, owner of the bot and an organization admin, sees nothing to answer
    expect([403, 404]).toContain((await api("POST", `/api/threads/${threadId}/respond`, bob, { requestId: card.card!.requestId, behavior: "allow" })).status);
    const mine = await api("GET", "/api/org/admin/approvals", console$(BOB));
    expect(mine.text).not.toContain(threadId);
    const queue = await api("GET", "/api/org/admin/approvals?scope=org", console$(BOB));
    expect(queue.text).not.toContain(threadId);
    expect(queue.text).not.toContain(SECRET);
    expect(JSON.stringify((await api("GET", "/api/org/approvals", bob)).body)).not.toContain(threadId);
    await sleep(500);
    expect(bobStream.text()).not.toContain(threadId);
    expect(bobStream.text()).not.toContain(SECRET);
    bobStream.close();
    // Ana answers it: before confidential threads only the bot owner could
    const answered = await api("POST", `/api/threads/${threadId}/respond`, ana, { requestId: card.card!.requestId, behavior: "allow" });
    expect(answered.status, answered.text).toBe(200);
  }, 90_000);

  it("CT-8: deleting it wipes its messages, logs, folder, attachment and decision summaries", async () => {
    const folder = join(data, "task-workspaces", botId, secretThread);
    expect(existsSync(folder)).toBe(true);
    expect(existsSync(join(data, "attachments", attachmentName))).toBe(true);
    const gone = await api("DELETE", `/api/bots/${botId}/tasks/${secretThread}`, ana);
    expect(gone.status, gone.text).toBe(200);
    expect(existsSync(folder)).toBe(false);
    expect(existsSync(join(data, "attachments", attachmentName))).toBe(false);
    expect(existsSync(join(data, "events", `${secretThread}.ndjson`))).toBe(false);
    expect(existsSync(join(data, "native", `${secretThread}.ndjson`))).toBe(false);
    expect((await api("GET", `/api/threads/${secretThread}/messages`, ana)).status).toBe(404);
    await sleep(500);
    const decisions = filesText(join(data, "decisions"));
    for (const line of decisions.split("\n").filter((row) => row.includes(secretThread))) {
      expect(line).not.toContain("\"summary\"");
    }
    expect(decisions).not.toContain(SECRET);
  }, 30_000);

  it("CT-9: peers, children, backups, shared folders and notifications", async () => {
    // B1: Bob opens a confidential thread on his own bot: it is his selected
    // thread, yet a teammate's ask lands in an ordinary one
    const own = await api("POST", `/api/bots/${botId}/tasks`, bob, { title: `Bob ${SECRET}`, confidential: true });
    expect(own.status, own.text).toBe(201);
    const bobSecret = own.body.task.threadId as string;
    const messenger = await api("POST", "/api/bots", bob, { name: "Messager" });
    expect(messenger.status, messenger.text).toBe(201);
    const messengerId = messenger.body.bot.id as string;
    expect((await api("PATCH", `/api/bots/${messengerId}`, bob, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
    // a routine's turn asks Equipe with ask_bot (a Direct turn would coordinate instead)
    const routine = await api("POST", "/api/routines", bob, { name: "Ask Equipe", botId: messengerId, prompt: "ASK-EQUIPE now.", enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } });
    expect(routine.status, routine.text).toBe(201);
    const ran = await api("POST", `/api/routines/${routine.body.routine.id}/run`, bob, {});
    expect(ran.status, ran.text).toBeLessThan(300);
    expect(JSON.stringify(await messagesOf(bob, bobSecret))).not.toContain("PEER-HELLO");
    const landed = await waitFor(async () => {
      const equipe = ((await api("GET", "/api/bots", bob)).body.bots as Array<{ id: string; tasks: Array<{ threadId: string }> }>).find((bot) => bot.id === botId)!;
      for (const task of equipe.tasks) if (JSON.stringify(await messagesOf(bob, task.threadId)).includes("PEER-HELLO")) return task.threadId;
      return null;
    });
    expect(landed).not.toBe(bobSecret);
    expect(JSON.stringify(await messagesOf(bob, bobSecret))).not.toContain("PEER-HELLO");

    // B2: from a confidential thread, ask_bot is refused and a child thread is confidential
    const fresh = await api("POST", `/api/bots/${botId}/tasks`, ana, { title: "Encore", confidential: true });
    const anaSecret2 = fresh.body.task.threadId as string;
    const anaBefore = (await messagesOf(ana, anaSecret2)).length;
    expect((await api("POST", `/api/bots/${botId}/messages`, ana, { text: `${SECRET}-BETA COORD-OUT OPEN-CHILD`, threadId: anaSecret2 })).status).toBe(202);
    await waitFor(async () => replied(await messagesOf(ana, anaSecret2), anaBefore), 60_000);
    const refused = readDump().find((entry) => entry.tool === "coordinate_bots");
    expect(refused?.ok, JSON.stringify(readDump())).toBe(false);
    expect(refused?.text ?? "").toMatch(/confidential/i);
    const anaTasks = ((await api("GET", "/api/bots", ana)).body.bots as Array<{ id: string; tasks: Array<{ title: string; confidential?: boolean }> }>).find((bot) => bot.id === botId)!.tasks;
    expect(anaTasks.find((task) => task.title === "Enfant")?.confidential, JSON.stringify(anaTasks)).toBe(true);

    // B3: the team backup leaves confidential threads out
    const backup = await api("POST", "/api/teams/export", bob, { format: "backup" });
    expect(backup.status, backup.text.slice(0, 300)).toBe(200);
    expect(backup.text).not.toContain(SECRET);
    expect(backup.text).not.toContain(bobSecret);
    expect(backup.text).not.toContain(anaSecret2);

    // S2: a thread already working in the bot's project folder stays ordinary
    const project = join(data, "projects", "shared");
    mkdirSync(project, { recursive: true });
    const projectBot = await api("POST", "/api/bots", bob, { name: "Projet" });
    const projectId = projectBot.body.bot.id as string;
    const setCwd = await api("PATCH", `/api/bots/${projectId}`, bob, { modelSelection: { instanceId: "claude", model: "fake-model" }, cwd: project });
    expect(setCwd.status, setCwd.text).toBe(200);
    const projectThread = projectBot.body.bot.threadId as string;
    const projectBefore = (await messagesOf(bob, projectThread)).length;
    expect((await api("POST", `/api/bots/${projectId}/messages`, bob, { text: "work here", threadId: projectThread })).status).toBe(202);
    await waitFor(async () => replied(await messagesOf(bob, projectThread), projectBefore), 60_000);
    // once the turn has settled
    const convert = await waitFor(async () => {
      const tried = await api("PATCH", `/api/bots/${projectId}/tasks/${projectThread}`, bob, { confidential: true, confirmConfidential: true });
      return /Stop this thread/.test(tried.text) ? null : tried;
    });
    expect(convert.status, convert.text).toBe(409);
    expect(convert.body.code, convert.text).toBe("confidential_shared_folder");

    // S5: a notification about a confidential thread says only « Fil confidentiel »
    const anaStream = await openStream(ana);
    const quiet = (await messagesOf(ana, anaSecret2)).length;
    expect((await api("POST", `/api/bots/${botId}/messages`, ana, { text: `${SECRET}-GAMMA`, threadId: anaSecret2 })).status).toBe(202);
    await waitFor(async () => replied(await messagesOf(ana, anaSecret2), quiet), 60_000);
    await sleep(800);
    const notices = anaStream.text().split("\n").filter((line) => line.includes('"kind":"notify"') && line.includes(anaSecret2));
    expect(notices.length, anaStream.text().slice(-1500)).toBeGreaterThan(0);
    for (const line of notices) {
      expect(line).toContain("Fil confidentiel");
      expect(line).not.toContain("hello from fake claude");
    }
    anaStream.close();
  }, 240_000);

  it("CT-10: act from an ordinary thread never reaches a confidential one", async () => {
    const before = (await messagesOf(ana, anaOrdinary)).length;
    expect((await api("POST", `/api/bots/${botId}/messages`, ana, { text: "ACT-LIST ACT-SEARCH", threadId: anaOrdinary })).status).toBe(202);
    await waitFor(async () => replied(await messagesOf(ana, anaOrdinary), before), 60_000);
    const acts = readDump().filter((entry) => entry.tool === "act");
    expect(acts.length, JSON.stringify(readDump())).toBe(2);
    // the listing came back without the confidential threads, the search without their hits
    expect(acts[0]!.ok, acts[0]!.text).toBe(true);
    expect(acts[0]!.text).toContain("Ordinaire");
    expect(acts[1]!.ok, acts[1]!.text).toBe(true);
    for (const act of acts) {
      expect(act.text ?? "").not.toContain("Projet ULTRASECRET");
      expect(act.text ?? "").not.toContain("Encore");
      expect(act.text ?? "").not.toMatch(/ULTRASECRET-(?:ALPHA|BETA|GAMMA) /);
    }
  }, 120_000);

  it("CT-11: an AI client of Ana (the member API) neither reads, writes, streams nor answers a card in her confidential thread", async () => {
    const member = (method: string, sub: string, body?: unknown) => api(method, `/api/org/member/${sub}`, {
      bearer: idp.consoleAssertion({ sub: ANA.sub, aud: BASE, role: "employee", teams: [], claims: (c) => ({ ...c, act: { sub: "perspicax-mcp" } }) }),
    }, body);
    const asker = await api("POST", "/api/bots", bob, { name: "Demandeur2" });
    const askerId = asker.body.bot.id as string;
    expect((await api("PATCH", `/api/bots/${askerId}`, bob, { modelSelection: { instanceId: "asker", model: "fake" } })).status).toBe(200);
    expect((await api("PUT", `/api/bots/${askerId}/grants`, bob, { target: `user:${ids.ana}`, level: "use" })).status).toBe(200);
    const thread = await api("POST", `/api/bots/${askerId}/tasks`, ana, { title: `Client ${SECRET}`, confidential: true, approvalMode: "ask" });
    const threadId = thread.body.task.threadId as string;
    expect((await api("POST", `/api/bots/${askerId}/messages`, ana, { text: `${SECRET}-DELTA please`, threadId })).status).toBe(202);
    const card = await waitFor(async () => (await messagesOf(ana, threadId)).find((m) => m.card?.requestId && m.card.tool && !m.card.answered), 45_000);
    const requestId = card.card!.requestId!;

    const listed = await member("GET", "bots");
    expect(listed.status, listed.text).toBe(200);
    expect(listed.text).not.toContain(threadId);
    expect(listed.text).not.toContain(SECRET);
    expect((await member("GET", `threads/${threadId}`)).status).toBe(404);
    expect((await member("GET", `threads/${threadId}/stream`)).status).toBe(404);
    expect((await member("POST", `bots/${askerId}/messages`, { text: "AI client writes in", threadId })).status).toBe(404);
    expect((await member("GET", `approvals/${requestId}?threadId=${threadId}`)).status).toBe(404);
    expect((await member("POST", `approvals/${requestId}`, { threadId, decision: "allow" })).status).toBe(404);
    // without a thread: never the confidential one, even selected
    await member("POST", `bots/${askerId}/messages`, { text: "AI client implicit" });
    const after = await messagesOf(ana, threadId);
    expect(JSON.stringify(after)).not.toContain("AI client");
    expect(after.find((m) => m.card?.requestId === requestId)?.card?.answered).toBeUndefined();
    // and Ana, in Sagax, still answers it
    expect((await api("POST", `/api/threads/${threadId}/respond`, ana, { requestId, behavior: "deny" })).status).toBe(200);
  }, 120_000);

  it("CT-12: the owner's Allow continues in the same thread and the call runs once", async () => {
    const thread = await api("POST", `/api/bots/${botId}/tasks`, ana, { title: "Donnees", confidential: true });
    const threadId = thread.body.task.threadId as string;
    const before = (await messagesOf(ana, threadId)).length;
    expect((await api("POST", `/api/bots/${botId}/messages`, ana, { text: "DATA-WRITE", threadId })).status).toBe(202);
    await waitFor(async () => replied(await messagesOf(ana, threadId), before), 60_000);
    const first = readDump().find((entry) => entry.tool === "data_sql");
    expect(first, JSON.stringify(readDump())).toBeTruthy();
    expect(first!.ok).toBe(false);
    expect(first!.text).toMatch(/Allow/);
    const card = await waitFor(async () => (await messagesOf(ana, threadId)).find((m) => m.card?.requestId && m.card.tool === "data_sql" && !m.card.answered));
    // her AI client cannot answer it
    const member = (method: string, sub: string, body?: unknown) => api(method, `/api/org/member/${sub}`, {
      bearer: idp.consoleAssertion({ sub: ANA.sub, aud: BASE, role: "employee", teams: [], claims: (c) => ({ ...c, act: { sub: "perspicax-mcp" } }) }),
    }, body);
    expect((await member("POST", `approvals/${card.card!.requestId}`, { threadId, decision: "allow" })).status).toBe(404);
    // Ana allows it in Sagax: the bot is asked again in this thread, and the call runs
    const settle = (await messagesOf(ana, threadId)).length;
    const allowed = await api("POST", `/api/threads/${threadId}/respond`, ana, { requestId: card.card!.requestId, behavior: "allow" });
    expect(allowed.status, allowed.text).toBe(200);
    expect(allowed.body.outcome).toBe("allowed-once");
    await waitFor(async () => replied(await messagesOf(ana, threadId), settle), 60_000);
    const second = readDump().find((entry) => entry.tool === "data_sql");
    expect(second?.ok, JSON.stringify(readDump())).toBe(true);
    const continued = await messagesOf(ana, threadId);
    expect(continued.some((m) => m.role === "user" && /make exactly the call/.test(m.text ?? ""))).toBe(true);
    // once: the same call again takes a new card
    const again = continued.length;
    expect((await api("POST", `/api/bots/${botId}/messages`, ana, { text: "make exactly the call again", threadId })).status).toBe(202);
    await waitFor(async () => replied(await messagesOf(ana, threadId), again), 60_000);
    const third = readDump().find((entry) => entry.tool === "data_sql");
    expect(third?.ok).toBe(false);
    expect(third?.text ?? "").toMatch(/Allow/);
  }, 180_000);
});
