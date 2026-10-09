// The permission matrix (2026-10-09) through the real server against the
// fake Perspicax: a member's profile permissions arrive in the directory
// (`permissions` on the person) and open or close what was "admin only".
//
//   PM-1  no list from Perspicax: the member defaults (no usage, no engines,
//         bots created and shared as before); the viewer carries them
//   PM-2  usage.view opens GET /api/usage (route gate); without it a 403
//         names the permission; an admin always passes
//   PM-3  bots.approvalLevel and folders.botWorkingFolder open fields of a
//         bot the member owns (field gate); an admin passes
//   PM-4  a profile without bots.create or sharing.grants: creating a bot and
//         sharing one answer 403 with the key; the viewer says why
//   PM-5  engines.manage opens the engines (full rows, settings) but never an
//         engine's program path (host.shell stays an admin's); unknown and
//         admin-only keys from Perspicax are ignored
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MEMBER_DEFAULT_PERMISSIONS } from "../shared/permissions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CODEX_LOGIN = join(SERVER_DIR, "testing", "fake-codex-login-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ALICE: FakeOidcUser = { sub: "01J9PMALICE00000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9PMBOB000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [] };

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

/** Give Bob a permission list (undefined: an older Perspicax sends none),
 * then sign in until the viewer shows it (a sign-in refreshes the directory). */
async function bobWith(permissions: string[] | undefined): Promise<Auth> {
  idp.directoryPeople = [ALICE, BOB].map((user) => ({
    ...idp.personOf(user),
    ...(user === BOB && permissions ? { permissions } : {}),
  }));
  const expected = (permissions ?? MEMBER_DEFAULT_PERMISSIONS).filter((key) => !["host.shell", "server.settings", "nope.key"].includes(key));
  return waitFor(async () => {
    const auth = await signIn(BOB);
    const viewer = (await api("GET", "/api/config", auth)).body.viewer;
    return JSON.stringify([...(viewer?.permissions ?? [])].sort()) === JSON.stringify([...expected].sort()) ? auth : null;
  });
}

async function start() {
  child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      PATH: process.env.PATH,
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      SAGAX_IDENTITY: "perspicax",
      SAGAX_PERSPICAX_ISSUER: idp.issuer,
      SAGAX_PUBLIC_URL: BASE,
      SAGAX_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
      SAGAX_PERSPICAX_DIRECTORY_SECONDS: "3600",
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

posixOnly("Perspicax organization: the permission matrix", () => {
  let alice: Auth;

  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-permissions-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { codex: { driver: "codex", config: { cli: FAKE_CODEX_LOGIN } } },
    }));
    await start();
    alice = await signIn(ALICE);
  }, 60_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("PM-1: without a list from Perspicax a member holds the member defaults", async () => {
    const bob = await bobWith(undefined);
    const viewer = (await api("GET", "/api/config", bob)).body.viewer;
    expect(viewer.permissionsSource).toBe("defaults");
    expect(viewer.permissions).toEqual([...MEMBER_DEFAULT_PERMISSIONS]);
    expect(viewer.capabilities.viewUsage).toBe(false);
    const admin = (await api("GET", "/api/config", alice)).body.viewer;
    expect(admin.permissionsSource).toBe("admin");
    expect(admin.permissions).toContain("host.shell");
  }, 60_000);

  it("PM-2: usage.view opens the usage ledger, and a refusal names the key", async () => {
    let bob = await bobWith(undefined);
    const refused = await api("GET", "/api/usage?from=2026-10-01&to=2026-10-09", bob);
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body).toMatchObject({ error: "forbidden", permission: "usage.view" });
    expect(refused.body.message).toContain("See usage and spend");
    bob = await bobWith([...MEMBER_DEFAULT_PERMISSIONS, "usage.view"]);
    expect((await api("GET", "/api/config", bob)).body.viewer.capabilities.viewUsage).toBe(true);
    const allowed = await api("GET", "/api/usage?from=2026-10-01&to=2026-10-09", bob);
    expect(allowed.status, allowed.text).toBe(200);
    expect((await api("GET", "/api/usage?from=2026-10-01&to=2026-10-09", alice)).status).toBe(200);
  }, 60_000);

  it("PM-3: field permissions open the settings of a bot the member owns", async () => {
    let bob = await bobWith(undefined);
    const created = await api("POST", "/api/bots", bob, { name: "Sprout" });
    expect(created.status, created.text).toBe(201);
    const id = created.body.bot.id as string;
    const refused = await api("PATCH", `/api/bots/${id}`, bob, { approvalMode: "auto" });
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body).toMatchObject({ error: "forbidden", permission: "bots.approvalLevel", field: "approvalMode" });
    const folder = join(home, "work");
    mkdirSync(folder, { recursive: true });
    expect((await api("PATCH", `/api/bots/${id}`, bob, { cwd: folder })).body).toMatchObject({ permission: "folders.botWorkingFolder" });
    // a new bot cannot carry a folder either
    expect((await api("POST", "/api/bots", bob, { name: "Twig", cwd: folder })).body).toMatchObject({ permission: "folders.botWorkingFolder" });
    bob = await bobWith([...MEMBER_DEFAULT_PERMISSIONS, "bots.approvalLevel", "folders.botWorkingFolder"]);
    const allowed = await api("PATCH", `/api/bots/${id}`, bob, { approvalMode: "auto" });
    expect(allowed.status, allowed.text).toBe(200);
    const moved = await api("PATCH", `/api/bots/${id}`, bob, { cwd: folder });
    expect(moved.status, moved.text).toBe(200);
    // still never the fields no permission opens
    expect((await api("PATCH", `/api/bots/${id}`, bob, { chiefOfStaff: true })).status).toBe(403);
    // an admin passes without any permission list (an admin opens no one
    // else's bot without a grant, so on their own)
    const elm = await api("POST", "/api/bots", alice, { name: "Elm" });
    expect(elm.status, elm.text).toBe(201);
    const adminPatch = await api("PATCH", `/api/bots/${elm.body.bot.id}`, alice, { approvalMode: "auto", cwd: folder });
    expect(adminPatch.status, adminPatch.text).toBe(200);
  }, 60_000);

  it("PM-4: a profile without bots.create or sharing.grants", async () => {
    const people = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }>;
    const aliceId = people.find((person) => person.login === "alice")!.principalId;
    let bob = await bobWith([...MEMBER_DEFAULT_PERMISSIONS, "bots.approvalLevel"].filter((key) => key !== "sharing.grants"));
    const own = await api("POST", "/api/bots", bob, { name: "Leaf" });
    expect(own.status, own.text).toBe(201);
    const share = await api("PUT", `/api/bots/${own.body.bot.id}/grants`, bob, { target: `user:${aliceId}`, level: "use" });
    expect(share.status, share.text).toBe(403);
    expect(share.body).toMatchObject({ error: "forbidden", permission: "sharing.grants" });
    expect((await api("GET", `/api/bots/${own.body.bot.id}/grants`, bob)).body.administer).toBeNull();
    bob = await bobWith(MEMBER_DEFAULT_PERMISSIONS.filter((key) => key !== "bots.create"));
    const viewer = (await api("GET", "/api/config", bob)).body.viewer;
    expect(viewer).toMatchObject({ botsReadOnly: true, botsReadOnlyReason: "permission", canCreateBots: false });
    const refused = await api("POST", "/api/bots", bob, { name: "Moss" });
    expect(refused.status, refused.text).toBe(403);
    expect(refused.body).toMatchObject({ error: "forbidden", permission: "bots.create" });
    // the admin still creates and shares
    const admins = await api("POST", "/api/bots", alice, { name: "Oak" });
    expect(admins.status, admins.text).toBe(201);
  }, 60_000);

  it("PM-5: engines.manage opens the engines, never an engine's program; stray keys are ignored", async () => {
    let bob = await bobWith(undefined);
    const closed = await api("PATCH", "/api/instances/codex", bob, { tools: true });
    expect(closed.status, closed.text).toBe(403);
    expect(closed.body).toMatchObject({ error: "forbidden", permission: "engines.manage" });
    expect(((await api("GET", "/api/instances", bob)).body.instances as Array<Record<string, unknown>>).find((row) => row.instanceId === "codex")?.cli).toBeUndefined();
    bob = await bobWith([...MEMBER_DEFAULT_PERMISSIONS, "engines.manage", "host.shell", "server.settings", "nope.key"]);
    const viewer = (await api("GET", "/api/config", bob)).body.viewer;
    expect(viewer.permissions).toContain("engines.manage");
    expect(viewer.permissions).not.toContain("host.shell");
    expect(viewer.permissions).not.toContain("nope.key");
    expect(log).toContain('unknown permission "nope.key" ignored');
    expect(((await api("GET", "/api/instances", bob)).body.instances as Array<Record<string, unknown>>).find((row) => row.instanceId === "codex")?.cli).toBe(FAKE_CODEX_LOGIN);
    const program = await api("PATCH", "/api/instances/codex", bob, { cli: "/bin/sh" });
    expect(program.status, program.text).toBe(403);
    expect(program.body).toMatchObject({ error: "forbidden", permission: "host.shell", field: "cli" });
    // an admin-only route stays closed whatever the list says
    expect((await api("PUT", "/api/config", bob, { profile: { name: "x" } })).status).toBe(403);
  }, 60_000);
});
