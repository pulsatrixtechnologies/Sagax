// The desktop bridge through the real organization server: a fake desktop
// app (server/testing/fake-desktop.ts) signs in as Alice, answers the bridge's
// operations and serves the network tunnel; the fake Claude CLI really calls
// the turn's stdio tool servers and fetches through HTTP_PROXY; a fake
// provisioner (FakeDocker) plays the server environments.
//
//   desktop    Alice's desktop connected: her bot reads the file she
//              attached ON HER COMPUTER (copied there, path rewritten), the
//              engine's HTTP leaves through her PC to a host only it knows,
//              and nothing is created on the server
//   teammate   Bob talking to Alice's bot never reaches Alice's computer
//   preference "Environnement serveur": the server environment, with the
//              attachment copied to /workspace/attachments
//   fallback   desktop disconnected: the server environment, and the bot is
//              told why; the person's status says not connected
//   authz      Bob's session cannot poll or tunnel for Alice's desktop
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request, type Server } from "node:http";
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
import { connectFakeDesktop, openFakeTunnel, type FakeDesktop } from "./testing/fake-desktop.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";
import { sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ORG_KEY = "sk-ant-test-org-key-000000";
const SANDBOXD_KEY = "d".repeat(64);
const INSTANCE = "e2e-bridge";
const ALICE: FakeOidcUser = { sub: "01J9S5ALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9S5BOB000000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };
const README = "# Sagax\nthe cryptic system prompt lives here\n";

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let mcpDump = "";
let prompts = "";
let log = "";
let idp: FakeOidcProvider;
let provisioner: Server;
let intranet: Server;
let intranetPort = 0;
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

async function upload(auth: Auth, name: string, body: string): Promise<{ path: string; name: string }> {
  const res = await fetch(`${BASE}/api/files?name=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": "text/markdown", cookie: auth.cookie! }, body });
  expect(res.status).toBe(201);
  return await res.json() as { path: string; name: string };
}

/** An open /api/events stream (as the browser opens it): what it received. */
async function openStream(auth: Auth): Promise<{ frames: () => Array<Record<string, any>>; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  expect(body.ticket).toMatch(/^omb_tick_/);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      expect(res.statusCode).toBe(200);
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      res.on("error", () => {});
      resolve({
        frames: () => received.split("\n").filter((line) => line.startsWith("data: ")).map((line) => { try { return JSON.parse(line.slice(6)) as Record<string, any>; } catch { return {}; } }),
        close: () => req.destroy(),
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const lastPrompt = () => readFileSync(prompts, "utf8").trimEnd().split("\n").at(-1) ?? "";
const dump = () => JSON.parse(readFileSync(mcpDump, "utf8")) as { servers: string[]; calls: { server: string; tool: string; ok: boolean; text: string }[] };

posixOnly("organization server: the desktop bridge", () => {
  let alice: Auth;
  let bob: Auth;
  let desktop: FakeDesktop;
  let aliceBot: { id: string; threadId: string };
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    intranet = createServer((req, res) => res.end(`intranet says hi to ${req.url}`));
    await new Promise<void>((resolve) => intranet.listen(0, "127.0.0.1", resolve));
    intranetPort = (intranet.address() as AddressInfo).port;
    const service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test", SAGAX_SANDBOX_INSTANCE: INSTANCE }));
    await service.installEgressPolicy();
    provisioner = createServer(createSandboxdHandler(service, new SandboxdVerifier(SANDBOXD_KEY)));
    await new Promise<void>((resolve) => provisioner.listen(0, "127.0.0.1", resolve));
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-desktop-bridge-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(home, "sandboxd-key"), `${SANDBOXD_KEY}\n`, { mode: 0o400 });
    mcpDump = join(home, "mcp-dump.json");
    prompts = join(home, "prompts.jsonl");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      organization: { memberBotsUseOrgKey: true },
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([
              { server: "sagax-desktop", tool: "read_file", arguments: { path: "$ATTACHED_FILE" }, when: "read the attachment" },
              { server: "sagax-environment", tool: "read_file", arguments: { path: "$ATTACHED_FILE" }, when: "read the attachment" },
              { server: "sagax-desktop", tool: "run_command", arguments: { command: "hostname" }, when: "run it" },
              { server: "sagax-environment", tool: "run_command", arguments: { command: "hostname" }, when: "run it" },
              { server: "sagax-desktop", tool: "local_vm", arguments: { action: "create" }, when: "create the local vm" },
            ]),
            FAKE_CLAUDE_MCP_DUMP: mcpDump,
            FAKE_CLAUDE_PROMPTS: prompts,
            FAKE_CLAUDE_PROXY_FETCH: "http://intranet.test/hello",
          },
          config: { cli: FAKE_CLAUDE, fullAuto: true },
        },
      },
    }));
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
    // Alice's desktop app: only it knows intranet.test (her LAN).
    desktop = await connectFakeDesktop({
      base: BASE, cookie: alice.cookie!, name: "Alice's Mac", attachmentsDir: "/Users/alice/Library/Caches/Sagax/attachments",
      resolve: (host, port) => host === "intranet.test" ? { host: "127.0.0.1", port: intranetPort } : { host, port },
      handle: async (operation, progress) => {
        if (operation.action !== "vm_create") return { content: [{ type: "text", text: `desktop:${operation.action}` }] };
        await progress("Downloading the Local VM desktop image");
        await progress("Creating the Local VM");
        return { content: [{ type: "text", text: "desktop:vm created" }] };
      },
    });
    await desktop.tunnelOpen;
    aliceBot = await createBot(alice, "Xavier");
  }, 60_000);

  afterAll(async () => {
    await desktop?.close();
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    await new Promise<void>((resolve) => provisioner?.close(() => resolve()));
    await new Promise<void>((resolve) => intranet?.close(() => resolve()));
    if (home) removeTempDir(home);
  });

  it("shows the person their own connected desktop", async () => {
    const status = (await api("GET", "/api/me/desktop-bridge", alice)).body;
    expect(status).toMatchObject({ connected: true, tunnel: true, workplace: { place: "computer", routines: false, network: "all" } });
    expect(status.desktops.map((entry: { name: string }) => entry.name)).toEqual(["Alice's Mac"]);
    expect((await api("GET", "/api/me/desktop-bridge", bob)).body).toMatchObject({ connected: false, desktops: [] });
  });

  it("reads the attached file on the speaker's own computer, and the engine's HTTP leaves through it", async () => {
    const file = await upload(alice, "README.md", README);
    const reply = await turn(alice, aliceBot, `read the attachment\n\n<attached-file path="${file.path}" name="README.md" />`);
    expect(reply).toContain("mcp:read_file:ok");
    // the engine's own HTTP call reached a host only Alice's network knows
    expect(reply).toContain("proxy:200:intranet says hi to /hello");
    const calls = dump();
    expect(calls.servers).toContain("sagax-desktop");
    expect(calls.servers).not.toContain("sagax-environment");
    expect(calls.calls.find((call) => call.server === "sagax-desktop")?.text).toBe(`desktop:${README}`);
    // the bot was told the desktop's path, and got the text inline too
    const prompt = lastPrompt();
    const staged = [...desktop.staged.keys()][0]!;
    expect(staged).toMatch(/^[0-9a-f]{8}-README\.md$/);
    expect(prompt).toContain(`/Users/alice/Library/Caches/Sagax/attachments/${staged}`);
    expect(prompt).not.toContain(file.path);
    expect(prompt).toContain("the cryptic system prompt lives here");
    expect(desktop.staged.get(staged)?.toString("utf8")).toBe(README);
    expect(desktop.opened).toContain("intranet.test:80");
    // nothing on the server
    expect(docker.containers.size).toBe(0);
    const activity = (await api("GET", "/api/me/desktop-bridge", alice)).body.activity as Array<{ kind: string; detail: string; target: string }>;
    expect(activity.some((entry) => entry.kind === "network" && entry.detail === "intranet.test:80" && entry.target === "user-desktop")).toBe(true);
    expect(activity.some((entry) => entry.kind === "tool" && entry.detail === "read_file")).toBe(true);
  }, 120_000);

  it("creates the Local VM on the speaker's own computer, its progress taken for the turn", async () => {
    // Alice sees her bot's computer being set up, then ready; Bob, who
    // cannot see her bot, receives neither.
    const aliceStream = await openStream(alice);
    const bobStream = await openStream(bob);
    const computerFrames = (stream: { frames: () => Array<Record<string, any>> }) => stream.frames().filter((frame) => frame.kind === "computer" && frame.botId === aliceBot.id).map((frame) => frame.state);
    const reply = await turn(alice, aliceBot, "create the local vm");
    await waitFor(async () => computerFrames(aliceStream).includes("ready"));
    expect(computerFrames(aliceStream)).toEqual(["provisioning", "ready"]);
    expect(computerFrames(bobStream)).toEqual([]);
    expect(bobStream.frames().some((frame) => frame.botId === aliceBot.id)).toBe(false);
    aliceStream.close();
    bobStream.close();
    expect(reply).toContain("mcp:local_vm:ok");
    expect(dump().calls.find((call) => call.tool === "local_vm")?.text).toBe("desktop:vm created");
    expect(desktop.operations.at(-1)).toEqual({ action: "vm_create", timeout_seconds: 600 });
    expect(desktop.progress).toEqual([
      { message: "Downloading the Local VM desktop image", ok: true },
      { message: "Creating the Local VM", ok: true },
    ]);
    expect(docker.containers.size).toBe(0);
  }, 120_000);

  it("never reaches Alice's computer for a teammate talking to her bot", async () => {
    expect((await api("PUT", `/api/bots/${aliceBot.id}/grants`, alice, { target: `user:${ids.bob}`, level: "use" })).status).toBe(200);
    const bobView = ((await api("GET", "/api/bots", bob)).body.bots as Array<{ id: string; threadId: string }>).find((bot) => bot.id === aliceBot.id)!;
    const before = desktop.operations.length;
    const reply = await turn(bob, { id: aliceBot.id, threadId: bobView.threadId }, "run it");
    expect(reply).toContain("mcp:run_command:ok");
    expect(reply).toContain("proxy:none");
    expect(dump().servers).toContain("sagax-environment");
    expect(dump().servers).not.toContain("sagax-desktop");
    expect(desktop.operations.length).toBe(before);
  }, 120_000);

  it("the server environment when the person chose it, with the attachment copied to /workspace/attachments", async () => {
    expect((await api("PUT", "/api/me/preferences", alice, { preferences: { "sagax.botWorkplace.v1": JSON.stringify({ place: "server", routines: false, network: "all" }) } })).status).toBe(200);
    const file = await upload(alice, "notes.md", "server side notes\n");
    const before = desktop.operations.length;
    const reply = await turn(alice, aliceBot, `read the attachment\n\n<attached-file path="${file.path}" name="notes.md" />`);
    expect(reply).toContain("mcp:read_file:ok");
    expect(reply).toContain("proxy:none");
    expect(dump().servers).toEqual(expect.arrayContaining(["sagax-environment"]));
    expect(dump().servers).not.toContain("sagax-desktop");
    expect(lastPrompt()).toMatch(/\/workspace\/attachments\/[0-9a-f]{8}-notes\.md/);
    const copies = docker.execs.filter((entry) => entry.exec.Env.some((value) => /^SAGAX_PATH=\/workspace\/attachments\/[0-9a-f]{8}-notes\.md$/.test(value)));
    expect(copies.length).toBeGreaterThan(0);
    expect(desktop.operations.length).toBe(before);
    expect((await api("PUT", "/api/me/preferences", alice, { preferences: { "sagax.botWorkplace.v1": JSON.stringify({ place: "computer", routines: false, network: "all" }) } })).status).toBe(200);
  }, 120_000);

  it("refuses another person's session on Alice's desktop (poll, tunnel)", async () => {
    const poll = await fetch(`${BASE}/api/desktop-bridge/${desktop.id}/poll`, {
      method: "POST", headers: { "content-type": "application/json", cookie: bob.cookie!, "x-sagax-bridge-secret": desktop.secret }, body: "{}",
    });
    expect(poll.status).toBe(403);
    const tunnel = openFakeTunnel({ url: `${BASE.replace("http", "ws")}/api/desktop-bridge/${desktop.id}/tunnel`, headers: { cookie: bob.cookie!, "x-sagax-bridge-secret": desktop.secret } });
    await expect(tunnel.ready).rejects.toThrow();
  });

  it("falls back to the server environment when the desktop is not connected, and says why", async () => {
    await desktop.close();
    await waitFor(async () => (await api("GET", "/api/me/desktop-bridge", alice)).body.connected === false);
    const reply = await turn(alice, aliceBot, "run it");
    expect(reply).toContain("mcp:run_command:ok");
    expect(dump().servers).toContain("sagax-environment");
    expect(lastPrompt()).toContain("computer is not connected");
  }, 120_000);
});
