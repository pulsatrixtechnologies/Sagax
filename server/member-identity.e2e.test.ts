// A member of the organization through the real server: she signs in with
// Pulsatrix (the fake provider, server/testing/fake-oidc-provider.ts; slice 8
// removed the interim invite links) and then sees herself, not the operator,
// in /api/config and in config frames; she creates a bot that is hers alone,
// edits and deletes only her own bots, and still cannot reach server admin
// routes. A guest (a person with no organization role) creates nothing.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const OWNER_NAME = "Jean-Christophe Proulx";
const OWNER_EMAIL = "jc@gox.ca";
const OWNER_ABOUT = "private note about the operator";
const ZARA = "zara@example.test";
const MAX = "max@example.test";
const GUEST_ID = "pr_0f0f0f0f-1111-4222-8333-444455556666";
// What Caddy adds in front of the server: the request is remote, so it gets
// no loopback trust and needs its own session.
const REMOTE = { "x-forwarded-for": "198.51.100.23", "x-forwarded-proto": "https" };

const ZARA_USER: FakeOidcUser = { sub: "01J9S8ZARA000000000000000Z", email: ZARA, preferred_username: "zara", role: "employee" };
const MAX_USER: FakeOidcUser = { sub: "01J9S8MAX0000000000000000M", email: MAX, preferred_username: "max", role: "employee" };

let child: ChildProcess | undefined;
let idp: FakeOidcProvider | undefined;
let home = "";
let log = "";
let maxCookie = "";
let guestToken = "";
let zaraCookie = "";

const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
async function signIn(user: FakeOidcUser): Promise<string> {
  idp!.user = { ...user };
  const start = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return cookiePair(session!);
}

type Who = "owner" | "zara" | "max" | "guest";
function headersFor(who: Who): Record<string, string> {
  if (who === "zara") return { ...REMOTE, cookie: zaraCookie };
  if (who === "max") return { ...REMOTE, cookie: maxCookie };
  if (who === "guest") return { ...REMOTE, authorization: `Bearer ${guestToken}` };
  return {};
}

async function api(method: string, path: string, options: { body?: unknown; as?: Who; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...headersFor(options.as ?? "owner"),
      ...options.headers,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body, text, cookie: res.headers.get("set-cookie") };
}

async function until<T>(check: () => T | undefined, ms = 5_000): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = check();
    if (value) return value;
    if (Date.now() > deadline) return undefined;
    await new Promise((r) => setTimeout(r, 50));
  }
}

