// Per-bot team memory sharing on a Perspicax organization server, through
// the real server, the fake provider (server/testing/fake-oidc-provider.ts)
// and the fake Claude CLI. Each 1:1 thread with a bot is its person's own,
// so a team-memory card proposed in one person's thread lists for them and
// never for another member of the section, "shared" or "private".
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
const ORG_KEY = "sk-ant-test-org-key";
const CAPABILITY_KEY = "team-memory-sharing-org-capability";
const ALICE: FakeOidcUser = { sub: "01J9TMALICE000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9TMBOB0000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9TMCAROL00000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };

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
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY,
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

/** The bot's shell proposes a team-memory entry from this thread. */
async function proposeTeamMemory(botId: string, threadId: string, name: string): Promise<string> {
  const minted = await fetch(`${BASE}/api/testing/internal-capability`, {
    method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY },
    body: JSON.stringify({ botId, threadId, kind: "agents" }),
  });
  expect(minted.status).toBe(201);
  const { token } = await minted.json() as { token: string };
  const proposed = await fetch(`${BASE}/api/internal/team-memory`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ fromBotId: botId, fromThreadId: threadId, kind: "term", name, detail: `${name} means the dispatch board` }),
  });
  const body = await proposed.json() as { status: string; requestId: string };
  expect(proposed.status, JSON.stringify(body)).toBe(201);
  return body.requestId;
}

posixOnly("Perspicax organization: per-bot team memory sharing", () => {
  let alice: Auth;
  let bob: Auth;
  let carol: Auth;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-team-memory-sharing-org-"));
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
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 3 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    bob = await signIn(BOB);
    carol = await signIn(CAROL);
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("lists a card in its person's own thread only, shared or private", async () => {
    const makeBot = async (name: string, member: string) => {
      const created = await api("POST", "/api/bots", alice, { name });
      expect(created.status, created.text).toBe(201);
      const id = created.body.bot.id as string;
      const patched = await api("PATCH", `/api/bots/${id}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" }, section: "Ops" });
      expect(patched.status, patched.text).toBe(200);
      const shared = await api("PUT", `/api/bots/${id}/grants`, alice, { target: `user:${ids[member]}`, level: "use" });
      expect(shared.status, shared.text).toBe(200);
      return id;
    };
    const botId = await makeBot("Ops one", "bob");
    await makeBot("Ops two", "carol");
    // Bob's own thread on the bot
    const bobThread = await waitFor(async () => ((await api("GET", "/api/bots", bob)).body.bots as Array<{ id: string; threadId: string }> | undefined)
      ?.find((bot) => bot.id === botId)?.threadId);
    const inbox = async (auth: Auth, requestId: string) => ((await api("GET", "/api/approvals", auth)).body.pending ?? [])
      .filter((item: any) => item.requestId === requestId);

    for (const sharing of ["shared", "private"] as const) {
      expect((await api("PATCH", `/api/bots/${botId}`, alice, { teamMemorySharing: sharing })).status).toBe(200);
      const requestId = await proposeTeamMemory(botId, bobThread, `Ops board ${sharing}`);
      // the person whose thread it is gets it, answerable
      const bobs = await waitFor(async () => { const rows = await inbox(bob, requestId); return rows.length ? rows : null; }, 10_000);
      expect(bobs[0], sharing).toMatchObject({ threadId: bobThread, decidable: true });
      // another member of the section, without this bot: nothing, whatever the setting
      const carols = await api("GET", "/api/approvals", carol);
      expect(carols.status).toBe(200);
      expect(JSON.stringify(carols.body), sharing).not.toContain(requestId);
      expect(JSON.stringify(carols.body), sharing).not.toContain(`Ops board ${sharing}`);
      expect((await api("POST", `/api/threads/${bobThread}/respond`, carol, { requestId, behavior: "allow" })).status, sharing).toBeOneOf([403, 404]);
      expect((await api("POST", `/api/threads/${bobThread}/respond`, bob, { requestId, behavior: "deny" })).status, sharing).toBe(200);
    }
  }, 90_000);
});
