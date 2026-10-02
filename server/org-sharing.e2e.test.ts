// Slice 3 of the Perspicax organization through the real server, against the
// local fake provider (server/testing/fake-oidc-provider.ts, now with the
// Pulsa Bot directory) and the fake Claude CLI:
//
//   S3-3  the directory creates principals before anyone signs in; the first
//         sign-in lands on the same principal
//   S3-4  B: an admin shares a bot with bob; bob sees it, writes, gets a reply
//         produced with the organization key; dave sees nothing of it
//   S3-5  C: the grant removed, bob's stream ends and the bot is gone at once
//   S3-6  F: no org key (an admin cleared it in Settings > Connections; the
//         org key switch is gone since 2026-10-01) or no installed engine
//         gives an access card to the person who spoke, no turn
//   S3-6b F on every path a person reaches: a queued send, an edit, a bot hop
//   S3-7  a member's bot never gets full access
//   S3-7b its cards that reach past its own workspace (a shell command, a
//         write to the shared Claude settings, a read of the config) wait for
//         an organization admin; a file inside its workspace is the owner's
//   S3-10 the directory is the backstop: a disabled person's session ends
//   S3-11 the authenticated health lists the engines and whether installed
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { connect, type Socket } from "node:net";
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
const FAKE_ACP = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key";
const ALICE: FakeOidcUser = { sub: "01J9S3ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9S3BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const DAVE: FakeOidcUser = { sub: "01J9S3DAVE000000000000000D", email: "dave@example.test", name: "Dave", preferred_username: "dave", role: "employee" };
const ERIN: FakeOidcUser = { sub: "01J9S3ERIN000000000000000E", email: "erin@example.test", name: "Erin", preferred_username: "erin", role: "employee" };
const PACKAGE_VERSION = (JSON.parse(readFileSync(join(SERVER_DIR, "..", "package.json"), "utf8")) as { version: string }).version;

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let dump = "";
let log = "";
let idp: FakeOidcProvider;
let prompts = "";
const TEST_CAPABILITY_KEY = "org-sharing-fixture-capability";

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

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

/** An open /api/events stream: everything it received so far, and whether the server ended it. */
async function openStream(auth: Auth): Promise<{ text: () => string; ended: Promise<void>; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  expect(body.ticket).toMatch(/^sgx_tick_/);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      expect(res.statusCode).toBe(200);
      const ended = new Promise<void>((done) => { res.on("end", () => done()); res.on("close", () => done()); res.on("error", () => done()); });
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, ended, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
}

const botsOf = async (auth: Auth) => (await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; threadId: string; messages: Array<{ kind: string; role: string; text?: string; access?: any }> }>;

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
      HOME: home, USERPROFILE: home, SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "5",
      SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
      SAGAX_ORG_NAME: "Acme",
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: TEST_CAPABILITY_KEY,
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

posixOnly("Perspicax organization, slice 3: directory, sharing with a user, access cards", () => {
  let alice: Auth;
  let bobId = "";
  let daveId = "";
  let shared: { id: string; threadId: string };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    chmodSync(FAKE_ACP, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, DAVE, ERIN].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-sharing-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    dump = join(home, "claude-dump.json");
    // every prompt any fake Claude process receives: the proof a turn never ran
    prompts = join(home, "claude-prompts.jsonl");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: {
        claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_PROMPTS: prompts }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        // a turn that never ends on its own: how a bot is held busy
        stuck: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_PROMPTS: prompts }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        ghost: { driver: "claudeAgent", config: { cli: "/nonexistent/claude", fullAuto: true } },
        // held open with its permission broker reachable: how cards are raised
        hold: { driver: "claudeAgent", environment: { FAKE_CLAUDE_MODE: "hang", FAKE_CLAUDE_DUMP: join(home, "hold-dump.json") }, config: { cli: FAKE_CLAUDE, fullAuto: true } },
        grok: { driver: "grokAgent", config: { cli: FAKE_ACP, fullAuto: false } },
      },
    }));
    await start();
    alice = await signIn(ALICE);
  }, 40_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("S3-3: lists the directory's people with principal ids before they sign in, and a sign-in lands on the same one", async () => {
    const org = await waitFor(async () => {
      const got = await api("GET", "/api/org", alice);
      return got.body.link?.state === "ok" ? got.body : null;
    });
    expect(org).toMatchObject({ org: { name: "Acme", identity: { kind: "perspicax", issuer: idp.issuer, serverId: idp.serverId } }, viewerRole: "admin", settings: { orgKeyConfigured: true } });
    expect(org.settings).not.toHaveProperty("memberBotsUseOrgKey");
    expect(idp.directoryRequests.at(-1)).toMatchObject({ authorization: `Bearer ${idp.linkToken}`, "x-pulsabot-version": PACKAGE_VERSION });
    const people = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string; role: string; disabled: boolean }>;
    expect(people.map((p) => p.login)).toEqual(["alice", "bob", "dave", "erin"]);
    expect(people.find((p) => p.login === "alice")?.role).toBe("admin");
    bobId = people.find((p) => p.login === "bob")!.principalId;
    daveId = people.find((p) => p.login === "dave")!.principalId;
    expect(bobId).toMatch(/^pr_/);
    const bob = await signIn(BOB);
    expect((await api("GET", "/api/auth/session", bob)).body.principalId).toBe(bobId);
    // a member reads the directory and the organization, never changes the settings
    expect((await api("GET", "/api/org/directory", bob)).status).toBe(200);
    expect((await api("GET", "/api/org", bob)).body.viewerRole).toBe("member");
    expect((await api("PATCH", "/api/org/settings", bob, { interimAttachDays: 3 })).status).toBe(403);
    // the retired switch is refused, even from an admin
    expect((await api("PATCH", "/api/org/settings", alice, { memberBotsUseOrgKey: true })).status).toBe(400);
    expect((await api("POST", "/api/org/invites", alice, { email: "x@example.test" })).status).toBe(403);
  });

  it("S3-11: the authenticated health lists the engines and which are installed", async () => {
    const engines = (await api("GET", "/api/health", alice)).body.engines as Array<{ instanceId: string; driver: string; installed: boolean }>;
    expect(engines.find((e) => e.instanceId === "claude")).toMatchObject({ driver: "claudeAgent", installed: true });
    expect(engines.find((e) => e.instanceId === "ghost")).toMatchObject({ driver: "claudeAgent", installed: false });
    expect(engines.find((e) => e.instanceId === "grok")).toMatchObject({ installed: true });
    // a member signed in reads it too; a session-less local caller (any bot's
    // shell on this shared server) learns the app name only
    const bob = await signIn(BOB);
    expect(Array.isArray((await api("GET", "/api/health", bob)).body.engines)).toBe(true);
    const bare = await api("GET", "/api/health");
    expect(bare.status).toBe(200);
    expect(bare.body).toEqual({ app: "openmausbot", product: "sagax" });
  });

  it("S3-4 (B): shared with bob, answered with the org key; dave sees none of it", async () => {
    // The organization's key serves by itself (2026-10-01): bob has no
    // subscription and no key of his own. Slice 8: the settings also carry
    // the interim attach window (none here).
    expect((await api("GET", "/api/org", alice)).body.settings).toEqual({ orgKeyConfigured: true, interimAttach: { until: null, people: 0 } });
    shared = await createBot(alice, "Xavier", "claude");
    const refusals = [
      await api("POST", `/api/bots/${shared.id}/direct-grants`, alice, { userId: "bob@example.test" }),
      await api("POST", `/api/bots/${shared.id}/direct-grants`, alice, { userId: (await api("GET", "/api/auth/session", alice)).body.principalId }),
    ];
    expect(refusals.map((r) => r.body.code)).toEqual(["unknown_person", "self"]);
    const granted = await api("POST", `/api/bots/${shared.id}/direct-grants`, alice, { userId: bobId });
    expect(granted.status, granted.text).toBe(200);
    expect(granted.body.directGrants).toEqual([bobId]);

    const bob = await signIn(BOB);
    const dave = await signIn(DAVE);
    const daveStream = await openStream(dave);
    expect((await botsOf(bob)).map((b) => b.id)).toContain(shared.id);
    const sent = await api("POST", `/api/bots/${shared.id}/messages`, bob, { text: "ping from bob" });
    expect(sent.status, sent.text).toBe(202);
    const reply = await waitFor(async () => {
      const bot = (await botsOf(bob)).find((b) => b.id === shared.id);
      return bot?.messages.find((m) => m.role === "bot" && m.kind === "text" && m.text) ?? null;
    }, 30_000);
    expect(reply.text).toBeTruthy();
    // organization mode names the person by their display name, never their email
    const asked = (await botsOf(bob)).find((b) => b.id === shared.id)?.messages
      .find((m) => m.role === "user" && m.text === "ping from bob") as { sender?: { name: string } } | undefined;
    expect(asked?.sender?.name).toBe("Bob");
    expect(JSON.stringify(asked)).not.toContain("bob@example.test");
    await waitFor(async () => existsSync(dump));
    const env = (JSON.parse(readFileSync(dump, "utf8")) as { env: Record<string, string> }).env;
    expect(env.ANTHROPIC_API_KEY).toBe(ORG_KEY);
    expect(log).toContain(`[omb-turn] bot=${shared.id}`);
    // the thread says what paid, without the key
    const digest = await waitFor(async () => (await botsOf(bob)).find((b) => b.id === shared.id)?.messages.find((m) => m.kind === "digest" && (m as { digest?: { access?: unknown } }).digest?.access) ?? null, 15_000);
    expect((digest as unknown as { digest: { access: unknown } }).digest.access).toEqual({ via: "org-key", payer: "organization" });
    expect(JSON.stringify(digest)).not.toContain(ORG_KEY);

    expect((await botsOf(dave)).map((b) => b.id)).not.toContain(shared.id);
    expect([403, 404]).toContain((await api("GET", `/api/threads/${shared.threadId}/messages`, dave)).status);
    expect([403, 404]).toContain((await api("POST", `/api/bots/${shared.id}/messages`, dave, { text: "hi" })).status);
    const search = await api("GET", `/api/search?q=${encodeURIComponent("ping from bob")}`, dave);
    expect(search.text).not.toContain(shared.id);
    expect(search.text).not.toContain(shared.threadId);
    await sleep(300);
    expect(daveStream.text()).not.toContain(shared.id);
    expect(daveStream.text()).not.toContain(shared.threadId);
    daveStream.close();
  }, 60_000);

  it("S3-5 (C): removing bob's grant ends his stream and the bot is gone for him at once", async () => {
    const bob = await signIn(BOB);
    const stream = await openStream(bob);
    const removed = await api("DELETE", `/api/bots/${shared.id}/direct-grants/${bobId}`, alice);
    expect(removed.status, removed.text).toBe(200);
    expect(removed.body.directGrants).toEqual([]);
    await Promise.race([stream.ended, sleep(5_000).then(() => { throw new Error("bob's stream stayed open"); })]);
    expect((await botsOf(bob)).map((b) => b.id)).not.toContain(shared.id);
    expect([403, 404]).toContain((await api("POST", `/api/bots/${shared.id}/messages`, bob, { text: "still here?" })).status);
    expect([403, 404]).toContain((await api("GET", `/api/threads/${shared.threadId}/messages`, bob)).status);
    // only the owner removes, and only a grant that exists
    expect((await api("DELETE", `/api/bots/${shared.id}/direct-grants/${bobId}`, alice)).status).toBe(404);
  });

  it("S3-6 (F): without the org key or an installed engine, the send is accepted and the card says why", async () => {
    // an admin clears the organization's key in Settings > Connections
    expect((await api("PATCH", "/api/config", alice, { anthropic: { key: "" } })).status).toBe(200);
    await waitFor(async () => (await api("GET", "/api/org", alice)).body.settings?.orgKeyConfigured === false);
    expect((await api("POST", `/api/bots/${shared.id}/direct-grants`, alice, { userId: bobId })).status).toBe(200);
    const bob = await signIn(BOB);
    const aliceStream = await openStream(alice);
    const bobStream = await openStream(bob);
    const before = readFileSync(dump, "utf8");
    const sent = await api("POST", `/api/bots/${shared.id}/messages`, bob, { text: "no key now" });
    expect(sent.status, sent.text).toBe(202);
    const card = await waitFor(async () => {
      const bot = (await botsOf(bob)).find((b) => b.id === shared.id);
      return bot?.messages.find((m) => m.kind === "access") ?? null;
    });
    // bob spoke: the card is his to act on (his subscription, his key)
    expect(card.access).toMatchObject({ reason: "no_access", engine: "Claude", botId: shared.id, payer: "speaker", payerPrincipalId: bobId, cause: "no_credentials", subscriptionSignIn: true, keysUrl: `${idp.issuer}/console/pulsabot/keys` });
    expect(readFileSync(dump, "utf8")).toBe(before);
    // private threads: bob hears his own thread's failure; alice, the bot's
    // owner, hears nothing of bob's conversation
    await waitFor(async () => bobStream.text().includes("turn-failed"));
    bobStream.close();
    await sleep(300);
    expect(aliceStream.text()).not.toContain("no key now");
    expect(aliceStream.text()).not.toContain("turn-failed");
    aliceStream.close();

    // the same rule in a room: bob's message there gets the card, not a turn
    const aliceId = (await api("GET", "/api/auth/session", alice)).body.principalId;
    const room = await api("POST", "/api/groups", alice, { name: "Pay questions", memberIds: [shared.id], humanIds: [aliceId, bobId],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } } });
    expect(room.status, room.text).toBe(201);
    const posted = await api("POST", `/api/groups/${room.body.group.id}/messages`, bob, { text: "room ping" });
    expect(posted.status, posted.text).toBe(202);
    const roomCard = await waitFor(async () => {
      const got = await api("GET", `/api/threads/${room.body.group.threadId}/messages`, bob);
      return (got.body.messages as Array<{ kind: string; access?: unknown }> | undefined)?.find((m) => m.kind === "access") ?? null;
    });
    expect(roomCard.access).toMatchObject({ reason: "no_access", botId: shared.id });
    expect(readFileSync(dump, "utf8")).toBe(before);

    const ghost = await createBot(alice, "Ghost", "ghost");
    expect((await api("POST", `/api/bots/${ghost.id}/messages`, alice, { text: "hello?" })).status).toBe(202);
    const missing = await waitFor(async () => (await botsOf(alice)).find((b) => b.id === ghost.id)?.messages.find((m) => m.kind === "access") ?? null);
    expect(missing.access).toMatchObject({ reason: "engine_missing", botId: ghost.id });

    // 2026-10-01: the server's own sign-ins no longer serve an admin's own
    // bot; an engine without a personal sign-in or key and no org key is refused
    const own = await createBot(alice, "Grokker", "grok");
    expect((await api("POST", `/api/bots/${own.id}/messages`, alice, { text: "ping" })).status).toBe(202);
    const ownCard = await waitFor(async () => (await botsOf(alice)).find((b) => b.id === own.id)?.messages.find((m) => m.kind === "access") ?? null);
    expect(ownCard.access).toMatchObject({ reason: "no_access", payer: "owner", cause: "no_credentials" });
    expect(ownCard.access.subscriptionSignIn).toBeUndefined();
  }, 60_000);

  it("S3-6b (F): bob's queued send, his edit and his bot's ask_bot on alice's bot get the card, never a turn", async () => {
    // the organization key is still cleared (S3-6); bob still holds his grant on Xavier
    const bob = await signIn(BOB);
    const promptsNow = () => (existsSync(prompts) ? readFileSync(prompts, "utf8") : "");
    const accessCards = async (auth: Auth, botId: string) =>
      ((await botsOf(auth)).find((b) => b.id === botId)?.messages ?? []).filter((m) => m.kind === "access");

    // 1. queued: alice's turn holds the bot, bob's words wait for it. Alice
    // runs on her own Claude subscription (the server's sign-ins no longer
    // serve an admin, 2026-10-01): the marker a finished sign-in leaves.
    const aliceId = (await api("GET", "/api/auth/session", alice)).body.principalId as string;
    const aliceLogin = join(home, ".sagax", "principals", aliceId, "claude");
    mkdirSync(aliceLogin, { recursive: true, mode: 0o700 });
    writeFileSync(join(aliceLogin, ".pulsabot-login.json"), JSON.stringify({ at: Date.now() }), { mode: 0o600 });
    const held = await createBot(alice, "Holder", "stuck");
    expect((await api("POST", `/api/bots/${held.id}/direct-grants`, alice, { userId: bobId })).status).toBe(200);
    expect((await api("POST", `/api/bots/${held.id}/messages`, alice, { text: "hold on, alice" })).status).toBe(202);
    await waitFor(async () => promptsNow().includes("hold on, alice"));
    const queued = await api("POST", `/api/bots/${held.id}/messages`, bob, { text: "queued from bob" });
    expect(queued.status, queued.text).toBe(202);
    // never folded into alice's running turn: private threads put bob's
    // words in his own conversation with the bot, not behind alice's
    expect(queued.body.steered).toBeUndefined();
    const aliceThread = (await botsOf(alice)).find((b) => b.id === held.id)!.threadId;
    const bobThread = (await botsOf(bob)).find((b) => b.id === held.id)!.threadId;
    expect(bobThread).not.toBe(aliceThread);
    expect(JSON.stringify((await api("GET", `/api/threads/${aliceThread}/messages`, alice)).body)).not.toContain("queued from bob");
    const stopped = await api("POST", `/api/bots/${held.id}/interrupt`, alice, {});
    expect(stopped.status, stopped.text).toBeLessThan(300);
    const heldCard = await waitFor(async () => (await accessCards(bob, held.id))[0] ?? null);
    expect(heldCard.access).toMatchObject({ reason: "no_access", botId: held.id });
    await waitFor(async () => log.includes(`bot=${held.id} refused: no_access`));
    expect(promptsNow()).not.toContain("queued from bob");

    // 2. edit: bob reruns his own message on Xavier
    const xavier = (await botsOf(bob)).find((b) => b.id === shared.id)!;
    const mine = xavier.messages.find((m) => m.role === "user" && m.kind === "text" && m.text === "no key now") as { id?: string } | undefined;
    expect(mine?.id).toBeTruthy();
    const cardsBefore = (await accessCards(bob, shared.id)).length;
    const edited = await api("POST", `/api/bots/${shared.id}/messages/${mine!.id}/edit`, bob, { text: "edited by bob" });
    expect(edited.status, edited.text).toBe(202);
    await waitFor(async () => (await accessCards(bob, shared.id)).length > cardsBefore);
    await sleep(300);
    expect(promptsNow()).not.toContain("edited by bob");

    // 3. a bot hop: bob's own bot asks alice's Xavier
    const bee = await createBot(bob, "Bee", "claude");
    const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openmausbot-test-capability": TEST_CAPABILITY_KEY },
      body: JSON.stringify({ botId: bee.id, threadId: bee.threadId, kind: "agents" }),
    });
    expect(minted.status).toBe(201);
    const token = ((await minted.json()) as { token: string }).token;
    const aliceCards = (await accessCards(alice, shared.id)).length;
    const hop = await fetch(`${BASE}/api/internal/ask-bot`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ toBotId: shared.id, message: "hop from bee" }),
    });
    const hopText = await hop.text();
    expect(hop.status, hopText).toBe(200);
    await waitFor(async () => (await accessCards(alice, shared.id)).length > aliceCards);
    await sleep(300);
    expect(promptsNow()).not.toContain("hop from bee");
  }, 60_000);

  it("S3-7: a member's bot never gets full access, even from an admin", async () => {
    const erin = await signIn(ERIN);
    const created = await api("POST", "/api/bots", erin, { name: "Zed" });
    expect(created.status, created.text).toBe(201);
    const zed = created.body.bot;
    expect(zed.ownerUserId).toBe((await api("GET", "/api/auth/session", erin)).body.principalId);
    // an admin reaches a member's Direct only when it is shared with them
    expect((await api("PATCH", `/api/bots/${zed.id}`, alice, { approvalMode: "full" })).status).toBe(404);
    const aliceId = (await api("GET", "/api/auth/session", alice)).body.principalId;
    expect((await api("POST", `/api/bots/${zed.id}/direct-grants`, erin, { userId: aliceId })).status).toBe(200);
    // the member owner asking Full or Custom gets the org rule, not a field refusal
    const ownFull = await api("PATCH", `/api/bots/${zed.id}`, erin, { approvalMode: "full" });
    expect(ownFull.status, ownFull.text).toBe(409);
    expect(ownFull.body.code).toBe("member_bot_full_access");
    expect((await api("PATCH", `/api/bots/${zed.id}`, erin, { approvalMode: "custom" })).body.code).toBe("member_bot_full_access");
    // any other approval level stays outside a member's fields
    expect((await api("PATCH", `/api/bots/${zed.id}`, erin, { approvalMode: "auto" })).status).toBe(403);
    const full = await api("PATCH", `/api/bots/${zed.id}`, alice, { approvalMode: "full" });
    expect(full.status, full.text).toBe(409);
    expect(full.body.code).toBe("member_bot_full_access");
    expect((await api("PATCH", `/api/bots/${zed.id}`, alice, { approvalMode: "custom" })).body.code).toBe("member_bot_full_access");
    expect((await api("GET", "/api/org/approvals", alice)).body).toEqual({ approvals: [] });
    expect((await api("GET", "/api/org/approvals", erin)).status).toBe(403);
  });

  it("S3-7b: a member's bot's card outside its workspace needs an admin; the owner's answer is 403", async () => {
    // the organization's key is back: erin's own turn runs on it
    expect((await api("PATCH", "/api/config", alice, { anthropic: { key: ORG_KEY } })).status).toBe(200);
    const erin = await signIn(ERIN);
    const wren = await createBot(erin, "Wren", "hold");
    const holdDump = join(home, "hold-dump.json");
    expect((await api("POST", `/api/bots/${wren.id}/messages`, erin, { text: "hold for cards" })).status).toBe(202);
    await waitFor(async () => existsSync(holdDump), 20_000);
    const socketPath = (JSON.parse(readFileSync(holdDump, "utf8")) as { mcpConfig: any }).mcpConfig.mcpServers.ogb.args.at(-1) as string;
    const sockets: Socket[] = [];
    const ask = async (tool: string, input: Record<string, unknown>) => {
      const socket = connect(socketPath);
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => { socket.once("connect", resolve); socket.once("error", reject); });
      const id = `s37b-${tool}-${sockets.length}`;
      let answer: any;
      let buffer = "";
      socket.on("data", (chunk) => { buffer += chunk; if (buffer.includes("\n")) answer = JSON.parse(buffer.split("\n")[0]!); });
      socket.write(JSON.stringify({ t: "ask", id, kind: "permission", tool, input }) + "\n");
      const card = await waitFor(async () => {
        const got = await api("GET", `/api/threads/${wren.threadId}/messages?limit=100`, erin);
        return (got.body.messages as Array<{ card?: any }> | undefined)?.find((m) => m.card?.requestId === id)?.card ?? null;
      });
      return { id, card, answer: () => answer };
    };
    const respond = (auth: Auth, requestId: string, extra: Record<string, unknown> = {}) =>
      api("POST", `/api/threads/${wren.threadId}/respond`, auth, { requestId, behavior: "allow", ...extra });
    try {
      const data = realpathSync(join(home, ".sagax"));
      // the shared Claude settings (a hook there runs on every bot's next turn)
      const settings = await ask("Write", { file_path: join(data, ".claude", "settings.json"), content: "{\"hooks\":{}}" });
      expect(settings.card.adminApproval).toBe(true);
      expect(settings.card.allowSession).toBeUndefined();
      const refused = await respond(erin, settings.id);
      expect(refused.status, refused.text).toBe(403);
      expect(refused.body.code).toBe("admin_approval_required");
      expect(settings.answer()).toBeUndefined();
      // the workspace keys and the engines' credentials
      for (const [tool, input] of [
        ["Read", { file_path: join(data, "config.json") }],
        ["Edit", { file_path: join(data, ".claude", ".credentials.json"), old_string: "a", new_string: "b" }],
        ["Bash", { command: "cat /proc/1/environ" }],
      ] as const) {
        const card = await ask(tool, input);
        expect(card.card.adminApproval, tool).toBe(true);
        expect((await respond(erin, card.id)).body.code).toBe("admin_approval_required");
      }
      // an organization admin approves it, once
      expect((await respond(alice, settings.id, { always: true })).status).toBe(400);
      const approved = await respond(alice, settings.id);
      expect(approved.status, approved.text).toBe(200);
      await waitFor(async () => settings.answer()?.behavior === "allow");

      // a file inside the bot's own workspace is the owner's to approve, once
      const inside = await ask("Write", { file_path: join(data, "task-workspaces", wren.id, wren.threadId, "notes.md"), content: "hi" });
      expect(inside.card.adminApproval).toBeUndefined();
      expect(inside.card.allowSession).toBeUndefined();
      const owned = await respond(erin, inside.id);
      expect(owned.status, owned.text).toBe(200);
      await waitFor(async () => inside.answer()?.behavior === "allow");
    } finally {
      for (const socket of sockets) socket.destroy();
      await api("POST", `/api/bots/${wren.id}/interrupt`, erin, {});
    }
  }, 60_000);

  it("S3-10: a person disabled in Perspicax is logged out by the directory, with no back-channel push", async () => {
    const dave = await signIn(DAVE);
    expect((await api("GET", "/api/auth/session", dave)).status).toBe(200);
    idp.setDirectoryStatus(DAVE.sub, "disabled");
    await waitFor(async () => (await api("GET", "/api/auth/session", dave)).status === 401, 15_000);
    const people = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; disabled: boolean }>;
    expect(people.find((p) => p.principalId === daveId)?.disabled).toBe(true);
    // a disabled person cannot be granted
    expect((await api("POST", `/api/bots/${shared.id}/direct-grants`, alice, { userId: daveId })).body.code).toBe("unknown_person");
  }, 30_000);
});
