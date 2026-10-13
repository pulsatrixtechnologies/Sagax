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
// Same report: the gate held agents__coordinate_bots for a card although the
// bot's "Ask me before contacting other bots" was off. Teammate tools are the
// bot's peer review's to decide (agent-tool-policy.ts), so the gate lets them
// through.
//
// The real server runs against the fake ACP CLI in "mcp-call" mode: every
// turn calls agents:coordinate_bots, then agents:workspace_write (a write the
// gate holds), through the mounted (gated) agents MCP.
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
const PORT = await freePortBlock([0, 1]);
const BASE = `http://127.0.0.1:${PORT}`;
const posixOnly = describe.skipIf(process.platform === "win32");
const ALLOW_KEY = "mcp:agents__workspace_write";
const HELD = "agents:workspace_write ->";

let child: ChildProcess;
let home: string;
let log = "";

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), origin: BASE },
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
/** The bot's reply once the turn ran: one line per MCP call. */
const replyWith = (threadId: string, text: string) => waitFor(async () =>
  (await messages(threadId)).find((m) => m.role === "bot" && typeof m.text === "string" && m.text.includes(text)) ?? null);
const botRow = async (id: string) =>
  ((await api("GET", "/api/bots?messages=0")).body.bots as any[]).find((bot) => bot.id === id);

async function send(botId: string, threadId: string, text: string) {
  const sent = await api("POST", `/api/bots/${botId}/messages`, { text, threadId });
  expect(sent.status, JSON.stringify(sent.body)).toBe(202);
}

posixOnly("Always allow on a gated MCP call is a rule of the bot", () => {
  beforeAll(async () => {
    chmodSync(FAKE_CLI, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-gate-allow-rule-"));
    const data = join(home, ".sagax");
    mkdirSync(data, { recursive: true });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      instances: { grok: { driver: "grokAgent", environment: { FAKE_ACP_MODE: "mcp-call", FAKE_ACP_MCP_CALLS: "agents:coordinate_bots,agents:workspace_write" }, config: { cli: FAKE_CLI, fullAuto: false } } },
    }));
    writeFileSync(join(data, "grok-approval-gate.json"), JSON.stringify({ bots: "all" }));
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: {
        ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "",
        SAGAX_PORT: String(PORT), SAGAX_WEBHOOK_PORT: String(PORT + 1),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout!.on("data", (c) => (log += c));
    child.stderr!.on("data", (c) => (log += c));
    const up = await waitFor(async () => { try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; } }, 20_000);
    if (!up) throw new Error(`server never came up:\n${log}`);
  }, 40_000);

  afterAll(async () => {
    await waitForExit(child, { signal: "SIGTERM" });
    await removeTempDir(home);
  });

  it("shows the rule in the bot's Always allowed, stops asking in every conversation, and asks again once removed", async () => {
    const created = await api("POST", "/api/bots", { name: "Cryptic" });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const bot = created.body.bot as { id: string; threadId: string };
    const patched = await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grok", model: "fake-model" }, approvalMode: "auto", computer: "off" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);

    // 1. The gate holds the write for a card; coordinate_bots went through
    //    (the bot does not ask before contacting other bots).
    await send(bot.id, bot.threadId, "ping the team");
    const card = await openCard(bot.threadId);
    expect(card, `no approval card appeared:\n${log.slice(-2_000)}`).not.toBeNull();
    expect(card.card).toMatchObject({ mcpTool: "agents__workspace_write", allowKey: ALLOW_KEY });

    // 2. Always allow, the way the app answers it: save the rule, then allow.
    const saved = await api("POST", `/api/bots/${bot.id}/always-allow`, { threadId: bot.threadId, allowKey: ALLOW_KEY });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const allowed = await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: card.card.requestId, behavior: "allow", always: true });
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    const first = await replyWith(bot.threadId, HELD);
    expect(first?.text).toContain("agents:coordinate_bots ->");
    expect(first?.text).not.toContain("Not approved");
    const settled = (await messages(bot.threadId)).find((m) => m.card?.requestId === card.card.requestId);
    expect(settled.card).toMatchObject({ answered: "allow", alwaysAllowed: ALLOW_KEY });

    // 3. The rule is the bot's: Access > Always allowed lists it.
    expect((await botRow(bot.id)).alwaysAllow).toContain(ALLOW_KEY);

    // 4. The next identical call asks no one, in this conversation...
    await send(bot.id, bot.threadId, "ping them again");
    expect(await waitFor(async () => (await messages(bot.threadId)).filter((m) => m.role === "bot" && m.text?.includes(HELD)).length >= 2 || null)).toBe(true);
    expect((await messages(bot.threadId)).filter((m) => m.card?.requestId)).toHaveLength(1);
    expect((await messages(bot.threadId)).some((m) => typeof m.text === "string" && m.text.includes("Not approved"))).toBe(false);

    // ...and in a conversation that already existed or a new one.
    const other = await api("POST", `/api/bots/${bot.id}/tasks`, { title: "Another conversation" });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    const otherThread = other.body.task.threadId as string;
    await send(bot.id, otherThread, "ping the team from here");
    expect(await replyWith(otherThread, HELD), log.slice(-2_000)).not.toBeNull();
    expect((await messages(otherThread)).filter((m) => m.card?.requestId)).toHaveLength(0);

    // 5. Removing the rule in Access > Always allowed makes it ask again,
    //    in the conversation where it was first given too.
    const removed = await api("PATCH", `/api/bots/${bot.id}`, { alwaysAllow: [] });
    expect(removed.status, JSON.stringify(removed.body)).toBe(200);
    await send(bot.id, bot.threadId, "and once more");
    const again = await openCard(bot.threadId);
    expect(again?.card).toMatchObject({ mcpTool: "agents__workspace_write" });
    expect(again.card.requestId).not.toBe(card.card.requestId);
    await api("POST", `/api/threads/${bot.threadId}/respond`, { requestId: again.card.requestId, behavior: "deny" });
  }, 120_000);
});
