// A call's engine stays warm (docs/voice-mode-xai.md, "Latency"), end to
// end through the real server and the fake Claude CLI: every turn of a live
// call goes to the one process the call's first turn started, so no turn
// after the first pays the engine's cold start; the per-turn comms token
// reaches that process through its token file, so its tools keep working;
// a written turn outside a call still gets a process of its own; and the
// server logs each call turn's stages under the utterance id.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";

const CALL_ID = "call-0123456789";

async function fixture() {
  const server = await launchVerificationServer();
  const { url, dataDir, logPath } = server.info;
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const launches = join(dataDir, "launches.jsonl");
  const wrapper = join(dataDir, "call-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { appendFileSync } from "node:fs";',
    // one line per turn process (not the version and sign-in probes)
    `if (process.argv.includes("--input-format")) appendFileSync(${JSON.stringify(launches)}, JSON.stringify({ pid: process.pid }) + "\\n");`,
    // each turn lists the bot's teammates through the agents proxy
    `process.env.FAKE_CLAUDE_MCP_CALLS = ${JSON.stringify(JSON.stringify([{ server: "agents", tool: "list_bots", arguments: {} }]))};`,
    'process.stdin.on("end", () => process.exit(0));',
    `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("./testing/fake-claude-cli.ts", import.meta.url))).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli: wrapper });
  const bot = (await api("POST", "/api/bots", { name: "Cryptic" }, 201)).bot;
  const thread = bot.threadId as string;
  const messages = async () => (await api("GET", `/api/threads/${thread}/messages?limit=200`)).messages as any[];
  const replies = async () => (await messages()).filter((m) => m.role === "bot" && m.turnTerminal);
  const send = (body: Record<string, unknown>) => api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, ...body }, 202);
  const processes = () => (existsSync(launches) ? readFileSync(launches, "utf8").trim().split("\n").filter(Boolean).length : 0);
  const log = () => readFileSync(logPath, "utf8");
  return { server, api, bot, thread, replies, send, processes, log };
}

it("keeps one engine process for a whole call, its tools working on every turn", async () => {
  const t = await fixture();
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    for (let turn = 1; turn <= 3; turn++) {
      await t.send({ text: `question ${turn}`, sendId: `send-${turn}-000000000${turn}`, voiceCall: { callId: CALL_ID, utteranceId: `utt-000000${turn}` } });
      await expect.poll(async () => (await t.replies()).length, { timeout: 15_000 }).toBe(turn);
    }
    // one cold start for the call; the later turns found the process warm
    expect(t.processes()).toBe(1);
    // the second and third turns' tools ran with their own (current) token
    const texts = (await t.replies()).map((m) => String(m.text));
    expect(texts).toHaveLength(3);
    for (const text of texts) expect(text).toContain("mcp:list_bots:ok");
    // the server's stages of each call turn, under its utterance id
    await expect.poll(() => (t.log().match(/\[voice-latency\] utt=utt-0000003 .*\(warm\)/) ? true : false), { timeout: 5_000 }).toBe(true);
    expect(t.log()).toMatch(/\[voice-latency\] utt=utt-0000001 .*\(cold start\)/);
    expect(t.log()).not.toMatch(/relaunch: spawn contract changed/);

    // hung up: a written turn is not a call turn, and gets its own process
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "end" });
    await t.send({ text: "in writing now" });
    await expect.poll(async () => (await t.replies()).length, { timeout: 15_000 }).toBe(4);
    expect(t.processes()).toBe(2);
  } finally {
    await t.server.close();
  }
}, 120_000);
