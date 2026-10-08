// People's custom labels through the real server (organization mode, fake
// Perspicax provider): the person sets their own, an admin sets anyone's, a
// team manager sets their team's people, everyone else gets 403. The label
// rides the directory, GET /api/people/labels and a `person.label` frame to
// every stream; an admin's change is in the admin activity log; it survives
// a restart.
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
const TEAM_T = "01J9PLTEAMT0000000000000TT";
const ALICE: FakeOidcUser = { sub: "01J9PLALICE0000000000000A", name: "Alice", preferred_username: "alice", role: "admin", teams: [] };
const BOB: FakeOidcUser = { sub: "01J9PLBOB00000000000000B", name: "Bob", preferred_username: "bob", role: "employee", teams: [{ id: TEAM_T, name: "T", manager: false }] };
const CAROL: FakeOidcUser = { sub: "01J9PLCAROL0000000000000C", name: "Carol", preferred_username: "carol", role: "employee", teams: [] };
const MONA: FakeOidcUser = { sub: "01J9PLMONA00000000000000M", name: "Mona", preferred_username: "mona", role: "manager", teams: [{ id: TEAM_T, name: "T", manager: true }] };

let PORT = 0;
let BASE = "";
let child: ChildProcess;
let home: string;
let log = "";
let idp: FakeOidcProvider;

type Auth = { cookie: string };
const api = async (method: string, path: string, auth?: Auth, body?: unknown): Promise<{ status: number; body: any; text: string }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(auth ? { cookie: auth.cookie } : {}) },
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
  const begin = await fetch(`${BASE}/auth/oidc/start`, { redirect: "manual" });
  const binding = cookiePair(begin.headers.getSetCookie().find((c) => c.includes("_oidc="))!);
  const authorize = await fetch(begin.headers.get("location")!, { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location")!, { redirect: "manual", headers: { cookie: binding } });
  const session = callback.headers.getSetCookie().find((c) => c.startsWith("omb_session_") && !c.includes("_oidc="));
  expect(callback.headers.get("location"), log.slice(-2000)).toBe("/");
  return { cookie: cookiePair(session!) };
}

async function waitFor<T>(read: () => Promise<T | null | undefined | false> | T | null | undefined | false, ms = 15_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

/** A person's event stream: every frame but hello and ping. */
function stream(auth: Auth): { frames: any[]; close(): void } {
  const frames: any[] = [];
  const controller = new AbortController();
  void (async () => {
    try {
      const res = await fetch(`${BASE}/api/events`, { headers: { cookie: auth.cookie }, signal: controller.signal });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          for (const line of chunk.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const frame = JSON.parse(line.slice(6));
            if (frame.kind !== "hello" && frame.kind !== "ping") frames.push(frame);
          }
        }
      }
    } catch { /* closed */ }
  })();
  return { frames, close: () => controller.abort() };
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
      SAGAX_ORG_NAME: "Acme",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  await waitFor(async () => {
    try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
  }, 20_000);
}

async function stop() {
  child.kill("SIGTERM");
  await waitForExit(child);
}

