// A person's name and avatar on a Perspicax organization server, through the
// real server and the fake Perspicax with avatars on (the Perspicax change
// Sagax consumes: `picture` claim, directory `avatar`, and
// GET /api/v1/pulsabot/people/<sub>/avatar with the link token). The person
// reads as their Perspicax display name, never their login when a better
// name exists; their avatar is served by this server at a versioned URL; and
// a change in Perspicax flows down at the next sign-in or directory sync.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { startFakeOidcProvider, type FakeOidcProvider, type FakeOidcUser } from "./testing/fake-oidc-provider.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const posixOnly = describe.skipIf(process.platform === "win32");
const JC: FakeOidcUser = { sub: "01J9S8JCPROULX0000000000JC", email: "jcproulx@example.test", name: "Jean-Christophe Proulx", preferred_username: "jcproulx", role: "admin" };
// no display name: Perspicax's directory sends the login as the name
const NONAME: FakeOidcUser = { sub: "01J9S8NONAME00000000000NN", email: "sam.t@example.test", preferred_username: "samt", role: "employee" };
const PNG = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("fake png body one")]);
const PNG2 = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("fake png body two")]);

let PORT = 0;
let BASE = "";
let child: ChildProcess | undefined;
let home = "";
let log = "";
let idp: FakeOidcProvider;
let jc = "";
let noname = "";

// What Caddy adds in front of the server: the request is remote, so it gets
// no loopback trust and needs its own session.
const REMOTE = { "x-forwarded-for": "198.51.100.23", "x-forwarded-proto": "https" };
const cookiePair = (setCookie: string) => setCookie.split(";")[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, cookie: string): Promise<{ status: number; body: any; text: string }> {
  const res = await fetch(`${BASE}${path}`, { headers: { ...REMOTE, cookie }, signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let body: any = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, text };
}

async function signIn(user: FakeOidcUser): Promise<string> {
  idp.user = { ...user };
  const start = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(start.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(start.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return cookiePair(session!);
}

async function until<T>(check: () => Promise<T | undefined>, ms = 15_000): Promise<T | undefined> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) return undefined;
    await sleep(250);
  }
}

posixOnly("a person's name and avatar on an organization server", () => {
  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: JC });
    idp.avatarsEnabled = true;
    idp.avatars.set(JC.sub, PNG);
    idp.directoryPeople = [JC, NONAME].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-org-profile-"));
    const data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    writeFileSync(join(data, "config.json"), JSON.stringify({ profile: { name: "Operator", email: "op@example.test" } }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, OMB_LOCAL_VM_TEST_NAMESPACE: process.env.OMB_LOCAL_VM_TEST_NAMESPACE ?? "", OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1),
        OMB_IDENTITY: "perspicax", OMB_PERSPICAX_ISSUER: idp.issuer, OMB_PUBLIC_URL: BASE,
        OMB_PERSPICAX_LINK_FILE: join(home, "link", "pulsabot.json"),
        OMB_PERSPICAX_DIRECTORY_SECONDS: "5",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(2_000) })).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up:\n${log}`);
      await sleep(150);
    }
    jc = await signIn(JC);
    noname = await signIn(NONAME);
  }, 60_000);

  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    await idp?.close();
    if (home) await removeTempDir(home);
  });

  it("names the person by their Perspicax display name, not their login", async () => {
    const session = await api("/api/auth/session", jc);
    expect(session.body).toMatchObject({ name: "Jean-Christophe Proulx", login: "jcproulx", profileManagedBy: "perspicax" });
    const config = await api("/api/config", jc);
    expect(config.body.viewer.name).toBe("Jean-Christophe Proulx");
    expect(config.body.profile.name).toBe("Jean-Christophe Proulx");
    expect(config.text).not.toContain('"name":"jcproulx"');
  });

  it("falls back to the address, then the login, when Perspicax has no display name", async () => {
    const config = await api("/api/config", noname);
    expect(config.body.viewer.name).toBe("sam.t");
    const directory = await api("/api/org/directory", jc);
    const sam = directory.body.people.find((person: any) => person.login === "samt");
    expect(sam.name).toBe("sam.t");
  });

  it("serves the Perspicax avatar at a versioned URL, read through the link", async () => {
    const version = idp.avatarVersion(JC.sub)!;
    const config = await api("/api/config", jc);
    const url = config.body.viewer.avatarUrl as string;
    expect(url).toBe(`/api/people/${config.body.viewer.principalId}/avatar?v=${version}`);
    expect(config.body.profile.avatarUrl).toBe(url);
    expect((await api("/api/auth/session", jc)).body.avatarUrl).toBe(url);
    const res = await fetch(`${BASE}${url}`, { headers: { ...REMOTE, cookie: jc } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    expect(idp.avatarRequests.at(-1)).toEqual({ sub: JC.sub, authorized: true });
    // the directory lists it for pickers and room members
    const directory = await api("/api/org/directory", noname);
    expect(directory.body.people.find((person: any) => person.login === "jcproulx")).toMatchObject({ name: "Jean-Christophe Proulx", avatarUrl: url });
    // a person without one has no URL, and the route says so
    const sam = await api("/api/config", noname);
    expect(sam.body.viewer.avatarUrl).toBeUndefined();
    expect((await fetch(`${BASE}/api/people/${sam.body.viewer.principalId}/avatar`, { headers: { ...REMOTE, cookie: noname } })).status).toBe(404);
    // and nobody unauthenticated reads it
    expect([401, 403]).toContain((await fetch(`${BASE}${url}`, { headers: REMOTE })).status);
  });

  it("takes a new name and avatar from the directory sync, and a removed avatar too", async () => {
    idp.avatars.set(JC.sub, PNG2);
    const version = idp.avatarVersion(JC.sub)!;
    idp.directoryPeople = [{ ...JC, name: "J-C Proulx" }, NONAME].map((user) => idp.personOf(user));
    const updated = await until(async () => {
      const viewer = (await api("/api/config", jc)).body.viewer;
      return viewer?.name === "J-C Proulx" && viewer.avatarUrl?.endsWith(`v=${version}`) ? viewer : undefined;
    });
    expect(updated, log.slice(-2000)).toBeTruthy();
    const res = await fetch(`${BASE}${updated.avatarUrl}`, { headers: { ...REMOTE, cookie: jc } });
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG2)).toBe(true);
    idp.avatars.delete(JC.sub);
    const removed = await until(async () => {
      const viewer = (await api("/api/config", jc)).body.viewer;
      return viewer && viewer.avatarUrl === undefined ? viewer : undefined;
    });
    expect(removed).toBeTruthy();
    expect((await api("/api/config", jc)).body.profile.avatarUrl).toBe("");
  }, 40_000);

  it("takes the picture claim at the next sign-in", async () => {
    // Perspicax changes both places at once; the sign-in sees it first
    idp.avatars.set(JC.sub, PNG);
    idp.directoryPeople = [JC, NONAME].map((user) => idp.personOf(user));
    jc = await signIn(JC);
    const config = await api("/api/config", jc);
    expect(config.body.viewer.avatarUrl).toMatch(new RegExp(`v=${idp.avatarVersion(JC.sub)}$`));
    expect(config.body.viewer.name).toBe("Jean-Christophe Proulx");
  });
});
