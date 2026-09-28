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

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const PORT = 28800 + Math.floor(Math.random() * 10_000);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");

let child: ChildProcess | undefined;
let home: string;
let data: string;
let log = "";

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

const principalsFile = () => JSON.parse(readFileSync(join(data, "principals.json"), "utf8")) as { principals: { id: string; email?: string; local?: boolean }[] };

posixOnly("org identity", () => {
  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-org-identity-"));
    data = join(home, ".openmausbot");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({ profile: { name: "JC", email: "jc@gox.ca" } }));
    await start();
  }, 40_000);

  afterAll(async () => {
    await stop();
    await removeTempDir(home);
  });

  let ownerId = "";

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

  it("pairs a phone from this computer as the same person", async () => {
    const pairing = await api("POST", "/api/auth/pairing", { label: "JC's phone", scopes: ["admin", "client"] });
    expect(pairing.status, JSON.stringify(pairing.body)).toBe(200);
    const paired = await api("POST", "/api/auth/pair", { code: pairing.body.code });
    expect(paired.status, JSON.stringify(paired.body)).toBe(200);
    const token = paired.body.token as string;
    const org = await api("GET", "/api/org", undefined, token);
    expect(org.status).toBe(200);
    expect(org.body.people).toEqual([{ id: ownerId, role: "owner" }]);
    const listed = await api("GET", "/api/auth/sessions", undefined, token);
    expect(listed.status).toBe(200);
    const mine = listed.body.sessions.find((session: any) => session.id === listed.body.current);
    expect(mine?.principalId).toBe(ownerId);
  });

  it("keeps one local operator and the same owner across a restart", async () => {
    await stop();
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
