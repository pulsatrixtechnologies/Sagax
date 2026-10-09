// Organization server, through the real server (an isolated fixture: its own
// temporary home, fake Perspicax and fake engine):
//
//   NU-1  alice (the owner, admin) nudges bob: bob's stream hears the nudge
//         frame addressed to him with the conversation they share; alice's
//         own stream hears only the `nudge.sent` echo with the same id;
//         carol's hears nothing
//   NU-2  bob (a member) nudges alice: alice's stream hears it, bob's gets
//         the echo
//   NU-3  a group nudge reaches the other people of the room; the sender
//         gets the echo only
//   NU-4  a direct message is unread for the recipient only: the sender
//         reading the conversation does not clear it for them, and the
//         recipient reading it clears it
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { request } from "node:http";
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
const ALICE: FakeOidcUser = { sub: "01J9PTALICE0000000000000A", email: "alice@example.test", name: "Alice", preferred_username: "alice", role: "admin" };
const BOB: FakeOidcUser = { sub: "01J9PTBOB00000000000000B", email: "bob@example.test", name: "Bob", preferred_username: "bob", role: "employee" };

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
    if (Date.now() > deadline) throw new Error(`timed out. server log:\n${log.slice(-3000)}`);
    await sleep(150);
  }
}

async function openStream(auth: Auth): Promise<{ text: () => string; close: () => void }> {
  const { body } = await api("POST", "/api/auth/stream-ticket", auth);
  expect(body.ticket).toMatch(/^sgx_tick_/);
  return new Promise((resolve, reject) => {
    let received = "";
    const req = request(`${BASE}/api/events?ticket=${encodeURIComponent(body.ticket)}`, { headers: { accept: "text/event-stream" } }, (res) => {
      expect(res.statusCode).toBe(200);
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => { received += chunk; });
      resolve({ text: () => received, close: () => req.destroy() });
    });
    req.on("error", reject);
    req.end();
  });
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

const CAROL: FakeOidcUser = { sub: "01J9PTCAROL0000000000000C", email: "carol@example.test", name: "Carol", preferred_username: "carol", role: "employee" };

