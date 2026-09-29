// Org identity through the real server: the organization needs a server
// address, its owner is the local operator's principal id (never an email or
// "local-owner"), a phone paired from this computer is that same person, and
// a restart keeps one local operator and the same owner.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SessionRegistry } from "./sessions.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess | undefined;
let home: string;
let data: string;
let log = "";
const ZARA = "zara@example.test";
let zaraToken = "";

const api = async (method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed };
};

async function start() {
  log = "";
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home, USERPROFILE: home, OMB_PORT: String(PORT), OMB_WEBHOOK_PORT: String(PORT + 1),
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
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function stop() {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  child = undefined;
}

/** A live /api/events stream: what it received so far, and whether the
 * server ended it. */
function openStream(token: string) {
  const state = { text: "", closed: false };
  const controller = new AbortController();
  const ready = (async () => {
    const res = await fetch(`${BASE}/api/events`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const pump = (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          state.text += decoder.decode(value, { stream: true });
        }
      } catch {
        /* aborted */
      }
      state.closed = true;
    })();
    return pump;
  })();
  return { state, ready, abort: () => controller.abort() };
}

async function until(check: () => boolean, ms = 5_000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

const principalsFile = () => JSON.parse(readFileSync(join(data, "principals.json"), "utf8")) as { principals: { id: string; email?: string; local?: boolean }[] };

posixOnly("org identity", () => {
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-org-identity-"));
    data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({ profile: { name: "JC", email: "jc@gox.ca" }, signIn: { admins: [], members: [ZARA] } }));
    // Zara signed in with her email (as a portal or an older build would
    // issue it): the server gives her session her principal.
    const registry = new SessionRegistry({ file: join(data, "sessions.json"), emailScopes: () => ["client"] });
    zaraToken = registry.issue({ label: "Zara's laptop", email: ZARA, scopes: ["client"] }).token;
    registry.close();
    await start();
  }, 40_000);

  afterAll(async () => {
    await stop();
    await removeTempDir(home);
  });

  let ownerId = "";
  let kioskToken = "";
  let kioskStream: ReturnType<typeof openStream> | undefined;

  it("lets a chat-only device see the operator's bot while no organization exists", async () => {
    const bot = await api("POST", "/api/bots", { name: "Personal" });
    expect(bot.status).toBe(201);
    const pairing = await api("POST", "/api/auth/pairing", { label: "Kiosk", scopes: ["client"] });
    const paired = await api("POST", "/api/auth/pair", { code: pairing.body.code });
    expect(paired.status).toBe(200);
    kioskToken = paired.body.token;
    const seen = await api("GET", "/api/bots", undefined, kioskToken);
    expect(seen.status).toBe(200);
    expect(seen.body.bots.map((b: any) => b.id)).toContain(bot.body.bot.id);
    // It sees the bot but does not own it: a grant is refused before the
    // grantee is resolved, so a huge email creates no principal.
    const before = principalsFile().principals;
    const refused = await api("POST", `/api/bots/${bot.body.bot.id}/direct-grants`, { userId: `${"a".repeat(400)}@example.test` }, kioskToken);
    expect(refused).toEqual({ status: 403, body: { error: "not-owner" } });
    const plain = await api("POST", `/api/bots/${bot.body.bot.id}/direct-grants`, { userId: "stranger@example.test" }, kioskToken);
    expect(plain).toEqual({ status: 403, body: { error: "not-owner" } });
    expect(principalsFile().principals).toEqual(before);
    // Its live stream opens now, unfiltered, before any organization.
    kioskStream = openStream(kioskToken);
    expect(await until(() => kioskStream!.state.text.includes('"kind":"hello"'))).toBe(true);
    expect(kioskStream.state.closed).toBe(false);
  });

  it("refuses an organization without a server address", async () => {
    const res = await api("POST", "/api/org", { name: "GOX", host: { kind: "this-computer" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/server address/);
  });

  it("makes the local operator's principal the owner", async () => {
    const res = await api("POST", "/api/org", { name: "GOX", host: { kind: "server", url: "https://pulsa.gox.ca" } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    ownerId = res.body.org.ownerUserId;
    expect(ownerId).toMatch(/^pr_/);
    const local = principalsFile().principals.filter((p) => p.local);
    expect(local).toEqual([expect.objectContaining({ id: ownerId, email: "jc@gox.ca" })]);
  });

  it("ends the principal-less stream opened before the organization, so it reconnects filtered", async () => {
    expect(await until(() => kioskStream!.state.closed)).toBe(true);
    const bot = await api("POST", "/api/bots", { name: "Hidden" });
    const room = await api("POST", "/api/groups", { name: "After org", memberIds: [bot.body.bot.id], humanIds: [ZARA] });
    expect(room.status, JSON.stringify(room.body)).toBeLessThan(300);
    await new Promise((r) => setTimeout(r, 300));
    expect(kioskStream!.state.text).not.toContain(room.body.group.id);
    // A new stream from the same device is filtered: the channel frame never reaches it.
    const again = openStream(kioskToken);
    expect(await until(() => again.state.text.includes('"kind":"hello"'))).toBe(true);
    await api("PATCH", `/api/groups/${room.body.group.id}`, { name: "After org, renamed" });
    await new Promise((r) => setTimeout(r, 300));
    expect(again.state.text).not.toContain(room.body.group.id);
    again.abort();
  });

  it("refuses a chat-only device's direct grant before it creates any principal", async () => {
    const before = principalsFile().principals;
    const bot = await api("POST", "/api/bots", { name: "Owned" });
    expect(bot.status).toBe(201);
    const huge = `${"a".repeat(400)}@example.test`;
    const refused = await api("POST", `/api/bots/${bot.body.bot.id}/direct-grants`, { userId: huge }, kioskToken);
    // Once an organization exists the bot is out of its sight altogether.
    expect([403, 404]).toContain(refused.status);
    const other = await api("POST", `/api/bots/${bot.body.bot.id}/direct-grants`, { userId: "new-person@example.test" }, kioskToken);
    expect([403, 404]).toContain(other.status);
    expect(principalsFile().principals).toEqual(before);
    // Even the owner cannot grant a ref that is not an account email.
    const bad = await api("POST", `/api/bots/${bot.body.bot.id}/direct-grants`, { userId: huge });
    expect(bad.status).toBe(400);
    expect(principalsFile().principals).toEqual(before);
  });

  it("pairs a phone from this computer as the same person", async () => {
    const pairing = await api("POST", "/api/auth/pairing", { label: "JC's phone", scopes: ["admin", "client"] });
    expect(pairing.status, JSON.stringify(pairing.body)).toBe(200);
    const paired = await api("POST", "/api/auth/pair", { code: pairing.body.code });
    expect(paired.status, JSON.stringify(paired.body)).toBe(200);
    const token = paired.body.token as string;
    const org = await api("GET", "/api/org", undefined, token);
    expect(org.status).toBe(200);
    expect(org.body.people).toEqual([{ id: ownerId, role: "owner" }, { id: ZARA, role: "member" }]);
    const listed = await api("GET", "/api/auth/sessions", undefined, token);
    expect(listed.status).toBe(200);
    const mine = listed.body.sessions.find((session: any) => session.id === listed.body.current);
    expect(mine?.principalId).toBe(ownerId);
  });

  let botId = "";
  let channelId = "";

  it("lets a member added to a channel by email see it from her own session", async () => {
    const bot = await api("POST", "/api/bots", { name: "Ops" });
    expect(bot.status, JSON.stringify(bot.body)).toBe(201);
    botId = bot.body.bot.id;
    const created = await api("POST", "/api/groups", { name: "Ops room", memberIds: [botId], humanIds: ["Zara@Example.test"] });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    channelId = created.body.group.id;
    const zara = principalsFile().principals.find((p) => p.email === ZARA)!;
    expect(zara.id).toMatch(/^pr_/);
    expect(created.body.group.humanIds).toEqual([zara.id]);
    const seen = await api("GET", "/api/bots", undefined, zaraToken);
    expect(seen.status).toBe(200);
    expect(seen.body.groups.map((g: any) => g.id)).toContain(channelId);
  });

  it("lets a person granted a bot by email see it in her Direct view", async () => {
    const bot = await api("POST", "/api/bots", { name: "Solo" });
    expect(bot.status).toBe(201);
    const soloId = bot.body.bot.id as string;
    expect((await api("GET", "/api/bots", undefined, zaraToken)).body.bots.map((b: any) => b.id)).not.toContain(soloId);
    const granted = await api("POST", `/api/bots/${soloId}/direct-grants`, { userId: ZARA.toUpperCase() });
    expect(granted.status, JSON.stringify(granted.body)).toBe(200);
    const zara = principalsFile().principals.find((p) => p.email === ZARA)!;
    expect(granted.body.directGrants).toEqual([zara.id]);
    expect((await api("GET", "/api/bots", undefined, zaraToken)).body.bots.map((b: any) => b.id)).toContain(soloId);
  });

  const pairAs = async (scopes: string[]) => {
    const pairing = await api("POST", "/api/auth/pairing", { label: "Device", scopes });
    expect(pairing.status).toBe(200);
    const paired = await api("POST", "/api/auth/pair", { code: pairing.body.code });
    expect(paired.status).toBe(200);
    return paired.body.token as string;
  };

  it("pairs a chat-only code from this computer as nobody: no org channel, no owner approvals", async () => {
    const token = await pairAs(["client"]);
    const listed = await api("GET", "/api/auth/sessions", undefined, await pairAs(["admin", "client"]));
    const kiosk = listed.body.sessions.find((session: any) => session.label === "Device" && !session.principalId);
    expect(kiosk).toBeTruthy();
    const seen = await api("GET", "/api/bots", undefined, token);
    expect(seen.status).toBe(200);
    expect(seen.body.groups.map((g: any) => g.id)).not.toContain(channelId);
    expect(seen.body.bots.map((b: any) => b.id)).not.toContain(botId);
    // The owner's bot is out of its reach, approvals included.
    const answer = await api("POST", `/api/bots/${botId}/respond`, { requestId: "r1", behavior: "allow" }, token);
    expect([403, 404]).toContain(answer.status);
  });

  it("pairs an admin code from this computer as the operator, who sees every channel", async () => {
    const token = await pairAs(["admin", "client"]);
    const seen = await api("GET", "/api/bots", undefined, token);
    expect(seen.body.groups.map((g: any) => g.id)).toContain(channelId);
    expect(seen.body.bots.map((b: any) => b.id)).toContain(botId);
  });

  it("keeps one local operator and the same owner across a restart", async () => {
    await stop();
    // A bad entry (an oversized email, as an older build could write) is
    // skipped on load; it does not wipe the file or change the operator.
    const file = JSON.parse(readFileSync(join(data, "principals.json"), "utf8"));
    file.principals.push({ id: "pr_00000000-0000-4000-8000-0000000000ff", kind: "human", email: `${"a".repeat(400)}@example.test`, createdAt: 1 });
    writeFileSync(join(data, "principals.json"), JSON.stringify(file));
    await start();
    const local = principalsFile().principals.filter((p) => p.local);
    expect(local).toHaveLength(1);
    expect(local[0]!.id).toBe(ownerId);
    const org = await api("GET", "/api/org");
    expect(org.status).toBe(200);
    expect(org.body.org.ownerUserId).toBe(ownerId);
    const config = JSON.parse(readFileSync(join(data, "config.json"), "utf8"));
    expect(config.org.ownerUserId).toBe(ownerId);
    expect(typeof config.identityMigratedAt).toBe("number");
  }, 40_000);
});

// A separate boot: this server mails its own sign-in codes (server/mailer.ts,
// server/mail-config.ts) rather than going through the control plane. This
// harness spawns the server as a child process, so fetch cannot be stubbed;
// OMB_MAIL_CAPTURE_FILE (server/index.ts, where `mailer()` is built) is the
// test seam instead: the mailer appends each message as a JSON line to a
// file rather than sending it.
posixOnly("server-issued email sign-in", () => {
  it("mails a code with the capture-file seam, verifies it, and signs in as the local operator", async () => {
    const home2 = mkdtempSync(join(tmpdir(), "omb-email-signin-"));
    const data2 = join(home2, ".openmausbot");
    mkdirSync(data2, { recursive: true });
    writeFileSync(join(data2, "config.json"), JSON.stringify({ profile: { name: "JC", email: "jc@gox.ca" } }));
    const captureFile = join(home2, "mail-capture.jsonl");
    const port = 28800 + Math.floor(Math.random() * 10_000);
    const base = `http://127.0.0.1:${port}`;
    let log2 = "";
    const child2 = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: home2, USERPROFILE: home2, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1),
        OMB_MAIL_PROVIDER: "sendgrid", OMB_MAIL_FROM: "bot@gox.ca", OMB_SENDGRID_API_KEY: "test-key",
        OMB_SIGNIN_EMAILS: "jc@gox.ca", OMB_MAIL_CAPTURE_FILE: captureFile, OMB_TEST_SEAMS: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child2.stdout!.on("data", (c) => (log2 += c));
    child2.stderr!.on("data", (c) => (log2 += c));
    try {
      const deadline = Date.now() + 20_000;
      for (;;) {
        try {
          if ((await fetch(`${base}/api/health`)).ok) break;
        } catch {
          /* not up yet */
        }
        if (Date.now() > deadline) throw new Error(`server never came up:\n${log2}`);
        await new Promise((r) => setTimeout(r, 150));
      }
      const started = await fetch(`${base}/api/auth/email/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "jc@gox.ca" }),
      });
      expect(started.status).toBe(200);
      const captured = await until(() => {
        try {
          return readFileSync(captureFile, "utf8").trim().length > 0;
        } catch {
          return false;
        }
      });
      expect(captured).toBe(true);
      const lines = readFileSync(captureFile, "utf8").trim().split("\n");
      const message = JSON.parse(lines[lines.length - 1]!) as { to: string; subject: string; text: string };
      expect(message.to).toBe("jc@gox.ca");
      const match = /Your code is (\d{8})/.exec(message.text);
      expect(match).toBeTruthy();
      const verified = await fetch(`${base}/api/auth/email/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "jc@gox.ca", code: match![1] }),
      });
      const verifiedBody = (await verified.json()) as { session: { principalId?: string } };
      expect(verified.status, JSON.stringify(verifiedBody)).toBe(200);
      const principals2 = JSON.parse(readFileSync(join(data2, "principals.json"), "utf8")) as {
        principals: { id: string; local?: boolean; email?: string }[];
      };
      const local = principals2.principals.find((p) => p.local);
      expect(local).toBeTruthy();
      expect(verifiedBody.session.principalId).toBe(local!.id);
    } finally {
      await waitForExit(child2, { signal: "SIGTERM" });
      await removeTempDir(home2);
    }
  }, 40_000);
});
