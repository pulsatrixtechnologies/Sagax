// The agent-to-agent API end to end against the real harness server: bot A
// sends a prompt to bot B with send_prompt (async), waits with await_turn,
// reads B's latest page, and the guarantees around it hold (hidden thread,
// isolation, one hop, audit without text).
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const TEST_CAPABILITY_KEY = "agent-api-fixture-capability-key-0001";

let child: ChildProcess;
let home = "";
let data = "";
let base = "";
let stderr = "";

const api = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-agent-api-"));
  data = join(home, ".sagax");
  const staticDir = join(home, "static");
  mkdirSync(data, { recursive: true });
  mkdirSync(staticDir, { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>agent API test</title>");
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: {
      plain: { driver: "claudeAgent", displayName: "Plain fixture", environment: { FAKE_CLAUDE_MODE: "happy", FAKE_CLAUDE_DUMP: join(home, "turn-dump.json") }, config: { cli: FAKE_CLAUDE } },
    },
  }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      HOME: home,
      USERPROFILE: home,
      SAGAX_PORT: String(port),
      SAGAX_WEBHOOK_PORT: String(port + 1),
      SAGAX_STATIC_DIR: staticDir,
      SAGAX_TEST_INTERNAL_CAPABILITY_KEY: TEST_CAPABILITY_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (chunk) => (stderr += chunk));
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) break;
    } catch {
      // still starting
    }
    if (Date.now() >= deadline) throw new Error(`server never became healthy: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 30_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

const createBot = async (name: string, description: string) =>
  (await api("POST", "/api/bots", { name, description, modelSelection: { instanceId: "plain", model: "claude-sonnet-5" }, requireAvailableModel: true })).body.bot;

const botState = async (botId: string) => (await api("GET", "/api/bots")).body.bots.find((bot: { id: string }) => bot.id === botId);

const mint = async (botId: string, threadId: string, depth = 0): Promise<string> => {
  const minted = await api("POST", "/api/testing/internal-capability", { botId, threadId, kind: "agents", depth }, { "x-openmausbot-test-capability": TEST_CAPABILITY_KEY });
  expect(minted.status).toBe(201);
  return String(minted.body.token);
};

const tool = (token: string, name: string, args: unknown) =>
  api("POST", `/api/internal/agent-api/${name}`, args, { authorization: `Bearer ${token}` });

describe("agent-to-agent API (real server)", () => {
  it("A sends async to B, awaits the turn, reads B's latest page; B's thread is hidden", async () => {
    const seeded = (await api("GET", "/api/bots?messages=0")).body.bots[0];
    await api("PATCH", `/api/bots/${seeded.id}`, { hidden: true });
    const alpha = await createBot("Alpha", "Coordinates the team");
    const beta = await createBot("Beta Dispatch", "Schedules technicians");
    const outsider = await createBot("Outsider", "Another team");
    expect((await api("PATCH", `/api/bots/${outsider.id}`, { section: "Elsewhere" })).status).toBe(200);
    expect((await api("POST", `/api/bots/${alpha.id}/messages`, { text: "Warm up" })).status).toBe(202);
    await expect.poll(async () => (await botState(alpha.id))?.busy, { timeout: 15_000 }).toBe(false);
    // the real harness mounts the tools in an ordinary direct chat (production
    // 2026-10-12: the room-coordination flag had kept them off everywhere)
    const dump = JSON.parse(readFileSync(join(home, "turn-dump.json"), "utf8"));
    expect(dump.mcpConfig?.mcpServers?.agents?.env?.SAGAX_AGENT_API).toBe("1");
    const token = await mint(alpha.id, alpha.threadId);

    const listed = await tool(token, "list_agents", {});
    expect(listed.status).toBe(200);
    const ids = listed.body.agents.map((agent: { id: string }) => agent.id);
    expect(ids).toContain(beta.id);
    expect(ids).not.toContain(alpha.id);
    expect(ids).not.toContain(outsider.id);
    expect(listed.body.agents.find((agent: { id: string }) => agent.id === beta.id)).toMatchObject({ name: "Beta Dispatch", status: "idle" });

    const found = await tool(token, "find_agents", { query: "dispatch", status: "idle" });
    expect(found.body.agents.map((agent: { id: string }) => agent.id)).toEqual([beta.id]);

    const sent = await tool(token, "send_prompt", { agent_id: beta.id, prompt: "Please confirm the Monday schedule", mode: "async" });
    expect(sent.status).toBe(200);
    expect(sent.body).toMatchObject({ accepted: true, mode: "async", agent_id: beta.id });
    const handle = String(sent.body.handle);
    const threadId = String(sent.body.thread_id);

    const awaited = await tool(token, "await_turn", { agent_id: beta.id, handle, timeout_ms: 30_000 });
    expect(awaited.status).toBe(200);
    expect(awaited.body.finished).toBe(true);
    expect(typeof awaited.body.reply).toBe("string");

    // async notifies at turn end: B's reply is posted in A's conversation and
    // A is woken (a new turn there ends the old capability), so mint again.
    await expect.poll(async () => JSON.stringify((await botState(alpha.id))?.messages ?? []), { timeout: 15_000 }).toContain("send_prompt");
    await expect.poll(async () => (await botState(alpha.id))?.busy, { timeout: 15_000 }).toBe(false);
    const fresh = await mint(alpha.id, alpha.threadId);
    const latest = await tool(fresh, "read_latest_page", { agent_id: beta.id, limit: 10 });
    expect(latest.status).toBe(200);
    const texts = latest.body.entries.map((entry: { role: string; text: string }) => `${entry.role}:${entry.text}`);
    expect(texts[0]).toBe("user:Please confirm the Monday schedule");
    expect(latest.body.entries.every((entry: { thread_id: string }) => entry.thread_id === threadId)).toBe(true);
    if (awaited.body.reply) expect(texts).toContain(`agent:${awaited.body.reply}`);

    const withThreads = await tool(fresh, "read_latest_page_with_threads", { agent_id: beta.id, limit: 1 });
    expect(withThreads.body.threads).toEqual([expect.objectContaining({ thread_id: threadId, hidden: true, status: "idle" })]);
    const cold = await tool(fresh, "read_transcript_cold", { agent_id: beta.id });
    expect(cold.body.entries.length).toBe(latest.body.entries.length);

    // B's own chat with the person never saw it: the conversation is hidden.
    const betaNow = await botState(beta.id);
    expect(JSON.stringify(betaNow.messages ?? [])).not.toContain("Monday schedule");
    expect(betaNow.threadId).not.toBe(threadId);

    // isolation: another team's bot is unknown
    const refused = await tool(fresh, "send_prompt", { agent_id: outsider.id, prompt: "hi" });
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe("unknown_agent");

    // a non-Primary bot holds no create scope
    const create = await tool(fresh, "create_agent", { name: "Gamma" });
    expect(create.status).toBe(403);

    // one hop: a turn another agent started cannot prompt further (minting
    // a new capability for the thread retires the previous one)
    const deepToken = await mint(alpha.id, alpha.threadId, 1);
    const deep = await tool(deepToken, "send_prompt", { agent_id: beta.id, prompt: "pass it on" });
    expect(deep.status).toBe(409);
    expect(deep.body.code).toBe("too_deep");

    // every call audited, never the prompt text (the log is appended
    // asynchronously, so read it until the last calls landed)
    const dir = join(data, "admin-activity");
    const readRows = () => {
      try {
        return readdirSync(dir).flatMap((file) => readFileSync(join(dir, file), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)))
          .filter((row) => String(row.action).startsWith("agents."));
      } catch {
        return [];
      }
    };
    const expected = ["agents.list_agents", "agents.find_agents", "agents.send_prompt", "agents.await_turn", "agents.read_latest_page", "agents.read_transcript_cold", "agents.create_agent"];
    await expect.poll(() => readRows().map((row) => row.action), { timeout: 15_000 }).toEqual(expect.arrayContaining(expected));
    const agentRows = readRows();
    expect(agentRows.find((row) => row.action === "agents.send_prompt" && row.after.outcome === "ok").after).toMatchObject({ mode: "async", callerBotId: alpha.id, threadId });
    expect(JSON.stringify(agentRows)).not.toContain("Monday schedule");
  }, 90_000);
});