posixOnly("people's custom labels on an organization server", () => {
  let alice: Auth;
  let bob: Auth;
  let carol: Auth;
  let mona: Auth;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL, MONA].map((user) => idp.personOf(user));
    idp.directoryTeams = [{ id: TEAM_T, name: "T", managers: [MONA.sub], members: [BOB.sub] }];
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-person-labels-"));
    mkdirSync(join(home, ".sagax"), { recursive: true });
    mkdirSync(join(home, "link"), { recursive: true, mode: 0o750 });
    writeFileSync(join(home, "link", "pulsabot.json"), JSON.stringify({
      version: 1, issuer: idp.issuer, client_id: "pulsa-bot", server_id: idp.serverId, origin: BASE, link_token: idp.linkToken,
    }), { mode: 0o640 });
    await start();
    alice = await signIn(ALICE);
    const people = await waitFor(async () => {
      const got = (await api("GET", "/api/org/directory", alice)).body.people as Array<{ principalId: string; login: string }> | undefined;
      return got && got.length === 4 ? got : null;
    });
    for (const person of people) ids[person.login] = person.principalId;
    bob = await signIn(BOB);
    carol = await signIn(CAROL);
    mona = await signIn(MONA);
  }, 90_000);

  afterAll(async () => {
    if (child) await stop();
    await idp?.close();
    if (home) removeTempDir(home);
  });

  it("PL-1: an admin labels a member; the other clients see it in the directory, the labels and a person.label frame", async () => {
    const bobStream = stream(bob);
    const carolStream = stream(carol);
    try {
      await sleep(500);
      const set = await api("PUT", `/api/people/${ids.bob}/label`, alice, { label: "  Dispatch " });
      expect(set.status, set.text).toBe(200);
      expect(set.body).toEqual({ principalId: ids.bob, label: "Dispatch" });
      for (const frames of [bobStream.frames, carolStream.frames]) {
        await waitFor(() => frames.find((frame) => frame.kind === "person.label" && frame.principalId === ids.bob && frame.label === "Dispatch"));
      }
      const directory = await api("GET", "/api/org/directory", carol);
      expect(directory.body.people.find((person: { principalId: string }) => person.principalId === ids.bob)).toMatchObject({ label: "Dispatch" });
      expect(directory.body.people.find((person: { principalId: string }) => person.principalId === ids.carol)).not.toHaveProperty("label");
      expect((await api("GET", "/api/people/labels", carol)).body).toEqual({ labels: { [ids.bob]: "Dispatch" } });
    } finally {
      bobStream.close();
      carolStream.close();
    }
  });

  it("PL-2: a person sets their own; a manager sets their team's people; anyone else gets 403", async () => {
    expect((await api("PUT", `/api/people/${ids.carol}/label`, carol, { label: "CTO" })).body).toEqual({ principalId: ids.carol, label: "CTO" });
    expect((await api("PUT", `/api/people/${ids.bob}/label`, mona, { label: "Lead" })).status).toBe(200);
    for (const [who, target] of [[carol, ids.bob], [bob, ids.carol], [mona, ids.carol], [bob, ids.alice]] as const) {
      const refused = await api("PUT", `/api/people/${target}/label`, who, { label: "Nope" });
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe("person_label_forbidden");
    }
    expect((await api("PUT", `/api/people/${ids.carol}/label`, carol, { label: "x".repeat(41) })).body.code).toBe("label_too_long");
    expect((await api("GET", "/api/people/labels", bob)).body.labels).toEqual({ [ids.bob]: "Lead", [ids.carol]: "CTO" });
  });

  it("PL-3: changes made for someone else are in the admin activity log; a person's own is not", async () => {
    const entries = await waitFor(async () => {
      const got = (await api("GET", "/api/admin-activity?what=people", alice)).body.entries as Array<{ action: string; target?: { id?: string }; before?: Record<string, unknown>; after?: Record<string, unknown> }> | undefined;
      const rows = (got ?? []).filter((entry) => entry.action === "people.label");
      return rows.length >= 2 ? rows : null;
    });
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.target?.id === ids.bob)).toBe(true);
    expect(entries.map((entry) => entry.after?.label).sort()).toEqual(["Dispatch", "Lead"]);
    expect(entries.map((entry) => entry.after?.by).sort()).toEqual(["admin", "manager"]);
  });

  it("PL-4: labels survive a restart, and clearing one removes it", async () => {
    await stop();
    await start();
    alice = await signIn(ALICE);
    expect((await api("GET", "/api/people/labels", alice)).body.labels).toEqual({ [ids.bob]: "Lead", [ids.carol]: "CTO" });
    expect((await api("PUT", `/api/people/${ids.bob}/label`, alice, { label: null })).body).toEqual({ principalId: ids.bob, label: null });
    expect((await api("GET", "/api/people/labels", alice)).body.labels).toEqual({ [ids.carol]: "CTO" });
  }, 60_000);
});