posixOnly("Perspicax organization: a nudge reaches the person nudged, and the sender's own windows", () => {
  let alice: Auth;
  let ids: Record<"alice" | "bob" | "carol", string>;

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    idp = await startFakeOidcProvider({ user: ALICE });
    idp.directoryPeople = [ALICE, BOB, CAROL].map((user) => idp.personOf(user));
    PORT = await freePortBlock([0, 1]);
    BASE = `http://127.0.0.1:${PORT}`;
    home = mkdtempSync(join(tmpdir(), "omb-nudge-"));
    const data = join(home, ".openmausbot");
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
      const got = await api("GET", "/api/org/directory", alice);
      const list = got.body.people as Array<{ principalId: string; login: string }> | undefined;
      return list && list.length === 3 ? list : null;
    });
    const idOf = (login: string) => people.find((person) => person.login === login)!.principalId;
    ids = { alice: idOf("alice"), bob: idOf("bob"), carol: idOf("carol") };
  }, 40_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    if (child) await waitForExit(child);
    await idp?.close();
    if (home) removeTempDir(home);
  });

  const nudgeFrames = (stream: { text: () => string }) => stream.text().split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => { try { return JSON.parse(line.slice(6)); } catch { return null; } })
    .filter((frame) => frame?.kind === "nudge") as Array<{ audience: string; id: string; fromId: string; fromName: string; at: number; open?: { groupId: string; threadId: string } }>;
  const sentFrames = (stream: { text: () => string }) => stream.text().split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => { try { return JSON.parse(line.slice(6)); } catch { return null; } })
    .filter((frame) => frame?.kind === "nudge.sent") as Array<{ audience: string; id: string; toId: string; toName: string; at: number; open?: { groupId: string; threadId: string } }>;

  it("NU-1: the owner nudges a member: the member's stream hears it, the sender's and a third person's do not", async () => {
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const aliceStream = await openStream(alice);
    const bobStream = await openStream(bob);
    const carolStream = await openStream(carol);
    const sent = await api("POST", "/api/nudges", alice, { principalId: ids.bob });
    expect(sent.status, sent.text).toBe(200);
    const heard = await waitFor(async () => nudgeFrames(bobStream)[0]);
    expect(heard).toMatchObject({ audience: ids.bob, fromId: ids.alice, fromName: "Alice" });
    // the frame names the conversation the two share, so a click opens it
    const dms = (await api("GET", "/api/groups", bob)).body as Array<{ id: string; threadId: string; peopleDm?: boolean; humanIds?: string[] }>;
    const dm = (Array.isArray(dms) ? dms : (dms as any).groups ?? []).find((group: any) => group.peopleDm && group.humanIds?.includes(ids.alice));
    expect(dm, JSON.stringify(dms).slice(0, 500)).toBeTruthy();
    expect(heard.open).toEqual({ groupId: dm.id, threadId: dm.threadId });
    expect(heard.id).toBe(sent.body.id);
    // the sender's own stream: the echo, same id, never the receiver's frame
    const echo = await waitFor(async () => sentFrames(aliceStream)[0]);
    expect(echo).toMatchObject({ audience: ids.alice, id: sent.body.id, toId: ids.bob, at: sent.body.at });
    expect(echo.open).toEqual({ groupId: dm.id, threadId: dm.threadId });
    await sleep(300);
    expect(nudgeFrames(aliceStream)).toEqual([]);
    expect(nudgeFrames(carolStream)).toEqual([]);
    expect(sentFrames(bobStream)).toEqual([]);
    expect(sentFrames(carolStream)).toEqual([]);
    aliceStream.close();
    bobStream.close();
    carolStream.close();
  }, 60_000);

  it("NU-2: a member nudges the owner: the owner's stream hears it, the member's does not", async () => {
    const bob = await signIn(BOB);
    const aliceStream = await openStream(alice);
    const bobStream = await openStream(bob);
    const sent = await api("POST", "/api/nudges", bob, { principalId: ids.alice });
    expect(sent.status, sent.text).toBe(200);
    const heard = await waitFor(async () => nudgeFrames(aliceStream)[0]);
    expect(heard).toMatchObject({ audience: ids.alice, fromId: ids.bob, fromName: "Bob" });
    expect(heard.open?.groupId).toBeTruthy();
    expect(await waitFor(async () => sentFrames(bobStream)[0])).toMatchObject({ audience: ids.bob, id: sent.body.id, toId: ids.alice });
    await sleep(300);
    expect(nudgeFrames(bobStream)).toEqual([]);
    expect(sentFrames(aliceStream)).toEqual([]);
    aliceStream.close();
    bobStream.close();
  }, 60_000);

  it("NU-3: a group nudge reaches the other people of the room, never the sender", async () => {
    const bob = await signIn(BOB);
    const carol = await signIn(CAROL);
    const bot = await api("POST", "/api/bots", alice, { name: "Opsbot" });
    expect(bot.status, bot.text).toBe(201);
    const room = await api("POST", "/api/groups", alice, {
      name: "Ops", memberIds: [bot.body.bot.id], humanIds: [ids.alice, ids.bob, ids.carol],
      setup: { bulletin: "", defaultResponder: { kind: "everyone" } },
    });
    expect(room.status, room.text).toBeLessThan(300);
    const groupId = (room.body.group ?? room.body).id as string;
    const aliceStream = await openStream(alice);
    const bobStream = await openStream(bob);
    const carolStream = await openStream(carol);
    const sent = await api("POST", "/api/nudges", carol, { groupId });
    expect(sent.status, sent.text).toBe(200);
    const toAlice = await waitFor(async () => nudgeFrames(aliceStream)[0]);
    const toBob = await waitFor(async () => nudgeFrames(bobStream)[0]);
    expect(toAlice).toMatchObject({ audience: ids.alice, fromId: ids.carol, open: { groupId } });
    expect(toBob).toMatchObject({ audience: ids.bob, fromId: ids.carol, open: { groupId } });
    expect(await waitFor(async () => sentFrames(carolStream)[0])).toMatchObject({ audience: ids.carol, id: sent.body.id, toId: groupId });
    await sleep(300);
    expect(nudgeFrames(carolStream)).toEqual([]);
    expect(sentFrames(aliceStream)).toEqual([]);
    expect(sentFrames(bobStream)).toEqual([]);
    aliceStream.close();
    bobStream.close();
    carolStream.close();
  }, 60_000);

  it("NU-4: a direct message is unread for the recipient only, until they read it", async () => {
    const bob = await signIn(BOB);
    const opened = await api("POST", "/api/people-dms", alice, { principalId: ids.bob });
    expect(opened.status, opened.text).toBeLessThan(300);
    const dm = opened.body.group as { id: string; threadId: string };
    const bobStream = await openStream(bob);
    const aliceStream = await openStream(alice);
    const unreadOf = async (auth: Auth) => ((await api("GET", "/api/groups", auth)).body.groups as Array<{ id: string; unread: boolean; unreadFor?: unknown }>).find((group) => group.id === dm.id);
    const sent = await api("POST", `/api/groups/${dm.id}/messages`, alice, { text: "are you there?" });
    expect(sent.status, sent.text).toBe(202);
    // alice is reading the conversation: her app marks it read at once
    expect((await api("POST", `/api/groups/${dm.id}/read`, alice)).status).toBe(200);
    expect(await unreadOf(alice)).toMatchObject({ unread: false });
    const bobView = await unreadOf(bob);
    expect(bobView).toMatchObject({ unread: true });
    expect(bobView?.unreadFor).toBeUndefined();
    // the live frames say the same, each to its own person
    const groupFrames = (stream: { text: () => string }) => stream.text().split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => { try { return JSON.parse(line.slice(6)); } catch { return null; } })
      .filter((frame) => frame?.kind === "group" && frame.group?.id === dm.id)
      .map((frame) => frame.group as { unread: boolean; unreadFor?: unknown });
    await waitFor(async () => groupFrames(aliceStream).some((group) => group.unread === false));
    expect(groupFrames(bobStream).at(-1)).toMatchObject({ unread: true });
    expect([...groupFrames(aliceStream), ...groupFrames(bobStream)].some((group) => group.unreadFor !== undefined)).toBe(false);
    // bob opens it: read for him too
    const read = await api("PATCH", `/api/groups/${dm.id}`, bob, { unread: false });
    expect(read.status, read.text).toBe(200);
    expect(await unreadOf(bob)).toMatchObject({ unread: false });
    aliceStream.close();
    bobStream.close();
  }, 60_000);
});
