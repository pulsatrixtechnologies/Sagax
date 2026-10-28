// Sending on your behalf for a member's own bot (#1098): the phone and the
// served app draw the outbound allowance for the bot's owner, so the owner
// reads it (policy and today's count) and sets it (bots.tools). Real server
// against the fake Perspicax:
//
//   OB-1  a member sets and reads the allowance of their own bot
//   OB-2  another member reads nothing of it and changes nothing
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
const ORG_KEY = "sk-ant-test-org-key-000000";
const ADMIN: FakeOidcUser = { sub: "01J9OBADMIN00000000000AA", name: "Ada", preferred_username: "ada", role: "admin", teams: [] };
const ALEX: FakeOidcUser = { sub: "01J9OBALEX000000000000AX", name: "Alex", preferred_username: "alex", role: "employee", teams: [] };
const BLAIR: FakeOidcUser = { sub: "01J9OBBLAIR00000000000BL", name: "Blair", preferred_username: "blair", role: "employee", teams: [] };

let BASE = "";
let child: ChildProcess;
let home = "";
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

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, ms = 20_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

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

posixOnly("Perspicax organization: a member's own outbound allowance", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ADMIN });
    idp.directoryPeople = [ADMIN, ALEX, BLAIR].map((user) => ({ ...idp.personOf(user), sagax_server_engines: ["claude"] }));
    const port = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${port}`;
    home = mkdtempSync(join(tmpdir(), "omb-member-outbound-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { claude: { driver: "claudeAgent", config: { cli: FAKE_CLAUDE, fullAuto: true } } },
    }));
    child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
        SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
        SAGAX_IDENTITY: "perspicax",
        SAGAX_PERSPICAX_ISSUER: idp.issuer,
        SAGAX_PUBLIC_URL: BASE,
        SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
        SAGAX_ANTHROPIC_API_KEY: ORG_KEY,
        SAGAX_ORG_NAME: "Acme",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    await waitFor(async () => {
      if (child.exitCode !== null) throw new Error(`server exited during boot:\n${log}`);
      try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
    });
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  let botId = "";

  it("OB-1: a member sets and reads the allowance of their own bot", async () => {
    const alex = await signIn(ALEX);
    const created = await waitFor(async () => {
      const answer = await api("POST", "/api/bots", alex, { name: "Alex's bot" });
      return answer.status === 201 ? answer : null;
    });
    botId = created.body.bot.id as string;
    const patched = await api("PATCH", `/api/bots/${botId}`, alex, { outbound: { policy: "allow", dailyCap: 7 } });
    expect(patched.status, patched.text).toBe(200);
    expect(patched.body.bot.outbound).toEqual({ policy: "allow", dailyCap: 7 });
    const read = await api("GET", `/api/bots/${botId}/outbound`, alex);
    expect(read.status, read.text).toBe(200);
    expect(read.body).toEqual({ policy: { policy: "allow", dailyCap: 7 }, today: 0 });
  }, 60_000);

  it("OB-2: another member reads nothing of it and changes nothing", async () => {
    expect(botId).not.toBe("");
    const blair = await signIn(BLAIR);
    const read = await api("GET", `/api/bots/${botId}/outbound`, blair);
    expect([403, 404]).toContain(read.status);
    expect(read.body.today).toBeUndefined();
    const patched = await api("PATCH", `/api/bots/${botId}`, blair, { outbound: { policy: "allow", dailyCap: 1000 } });
    expect([403, 404]).toContain(patched.status);
    const alex = await signIn(ALEX);
    expect((await api("GET", `/api/bots/${botId}/outbound`, alex)).body.policy).toEqual({ policy: "allow", dailyCap: 7 });
  }, 60_000);
});
