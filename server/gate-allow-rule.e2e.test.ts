// "Always allow" on a Sagax approval-gate card (Grok in Approve for me, the
// gate on: server/drivers/acp/grok-approval-gate.ts) is a standing rule of the
// BOT: it shows in the bot's Access > Always allowed, it answers the next
// identical call in this conversation and in any other one, and removing it
// there makes the call ask again.
//
// Report (JC, 2026-10-13): the card said "Added to your Allow rules" and
// "Always allowed", but the bot's Always allowed list read "Nothing yet" and
// the same agents__coordinate_bots call asked again: the rule was saved on
// the one thread only.
//
// QA (2026-10-14): teammate tools (coordinate_bots, ask_bot, delegate_bot,
// send_to_bot, post_to_room) pass the Grok gate only while peer review is
// ACTIVE, so the server's own card decides them. With the revue off they
// wait at the gate (fail closed). Covered below.
//
// The real server runs against the fake ACP CLI in "mcp-call" mode: a turn
// calls the listed agents tools through the mounted (gated) agents MCP.
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLI = join(SERVER_DIR, "testing", "fake-acp-cli.ts");
const ALLOW_PORT = await freePortBlock([0, 1]);
const PEER_PORT = await freePortBlock([0, 1]);
const posixOnly = describe.skipIf(process.platform === "win32");
const ALLOW_KEY = "mcp:agents__workspace_write";
const HELD = "agents:workspace_write ->";
const CAPABILITY_KEY = "gate-allow-rule-fixture-capability";

async function startGatedGrok(opts: { port: number; mcpCalls: string }): Promise<{ child: ChildProcess; home: string; log: { text: string } }> {
  chmodSync(FAKE_CLI, 0o755);
  const home = mkdtempSync(join(tmpdir(), "omb-gate-allow-rule-"));
  const data = join(home, ".sagax");
  mkdirSync(data, { recursive: true });
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: { grok: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "mcp-call", FAKE_ACP_MCP_CALLS: opts.mcpCalls }, config: { cli: FAKE_CLI, fullAuto: false } } },
  }));
  writeFileSync(join(data, "grok-approval-gate.json"), JSON.stringify({ bots: "all" }));
  const log = { text: "" };
  const child = spawn(process.execPath, ["--experimental-strip-types", join(SERVER_DIR, "index.ts")], {
    cwd: join(SERVER_DIR, ".."),
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
      SAGAX_PORT: String(opts.port), SAGAX_WEBHOOK_PORT: String(opts.port + 1),
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: CAPABILITY_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log.text += c));
  child.stderr!.on("data", (c) => (log.text += c));
  const base = `http://127.0.0.1:${opts.port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${log.text}`);
    await new Promise((r) => setTimeout(r, 150));
  }
  return { child, home, log };
}