posixOnly("an organization member's identity and bots", () => {
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-member-identity-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      profile: { name: OWNER_NAME, email: OWNER_EMAIL, aboutMe: OWNER_ABOUT },
    }));
    idp = await startFakeOidcProvider({ user: ZARA_USER });
    idp.directoryPeople = [ZARA_USER, MAX_USER].map((user) => idp!.personOf(user));
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    // A guest: a person the server knows, in no sign-in list.
    writeFileSync(join(data, "principals.json"), JSON.stringify({
      version: 1,
      principals: [{ id: GUEST_ID, kind: "guest", email: "gus@example.test", createdAt: 1 }],
    }));
    const registry = new SessionRegistry({ file: join(data, "sessions.json") });
    guestToken = registry.issue({ label: "Guest", principalId: GUEST_ID, scopes: ["client"] }).token;
    registry.close();
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1),
        OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: idp.issuer, OMB_PUBLIC_URL: BASE,
        OMB_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        // The operator at this computer, as on a desktop or a one-person server.
        OMB_LOOPBACK_TRUST: "owner",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
      await new Promise((r) => setTimeout(r, 150));
    }
    zaraCookie = await signIn(ZARA_USER);
    maxCookie = await signIn(MAX_USER);
  }, 40_000);

  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    await idp?.close();
    await removeTempDir(home);
  });

  it("describes the operator to the operator, as before", async () => {
    const config = await api("GET", "/api/config");
    expect(config.status).toBe(200);
    expect(config.body.profile).toMatchObject({ name: OWNER_NAME, email: OWNER_EMAIL, aboutMe: OWNER_ABOUT });
    expect(config.body.viewer).toMatchObject({ operator: true, email: OWNER_EMAIL, name: OWNER_NAME, role: "owner", canCreateBots: true });
    expect(config.body.viewer.principalId).toMatch(/^pr_/);
  });

  it("describes a member as herself and never sends her the operator's email or about-me", async () => {
    const config = await api("GET", "/api/config", { as: "zara" });
    expect(config.status, config.text).toBe(200);
    expect(config.body.profile).toEqual({ name: "zara", email: ZARA, aboutMe: "", avatarUrl: "" });
    expect(config.body.viewer).toMatchObject({ operator: false, email: ZARA, name: "zara", role: "member", canCreateBots: true });
    expect(config.body.viewer.principalId).toMatch(/^pr_/);
    expect(config.text).not.toContain(OWNER_EMAIL);
    expect(config.text).not.toContain(OWNER_ABOUT);
    const seeded = await api("GET", "/api/config", { as: "max" });
    expect(seeded.body.viewer).toMatchObject({ operator: false, email: MAX, name: "max", role: "member", canCreateBots: true });
    expect(seeded.body.viewer.principalId).not.toBe(config.body.viewer.principalId);
  });

  it("sends each stream a config frame naming its own viewer", async () => {
    const controller = new AbortController();
    const res = await fetch(`${BASE}/api/events`, { headers: headersFor("zara"), signal: controller.signal });
    expect(res.status).toBe(200);
    let text = "";
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
      } catch {
        /* aborted */
      }
    })();
    await until(() => text.includes('"hello"') || undefined);
    const saved = await api("PUT", "/api/config", { body: { language: "fr" } });
    expect(saved.status, saved.text).toBe(200);
    const frame = await until(() => text.split("\n").find((line) => line.startsWith("data:") && line.includes('"kind":"config"')));
    controller.abort();
    await pump;
    expect(frame).toBeTruthy();
    const payload = JSON.parse(frame!.slice(5));
    expect(payload.profile).toEqual({ name: "zara", email: ZARA, aboutMe: "", avatarUrl: "" });
    expect(payload.viewer).toMatchObject({ operator: false, email: ZARA, role: "member" });
    expect(frame).not.toContain(OWNER_EMAIL);
  });

  let zaraBot = "";
  let opsBot = "";

  it("lets a member create a bot that is hers alone", async () => {
    const created = await api("POST", "/api/bots", { as: "zara", body: { name: "Scout", settings: { soul: "Be brief.", color: "green" } } });
    expect(created.status, created.text).toBe(201);
    zaraBot = created.body.bot.id;
    const me = (await api("GET", "/api/config", { as: "zara" })).body.viewer.principalId;
    expect(created.body.bot.ownerUserId).toBe(me);
    const hers = await api("GET", "/api/bots", { as: "zara" });
    expect(hers.body.bots.map((b: any) => b.id)).toContain(zaraBot);
    const his = await api("GET", "/api/bots", { as: "max" });
    expect(his.body.bots.map((b: any) => b.id)).not.toContain(zaraBot);
    expect((await api("PATCH", `/api/bots/${zaraBot}`, { as: "max", body: { name: "Mine now" } })).status).toBe(404);
    expect((await api("DELETE", `/api/bots/${zaraBot}`, { as: "max" })).status).toBe(404);
  });

  it("refuses a member's bot the settings that stay with server admins", async () => {
    for (const body of [
      { name: "Shell", settings: { computer: "local" } },
      { name: "Folder", settings: { cwd: "/" } },
      { name: "Loose", settings: { approvalMode: "auto" } },
      { name: "Team", section: "Ops" },
      { name: "Preset", preset: "researcher" },
    ]) {
      const refused = await api("POST", "/api/bots", { as: "zara", body });
      expect(refused.status, `${JSON.stringify(body)}: ${refused.text}`).toBe(403);
    }
    expect((await api("PATCH", `/api/bots/${zaraBot}`, { as: "zara", body: { cwd: "/" } })).status).toBe(403);
    expect((await api("PATCH", `/api/bots/${zaraBot}`, { as: "zara", body: { approvalMode: "auto" } })).status).toBe(403);
  });

  it("lets a member edit and delete only her own bots", async () => {
    const renamed = await api("PATCH", `/api/bots/${zaraBot}`, { as: "zara", body: { name: "Scout 2", soul: "Be very brief." } });
    expect(renamed.status, renamed.text).toBe(200);
    expect(renamed.body.bot.name).toBe("Scout 2");
    const ops = await api("POST", "/api/bots", { body: { name: "Ops" } });
    expect(ops.status).toBe(201);
    opsBot = ops.body.bot.id;
    const zaraId = (await api("GET", "/api/config", { as: "zara" })).body.viewer.principalId;
    const granted = await api("POST", `/api/bots/${opsBot}/direct-grants`, { body: { userId: zaraId } });
    expect(granted.status, granted.text).toBe(200);
    expect((await api("GET", "/api/bots", { as: "zara" })).body.bots.map((b: any) => b.id)).toContain(opsBot);
    expect((await api("PATCH", `/api/bots/${opsBot}`, { as: "zara", body: { name: "Hijacked" } })).status).toBe(403);
    expect((await api("PATCH", `/api/bots/${opsBot}`, { as: "zara", body: { color: "red" } })).status).toBe(403);
    expect((await api("PATCH", `/api/bots/${opsBot}/profile`, { as: "zara", body: { name: "Hijacked" } })).status).toBe(403);
    expect((await api("DELETE", `/api/bots/${opsBot}`, { as: "zara" })).status).toBe(403);
    expect((await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === opsBot)?.name).toBe("Ops");
    const own = await api("PATCH", `/api/bots/${zaraBot}/profile`, { as: "zara", body: { title: "Researcher" } });
    expect(own.status, own.text).toBe(200);
    const deleted = await api("DELETE", `/api/bots/${zaraBot}`, { as: "zara" });
    expect(deleted.status, deleted.text).toBe(200);
    expect((await api("GET", "/api/bots")).body.bots.map((b: any) => b.id)).not.toContain(zaraBot);
  });

  it("keeps a guest from creating bots", async () => {
    const config = await api("GET", "/api/config", { as: "guest" });
    expect(config.status, config.text).toBe(200);
    expect(config.body.viewer).toMatchObject({ operator: false, principalId: GUEST_ID, role: null, canCreateBots: false });
    expect(config.text).not.toContain(OWNER_EMAIL);
    const refused = await api("POST", "/api/bots", { as: "guest", body: { name: "Nope" } });
    expect(refused.status).toBe(403);
  });

  it("gives a member no server admin route", async () => {
    for (const [method, path, body] of [
      ["PUT", "/api/config", { profile: { name: "Zara" } }],
      ["PUT", "/api/config", { language: "en" }],
      ["GET", "/api/auth/sessions", undefined],
      ["POST", "/api/auth/pairing", { label: "x", scopes: ["admin"] }],
      ["POST", "/api/org/invites", { email: "eve@example.test" }],
      ["GET", "/api/instances", undefined],
      ["GET", "/api/mcp/servers", undefined],
      ["POST", "/api/teams/import", {}],
    ] as const) {
      const res = await api(method, path, { as: "zara", ...(body !== undefined ? { body } : {}) });
      expect(res.status, `${method} ${path}: ${res.text}`).toBe(403);
    }
    expect((await api("GET", "/api/config")).body.profile.name).toBe(OWNER_NAME);
  });
});
