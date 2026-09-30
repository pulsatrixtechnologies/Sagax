// Slice 5 of the Perspicax organization through the real server: MCP for the
// person who speaks. The fake provider (server/testing/fake-oidc-provider.ts)
// lists MCP profiles in its directory, answers the RFC 8693 exchange
// authenticated by the link, revokes exchanged tokens and serves a small /mcp;
// the fake Claude CLI really talks to the stdio servers of its --mcp-config
// (FAKE_CLAUDE_MCP_CALLS).
//
//   scenario E  bob speaks to alice's bot: the calls reach Perspicax with
//               bob's exchanged token and clientInfo "Pulsa Bot (<bot id>)"
//   E negative  carol does not hold the profile: no server is mounted, the
//               system prompt says why, and the thread shows an activity row
//   routine     a routine run mounts nothing (slice 6 brings delegation)
//   revocation  every exchanged token is revoked when its turn ends
//   T1          no Perspicax or sign-in token reaches the engine: not in its
//               argv, its environment or its MCP configuration
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const ALICE: FakeOidcUser = { sub: "01J9S5ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9S5BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const CAROL: FakeOidcUser = { sub: "01J9S5CAROL00000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };
const PROFILE = { id: "01J9S5PROFILEDISPATCH00001", slug: "dispatch", name: "Dispatch", description: "Tickets and schedules" };
const PACKAGE_VERSION = (JSON.parse(readFileSync(join(SERVER_DIR, "..", "package.json"), "utf8")) as { version: string }).version;

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let dump = "";
let mcpDump = "";
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
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-4000)}`);
    await sleep(150);
  }
}

type Message = { id: string; kind: string; role: string; text?: string; tool?: { name: string; ok: boolean } };
const threadMessages = async (auth: Auth, threadId: string) => ((await api("GET", `/api/threads/${threadId}/messages`, auth)).body.messages ?? []) as Message[];

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

/** Send `text` as `auth` and wait for the next bot reply in that thread. */
async function turn(auth: Auth, bot: { id: string; threadId: string }, text: string): Promise<string> {
  const before = (await threadMessages(auth, bot.threadId)).filter((m) => m.role === "bot" && m.kind === "text").length;
  if (existsSync(dump)) rmSync(dump);
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, auth, { text });
  expect(sent.status, sent.text).toBe(202);
  const reply = await waitFor(async () => {
    const replies = (await threadMessages(auth, bot.threadId)).filter((m) => m.role === "bot" && m.kind === "text" && m.text);
    return replies.length > before ? replies.at(-1)! : null;
  }, 40_000);
  // the turn is over once the thread is idle again
  await waitFor(async () => !((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; busy?: boolean }>).find((b) => b.id === bot.id)?.busy);
  return reply.text ?? "";
}

posixOnly("Perspicax organization, slice 5: MCP for the person who speaks", () => {
  let alice: Auth;
  const ids: Record<string, string> = {};
  let x: { id: string; threadId: string };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.profiles = [PROFILE];
    idp.profilesBySub.set(ALICE.sub, [PROFILE.id]);
    idp.profilesBySub.set(BOB.sub, [PROFILE.id]);
    idp.directoryPeople = [ALICE, BOB, CAROL].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-mcp-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    dump = join(home, "claude-dump.json");
    mcpDump = join(home, "mcp-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      organization: { memberBotsUseOrgKey: true },
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_DUMP: dump,
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ server: "perspicax_*", tool: "api_list", arguments: {} }]),
            FAKE_CLAUDE_MCP_DUMP: mcpDump,
          },
          config: { cli: FAKE_CLAUDE, fullAuto: true },
        },
      },
    }));
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 3 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    const created = await api("POST", "/api/bots", alice, { name: "Xavier" });
    expect(created.status, created.text).toBe(201);
    x = { id: created.body.bot.id, threadId: created.body.bot.threadId };
    expect((await api("PATCH", `/api/bots/${x.id}`, alice, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
    for (const who of ["bob", "carol"]) {
      expect((await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids[who]}`, level: "use" })).status).toBe(200);
    }
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("the bot editor offers the profiles alice holds, and saves them", async () => {
    const got = await api("GET", `/api/bots/${x.id}/perspicax`, alice);
    expect(got.status, got.text).toBe(200);
    expect(got.body).toEqual({ selected: [], available: [PROFILE], canEdit: true });
    const saved = await api("PUT", `/api/bots/${x.id}/perspicax`, alice, { profiles: [PROFILE.id] });
    expect(saved.status, saved.text).toBe(200);
    expect(saved.body.selected).toEqual([{ ...PROFILE, heldByMe: true }]);
    // bob uses the bot, he does not change it; the wire never carries the list
    const bob = await signIn(BOB);
    expect(await api("PUT", `/api/bots/${x.id}/perspicax`, bob, { profiles: [] })).toMatchObject({ status: 403, body: { code: "needs_edit" } });
    expect((await api("GET", `/api/bots/${x.id}/perspicax`, bob)).body).toMatchObject({ canEdit: false, selected: [{ id: PROFILE.id, heldByMe: true }] });
    expect(JSON.stringify((await api("GET", "/api/bots", alice)).body)).not.toContain("\"perspicax\"");
  });

  it("scenario E: bob's turn reaches Perspicax as bob, named Pulsa Bot (<bot id>); his tokens are revoked after it", async () => {
    const bob = await signIn(BOB);
    const exchangesBefore = idp.exchanges.length;
    const reply = await turn(bob, x, "ping");
    expect(reply).toContain("mcp:api_list:ok");
    const mcp = JSON.parse(readFileSync(mcpDump, "utf8")) as { servers: string[]; calls: Array<{ server: string; tool: string; listed: boolean; ok: boolean; text: string }> };
    expect(mcp.servers).toContain("perspicax_dispatch");
    expect(mcp.calls).toEqual([{ server: "perspicax_dispatch", tool: "api_list", listed: true, ok: true, text: `profile ${PROFILE.id} for ${BOB.sub}` }]);
    const exchanges = idp.exchanges.slice(exchangesBefore);
    expect(exchanges.map((e) => ({ sub: e.sub, profile: e.profile, ok: e.ok }))).toEqual([{ sub: BOB.sub, profile: PROFILE.id, ok: true }]);
    const calls = idp.mcpRequests.filter((r) => r.method === "POST");
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.every((r) => r.sub === BOB.sub && r.profile === PROFILE.id)).toBe(true);
    const init = calls.find((r) => r.rpcMethod === "initialize")!;
    expect(init.clientInfo).toEqual({ name: `Pulsa Bot (${x.id})`, version: PACKAGE_VERSION });
    expect(init.sessionId).toBeNull();
    expect(calls.filter((r) => r.rpcMethod !== "initialize").every((r) => r.sessionId?.startsWith("sess-"))).toBe(true);
    expect(idp.mcpRequests.some((r) => r.sub === ALICE.sub)).toBe(false);
    // revoked once the turn's generation ends
    await waitFor(async () => idp.exchangeRevoked.includes(exchanges[0]!.token!), 10_000);
    expect(idp.exchangeRevoked.filter((t) => t === exchanges[0]!.token)).toHaveLength(1);
  }, 90_000);

  it("T1: no sign-in or Perspicax token reaches the engine's argv, environment or MCP configuration", async () => {
    const engine = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; env: Record<string, string>; mcpConfig: unknown; systemPrompt: string };
    const seen = JSON.stringify([engine.argv, engine.env, engine.mcpConfig, engine.systemPrompt, readFileSync(mcpDump, "utf8")]);
    expect(seen).toContain("perspicax_dispatch");
    expect(seen).not.toMatch(/pxlo1\./);
    expect(seen).not.toContain(idp.linkToken);
    for (const token of [...idp.issuedAccessTokens(), ...idp.exchanges.flatMap((e) => (e.token ? [e.token] : []))]) {
      expect(seen).not.toContain(token);
      expect(log).not.toContain(token);
    }
    const servers = (engine.mcpConfig as { mcpServers: Record<string, { env?: Record<string, string> }> }).mcpServers;
    expect(JSON.stringify(servers.perspicax_dispatch)).toContain("OMB_PERSPICAX_TOKEN");
  });

  it("scenario E negative: carol, who does not hold the profile, gets no server, a note and an activity row", async () => {
    const carol = await signIn(CAROL);
    const exchangesBefore = idp.exchanges.length;
    const callsBefore = idp.mcpRequests.length;
    const reply = await turn(carol, x, "ping");
    expect(reply).toContain("mcp:absent");
    const engine = JSON.parse(readFileSync(dump, "utf8")) as { mcpConfig: { mcpServers: Record<string, unknown> }; systemPrompt: string };
    expect(Object.keys(engine.mcpConfig.mcpServers).some((name) => name.startsWith("perspicax_"))).toBe(false);
    expect(engine.systemPrompt).toContain('Perspicax tools of profile "Dispatch" are not available in this turn: the person speaking does not hold this profile in Perspicax.');
    expect(idp.exchanges.slice(exchangesBefore)).toEqual([{ sub: CAROL.sub, profile: PROFILE.id, ok: false, error: "invalid_target" }]);
    expect(idp.mcpRequests.slice(callsBefore)).toEqual([]);
    const row = (await threadMessages(carol, x.threadId)).find((m) => m.kind === "activity" && m.tool?.name.startsWith("Perspicax:"));
    expect(row?.tool).toEqual({ name: "Perspicax: Dispatch unavailable for Carol (not_held)", ok: false });
  }, 90_000);

  it("a routine run mounts nothing and says why", async () => {
    const routine = await api("POST", "/api/routines", alice, { name: "Morning", botId: x.id, prompt: "Check the board.", enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 86_400_000 } });
    expect(routine.status, routine.text).toBe(201);
    const exchangesBefore = idp.exchanges.length;
    if (existsSync(dump)) rmSync(dump);
    const run = await api("POST", `/api/routines/${routine.body.routine.id}/run`, alice, {});
    expect(run.status, run.text).toBeLessThan(300);
    const engine = await waitFor(async () => {
      if (!existsSync(dump)) return null;
      try { return JSON.parse(readFileSync(dump, "utf8")) as { mcpConfig: { mcpServers: Record<string, unknown> }; systemPrompt: string }; } catch { return null; }
    }, 40_000);
    expect(Object.keys(engine.mcpConfig.mcpServers).some((name) => name.startsWith("perspicax_"))).toBe(false);
    expect(engine.systemPrompt).toContain("Perspicax tools reach routines once routine delegation is on");
    expect(idp.exchanges.length).toBe(exchangesBefore);
  }, 90_000);
});
