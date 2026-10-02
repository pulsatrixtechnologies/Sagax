// The per-person server environment through the real organization server:
// the fake Claude CLI really calls the `sagax-environment` stdio server of
// its --mcp-config, the Sagax server signs the call to an in-test provisioner
// (the real HTTP handler and lifecycle over a FakeDocker), and the tests read
// which person's sandbox each call landed in.
//
//   routing   a conversation lands in the SPEAKER's sandbox: two bots one
//             person talks to share it, a teammate talking to that person's
//             bot uses the teammate's own sandbox, never the owner's
//   engine    the engine gets no shell or file tool of its own (Bash, Read,
//             Write... are in --disallowedTools)
//   settings  each person reads their own environment
//   per-bot   no VM or VPS per bot on an organization server (409)
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SandboxdVerifier } from "./sandboxd-auth.ts";
import { SandboxService } from "./sandboxd-core.ts";
import { createSandboxdHandler } from "./sandboxd.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { FakeDocker } from "./testing/fake-docker.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";
import { sandboxKeyForPrincipal, sandboxNames, sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const SANDBOXD_KEY = "c".repeat(64);
const INSTANCE = "e2e";
const ALICE: FakeOidcUser = { sub: "01J9S5ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9S5BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let mcpDump = "";
let engineDump = "";
let log = "";
let idp: FakeOidcProvider;
let provisioner: Server;
const docker = new FakeDocker();

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
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-4000)}`);
    await sleep(150);
  }
}

type Message = { role: string; kind: string; text?: string };
const threadMessages = async (auth: Auth, threadId: string) => ((await api("GET", `/api/threads/${threadId}/messages`, auth)).body.messages ?? []) as Message[];

async function turn(auth: Auth, bot: { id: string; threadId: string }, text: string): Promise<string> {
  const before = (await threadMessages(auth, bot.threadId)).filter((m) => m.role === "bot" && m.kind === "text").length;
  if (existsSync(mcpDump)) rmSync(mcpDump);
  const sent = await api("POST", `/api/bots/${bot.id}/messages`, auth, { text });
  expect(sent.status, sent.text).toBe(202);
  const reply = await waitFor(async () => {
    const replies = (await threadMessages(auth, bot.threadId)).filter((m) => m.role === "bot" && m.kind === "text" && m.text);
    return replies.length > before ? replies.at(-1)! : null;
  }, 40_000);
  await waitFor(async () => !((await api("GET", "/api/bots", auth)).body.bots as Array<{ id: string; busy?: boolean }>).find((b) => b.id === bot.id)?.busy);
  return reply.text ?? "";
}

async function createBot(auth: Auth, name: string): Promise<{ id: string; threadId: string }> {
  const created = await api("POST", "/api/bots", auth, { name });
  expect(created.status, created.text).toBe(201);
  const bot = { id: created.body.bot.id as string, threadId: created.body.bot.threadId as string };
  expect((await api("PATCH", `/api/bots/${bot.id}`, auth, { modelSelection: { instanceId: "claude", model: "fake-model" } })).status).toBe(200);
  return bot;
}

const containersExecuted = () => [...new Set(docker.execs.filter((e) => e.exec.Cmd[0] === "timeout").map((e) => e.name))];

posixOnly("organization server environments (user-sandbox)", () => {
  let alice: Auth;
  let bob: Auth;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    const service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test", SAGAX_SANDBOX_INSTANCE: INSTANCE }));
    await service.installEgressPolicy();
    provisioner = createServer(createSandboxdHandler(service, new SandboxdVerifier(SANDBOXD_KEY)));
    await new Promise<void>((resolve) => provisioner.listen(0, "127.0.0.1", resolve));
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-user-sandbox-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(home, "sandboxd-key"), `${SANDBOXD_KEY}\n`, { mode: 0o400 });
    mcpDump = join(home, "mcp-dump.json");
    engineDump = join(home, "claude-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      organization: { memberBotsUseOrgKey: true },
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ server: "sagax-environment", tool: "run_command", arguments: { command: "echo hi" } }]),
            FAKE_CLAUDE_MCP_DUMP: mcpDump,
            FAKE_CLAUDE_DUMP: engineDump,
          },
          config: { cli: FAKE_CLAUDE, fullAuto: true },
        },
      },
    }));
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
        SAGAX_SANDBOXD_URL: `http://127.0.0.1:${(provisioner.address() as AddressInfo).port}`,
        SAGAX_SANDBOXD_KEY_FILE: join(home, "sandboxd-key"),
        SAGAX_SANDBOX_INSTANCE: INSTANCE,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => {
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    });
    alice = await signIn(ALICE);
    bob = await signIn(BOB);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 2 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    await new Promise<void>((resolve) => provisioner?.close(() => resolve()));
    if (home) removeTempDir(home);
  });

  it("creates nothing before the first tool call", async () => {
    expect((await api("GET", "/api/me/server-environment", alice)).body).toMatchObject({ configured: true, state: "missing" });
    expect(docker.containers.size).toBe(0);
  });

  it("runs a conversation in the speaker's sandbox; every bot that person uses shares it", async () => {
    const aliceContainer = sandboxNames(sandboxKeyForPrincipal(INSTANCE, ids.alice!)).container;
    const x = await createBot(alice, "Xavier");
    const y = await createBot(alice, "Yuna");
    expect(await turn(alice, x, "run it")).toContain("mcp:run_command:ok");
    expect(JSON.parse(readFileSync(mcpDump, "utf8")).servers).toContain("sagax-environment");
    expect(await turn(alice, y, "run it")).toContain("mcp:run_command:ok");
    expect(containersExecuted()).toEqual([aliceContainer]);
    expect(docker.calls.filter((call) => call.startsWith("create"))).toEqual([`create ${aliceContainer}`]);
  }, 120_000);

  it("never puts a teammate's commands in the bot owner's sandbox", async () => {
    const aliceContainer = sandboxNames(sandboxKeyForPrincipal(INSTANCE, ids.alice!)).container;
    const bobContainer = sandboxNames(sandboxKeyForPrincipal(INSTANCE, ids.bob!)).container;
    const bots = (await api("GET", "/api/bots", alice)).body.bots as Array<{ id: string; name: string; threadId: string }>;
    const x = bots.find((bot) => bot.name === "Xavier")!;
    expect((await api("PUT", `/api/bots/${x.id}/grants`, alice, { target: `user:${ids.bob}`, level: "use" })).status).toBe(200);
    const aliceExecs = docker.execs.filter((e) => e.name === aliceContainer).length;
    const bobView = ((await api("GET", "/api/bots", bob)).body.bots as Array<{ id: string; threadId: string }>).find((bot) => bot.id === x.id)!;
    expect(await turn(bob, { id: x.id, threadId: bobView.threadId }, "run it as bob")).toContain("mcp:run_command:ok");
    expect(docker.execs.filter((e) => e.name === aliceContainer).length).toBe(aliceExecs);
    expect(containersExecuted()).toContain(bobContainer);
    // Bob's own bot reuses Bob's one sandbox.
    const z = await createBot(bob, "Zed");
    expect(await turn(bob, z, "run it")).toContain("mcp:run_command:ok");
    expect(docker.containers.size).toBe(2);
  }, 120_000);

  it("gives the engine no shell or file tool of its own on the server", async () => {
    const engine = JSON.parse(readFileSync(engineDump, "utf8")) as { argv: string[] };
    const index = engine.argv.indexOf("--disallowedTools");
    expect(index).toBeGreaterThan(-1);
    const denied = engine.argv[index + 1]!.split(",");
    for (const tool of ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "WebFetch"]) expect(denied).toContain(tool);
  });

  it("records who created a room: its follow-ups no person asked for use that person's sandbox", async () => {
    const bots = (await api("GET", "/api/bots", alice)).body.bots as Array<{ id: string; name: string }>;
    const created = await api("POST", "/api/groups", alice, { name: "Ops", memberIds: [bots.find((bot) => bot.name === "Xavier")!.id] });
    expect(created.status, created.text).toBe(201);
    expect(created.body.group.createdBy).toBe(ids.alice);
  });

  it("shows each person their own environment in settings", async () => {
    expect((await api("GET", "/api/me/server-environment", alice)).body).toMatchObject({ configured: true, state: "running" });
    expect((await api("GET", "/api/me/server-environment", bob)).body).toMatchObject({ configured: true, state: "running" });
    expect((await api("POST", "/api/me/server-environment/reset", bob, {})).body.code).toBe("confirm");
  });

  it("refuses a VM or a VPS per bot", async () => {
    const vm = await api("PATCH", "/api/config", alice, { localVm: { mode: "per-bot", maxInstances: 2 } });
    expect(vm.status, vm.text).toBe(409);
    expect(vm.body.code).toBe("org_user_sandbox");
    const bots = (await api("GET", "/api/bots", alice)).body.bots as Array<{ id: string; name: string }>;
    const x = bots.find((bot) => bot.name === "Xavier")!;
    const vps = await api("PATCH", `/api/bots/${x.id}`, alice, { cloudBackend: "vps" });
    expect(vps.status).toBe(409);
    expect(vps.body.code).toBe("org_user_sandbox");
  });
});
