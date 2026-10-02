// Full access on an organization server through the real server, the fake
// Perspicax provider and the fake Claude CLI (server/org-full-access.ts):
//
//   FA-1  the bot's owner turns Full on for a thread after confirming once;
//         the turn runs Claude with bypassPermissions while the server's own
//         host tools stay withheld (the org denial holds under Full)
//   FA-2  an admin turns the policy off: grants and turns asking Full are
//         refused (org_full_access_disabled); Ask still works; members may
//         not change the policy
//   FA-3  mode changes and Full turns are in the admin activity log
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";
import { CLAUDE_HOST_TOOLS } from "./drivers/host-tools.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9FAALICE00000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const ERIN: FakeOidcUser = { sub: "01J9FAERIN000000000000000E", email: "erin@example.test", name: "Erin", preferred_username: "erin", role: "employee" };

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

function auditRows(): Array<{ action: string; category: string; after?: Record<string, unknown>; before?: Record<string, unknown> }> {
  const dir = join(home, ".openmausbot", "admin-activity");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((file) => readFileSync(join(dir, file), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)));
}

posixOnly("organization Full access", () => {
  let alice: Auth;
  let erin: Auth;
  let erinId = "";
  let zed: { id: string; threadId: string };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, ERIN].map((user) => idp.personOf(user));
    const port = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${port}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-full-access-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    dump = join(home, "claude-dump.json");
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", environment: { FAKE_CLAUDE_DUMP: dump }, config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_IDENTITY: "perspicax",
        SAGAX_PERSPICAX_ISSUER: idp.issuer,
        SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        SAGAX_ANTHROPIC_API_KEY: "sk-ant-test-org-key",
        SAGAX_ORG_NAME: "Acme",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => {
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    }, 20_000);
    alice = await signIn(ALICE);
    erin = await signIn(ERIN);
    erinId = (await api("GET", "/api/auth/session", erin)).body.principalId;
    const created = await api("POST", "/api/bots", erin, { name: "Zed" });
    expect(created.status, created.text).toBe(201);
    const patched = await api("PATCH", `/api/bots/${created.body.bot.id}`, erin, { modelSelection: { instanceId: "claude", model: "fake-model" } });
    expect(patched.status, patched.text).toBe(200);
    zed = { id: created.body.bot.id, threadId: created.body.bot.threadId };
    // shared with the admin, who still is not its owner
    const aliceId = (await api("GET", "/api/auth/session", alice)).body.principalId;
    expect((await api("POST", `/api/bots/${zed.id}/direct-grants`, erin, { userId: aliceId })).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await waitForExit(child, 5_000);
    }
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("FA-1: the owner confirms once, the turn bypasses prompts, host tools stay withheld", async () => {
    expect((await api("GET", "/api/org", alice)).body.settings.allowFullAccess).toBe(true);
    const thread = `/api/bots/${zed.id}/tasks/${zed.threadId}`;
    const unconfirmed = await api("PATCH", thread, erin, { approvalMode: "full" });
    expect(unconfirmed.status, unconfirmed.text).toBe(409);
    expect(unconfirmed.body.code).toBe("full_access_confirm_required");
    // the admin is not the owner
    // the admin never reaches the owner's private thread, and is not the
    // bot's owner either
    expect((await api("PATCH", thread, alice, { approvalMode: "full", confirmFullAccess: true })).status).toBe(404);
    const byAdmin = await api("PATCH", `/api/bots/${zed.id}`, alice, { approvalMode: "full", confirmFullAccess: true });
    expect(byAdmin.body.code, byAdmin.text).toBe("full_access_owner_only");
    const granted = await api("PATCH", thread, erin, { approvalMode: "full", confirmFullAccess: true });
    expect(granted.status, granted.text).toBe(200);
    expect(granted.body.task.approvalMode).toBe("full");
    expect(granted.body.bot.fullAccessConsent.principalId).toBe(erinId);
    // confirmed once: the next grant for this bot needs no confirmation
    expect((await api("PATCH", thread, erin, { approvalMode: "ask" })).status).toBe(200);
    expect((await api("PATCH", thread, erin, { approvalMode: "full" })).status).toBe(200);

    rmSync(dump, { force: true });
    const sent = await api("POST", `/api/bots/${zed.id}/messages`, erin, { text: "go full" });
    expect(sent.status, sent.text).toBe(202);
    await waitFor(async () => existsSync(dump), 20_000);
    const argv = (JSON.parse(readFileSync(dump, "utf8")) as { argv: string[] }).argv;
    expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    const denied = argv[argv.indexOf("--disallowedTools") + 1]!.split(",");
    for (const tool of CLAUDE_HOST_TOOLS) expect(denied).toContain(tool);
    await waitFor(async () => auditRows().some((row) => row.action === "approval.full_access_turn"));
  }, 60_000);

  it("FA-2: with the policy off, Full is refused for grants and turns; Ask still works", async () => {
    expect((await api("PATCH", "/api/org/settings", erin, { allowFullAccess: false })).status).toBe(403);
    const off = await api("PATCH", "/api/org/settings", alice, { allowFullAccess: false });
    expect(off.status, off.text).toBe(200);
    expect(off.body.settings.allowFullAccess).toBe(false);
    await waitFor(async () => !(await api("GET", `/api/bots`, erin)).body.bots.find((bot: { id: string; busy?: boolean }) => bot.id === zed.id)?.busy);

    const turn = await api("POST", `/api/bots/${zed.id}/messages`, erin, { text: "still full?" });
    expect(turn.status, turn.text).toBe(403);
    expect(turn.body.code).toBe("org_full_access_disabled");
    const bot = await api("PATCH", `/api/bots/${zed.id}`, erin, { approvalMode: "full", confirmFullAccess: true });
    expect(bot.body.code).toBe("org_full_access_disabled");
    const thread = await api("PATCH", `/api/bots/${zed.id}/tasks/${zed.threadId}`, erin, { approvalMode: "full", confirmFullAccess: true });
    expect(thread.body.code).toBe("org_full_access_disabled");

    // back to Ask: the bot works again, prompting as usual
    expect((await api("PATCH", `/api/bots/${zed.id}/tasks/${zed.threadId}`, erin, { approvalMode: "ask" })).status).toBe(200);
    rmSync(dump, { force: true });
    expect((await api("POST", `/api/bots/${zed.id}/messages`, erin, { text: "ask now" })).status).toBe(202);
    await waitFor(async () => existsSync(dump), 20_000);
    const argv = (JSON.parse(readFileSync(dump, "utf8")) as { argv: string[] }).argv;
    expect(argv[argv.indexOf("--permission-mode") + 1]).not.toBe("bypassPermissions");
    expect((await api("PATCH", "/api/org/settings", alice, { allowFullAccess: true })).body.settings.allowFullAccess).toBe(true);
  }, 60_000);

  it("FA-3: mode changes and the policy are in the admin activity log", async () => {
    const rows = auditRows();
    expect(rows.some((row) => row.action === "approval.mode" && row.after?.approvalMode === "full")).toBe(true);
    expect(rows.some((row) => row.action === "org.settings" && row.after?.allowFullAccess === false)).toBe(true);
    const listed = await api("GET", "/api/admin-activity?what=approval", alice);
    expect(listed.status, listed.text).toBe(200);
    expect(listed.text).toContain("approval.full_access_turn");
  });
});