function client(port: number) {
  const base = `http://127.0.0.1:${port}`;
  const api = async (method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), origin: base, ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  async function waitFor<T>(read: () => Promise<T | null | undefined>, ms = 30_000): Promise<T | null> {
    const deadline = Date.now() + ms;
    for (;;) {
      const value = await read();
      if (value) return value;
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const messages = async (threadId: string): Promise<any[]> =>
    (await api("GET", `/api/threads/${threadId}/messages`)).body.messages ?? [];
  const openCard = (threadId: string, ms?: number) => waitFor(async () =>
    (await messages(threadId)).find((m) => m.card?.requestId && !m.card.answered && m.card.dismissed !== true) ?? null, ms);
  const replyWith = (threadId: string, text: string) => waitFor(async () =>
    (await messages(threadId)).find((m) => m.role === "bot" && typeof m.text === "string" && m.text.includes(text)) ?? null);
  const botRow = async (id: string) =>
    ((await api("GET", "/api/bots?messages=0")).body.bots as any[]).find((bot) => bot.id === id);
  async function send(botId: string, threadId: string, text: string) {
    const sent = await api("POST", `/api/bots/${botId}/messages`, { text, threadId });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
  }
  return { api, waitFor, messages, openCard, replyWith, botRow, send };
}

posixOnly("Always allow on a gated MCP call is a rule of the bot", () => {
  let child: ChildProcess | undefined;
  let home: string | undefined;
  let log = { text: "" };
  const { api, waitFor, messages, openCard, replyWith, botRow, send } = client(ALLOW_PORT);

  beforeAll(async () => {
    const started = await startGatedGrok({ port: ALLOW_PORT, mcpCalls: "agents:workspace_write" });
    child = started.child;
    home = started.home;
    log = started.log;
  }, 40_000);

  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    if (home) await removeTempDir(home);
  });

  it("shows the rule in the bot's Always allowed, stops asking in every conversation, and asks again once removed", async () => {
    const created = await api("POST", "/api/bots", { name: "Cryptic" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string };
    const patched = await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" }, approvalMode: "auto", computer: "off" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    await send(bot.id, bot.threadId, "write the file");
    const card = await openCard(bot.threadId);
    expect(card, `no approval card appeared:\n${log.text.slice(-2_000)}`).not.toBeNull();
    expect(card.card).toMatchObject({ mcpTool: "agents__workspace_write", allowKey: ALLOW_KEY });

    // A live turn token must not register Always allow as the owner (loopback
    // owner-trust otherwise treats a non-session Bearer as the operator).
    const minted = await fetch(`http://127.0.0.1:${ALLOW_PORT}/api/testing/internal-capability`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-openmausbot-test-capability": CAPABILITY_KEY, origin: `http://127.0.0.1:${ALLOW_PORT}` },
      body: JSON.stringify({ botId: bot.id, threadId: bot.threadId }),
    });
    expect(minted.status).toBe(201);
    const { token } = await minted.json() as { token: string };
    const selfApprove = await api("POST", `/api/bots/${bot.id}/always-allow`, { threadId: bot.threadId, allowKey: ALLOW_KEY }, { authorization: `Bearer ${token}` });
    expect(selfApprove.status, JSON.stringify(selfApprove.body)).toBe(403);
    expect(selfApprove.body.code).toBe("turn_cannot_self_approve");
    expect((await botRow(bot.id)).alwaysAllow ?? []).not.toContain(ALLOW_KEY);

    const saved = await api("POST", `/api/bots/${bot.id}/always-allow`, { threadId: bot.threadId, allowKey: ALLOW_KEY });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const allowed = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: card.card.requestId, behavior: "allow", always: true });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    const first = await replyWith(bot.threadId, HELD);
    expect(first?.text).toContain(HELD);
    expect(first?.text).not.toContain("Not approved");
    const settled = (await messages(bot.threadId)).find((m) => m.card?.requestId === card.card.requestId);
    expect(settled.card).toMatchObject({ answered: "allow", alwaysAllowed: ALLOW_KEY });

    expect((await botRow(bot.id)).alwaysAllow).toContain(ALLOW_KEY);

    await send(bot.id, bot.threadId, "write it again");
    expect(await waitFor(async () => (await messages(bot.threadId)).filter((m) => m.role === "bot" && m.text?.includes(HELD)).length >= 2 || null)).toBe(true);
    expect((await messages(bot.threadId)).filter((m) => m.card?.requestId)).toHaveLength(1);
    expect((await messages(bot.threadId)).some((m) => typeof m.text === "string" && m.text.includes("Not approved"))).toBe(false);

    const other = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Another conversation" });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    const otherThread = other.body.task.threadId as string;
    await send(bot.id, otherThread, "write from here");
    expect(await replyWith(otherThread, HELD), log.text.slice(-2_000)).not.toBeNull();
    expect((await messages(otherThread)).filter((m) => m.card?.requestId)).toHaveLength(0);

    const removed = await api("PATCH", `/api/bots/${bot.id}`, { alwaysAllow: [] });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    await send(bot.id, bot.threadId, "and once more");
    const again = await openCard(bot.threadId);
    expect(again?.card).toMatchObject({ mcpTool: "agents__workspace_write" });
    expect(again.card.requestId).not.toBe(card.card.requestId);
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: again.card.requestId, behavior: "deny" });
  }, 120_000);
});

posixOnly("revue off: a teammate call is held at the Grok gate", () => {
  let child: ChildProcess | undefined;
  let home: string | undefined;
  let log = { text: "" };
  const { api, openCard, send } = client(PEER_PORT);

  beforeAll(async () => {
    const started = await startGatedGrok({ port: PEER_PORT, mcpCalls: "agents:coordinate_bots" });
    child = started.child;
    home = started.home;
    log = started.log;
  }, 40_000);

  afterAll(async () => {
    if (child) await waitForExit(child, { signal: "SIGTERM" });
    if (home) await removeTempDir(home);
  });

  it("holds coordinate_bots when Ask me before contacting other bots is off", async () => {
    const created = await api("POST", "/api/bots", { name: "Cryptic" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string; approvePeerComms?: boolean };
    expect(bot.approvePeerComms ?? false).toBe(false);
    const patched = await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" }, approvalMode: "auto", computer: "off" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.bot.approvePeerComms ?? false).toBe(false);

    await send(bot.id, bot.threadId, "ping the team");
    const card = await openCard(bot.threadId);
    expect(card, `coordinate_bots ran unasked while peer review was off:\n${log.text.slice(-2_000)}`).not.toBeNull();
    expect(card.card).toMatchObject({ mcpTool: "agents__coordinate_bots" });
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: card.card.requestId, behavior: "deny" });
  }, 120_000);
});
