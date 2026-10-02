// A voice call's reliability, end to end through the real server and the
// fake Claude CLI (docs/voice-mode-xai.md, "A live call, like a phone"):
// every turn said or typed while the call lasts reaches the engine marked
// as said on the call, an utterance steered into a running turn is never
// handed back later as a message "you may already have", and a call turn
// is never left without an answer.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";
import { VOICE_CALL_TURN_MARK } from "./voice-call-prompt.ts";

const CALL_ID = "call-0123456789";

async function callFixture(env: Record<string, string> = {}) {
  const fixture = await launchVerificationServer();
  const { url, dataDir } = fixture.info;
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(status);
    return result;
  };
  const receivedPath = join(dataDir, "received.jsonl");
  const gates = join(dataDir, "gates");
  mkdirSync(gates, { recursive: true });
  const prompts = (): string[] => existsSync(receivedPath)
    ? readFileSync(receivedPath, "utf8").trim().split("\n").filter(Boolean).map((line) => {
      const parsed = JSON.parse(line);
      const content = parsed?.message?.content;
      return typeof content === "string" ? content : JSON.stringify(content);
    })
    : [];
  const wrapper = join(dataDir, "call-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    'import { join } from "node:path";',
    `const home = ${JSON.stringify(dataDir)};`,
    'process.env.FAKE_CLAUDE_PROMPTS = join(home, "received.jsonl");',
    `process.env.FAKE_CLAUDE_GATE_DIR = ${JSON.stringify(gates)};`,
    ...Object.entries(env).map(([key, value]) => `process.env[${JSON.stringify(key)}] = ${JSON.stringify(value)};`),
    'process.stdin.on("end", () => process.exit(0));',
    `await import(${JSON.stringify(pathToFileURL(fileURLToPath(new URL("./testing/fake-claude-cli.ts", import.meta.url))).href)});`,
  ].join("\n"), { mode: 0o700 });
  await api("PATCH", "/api/instances/claude", { cli: wrapper });
  const bot = (await api("POST", "/api/bots", { name: "Cryptic" }, 201)).bot;
  const thread = bot.threadId as string;
  const messages = async () => (await api("GET", `/api/threads/${thread}/messages?limit=200`)).messages as any[];
  const busy = async () => Boolean((await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id)?.busy);
  const send = (body: Record<string, unknown>, status = 202) => api("POST", `/api/bots/${bot.id}/messages`, { threadId: thread, ...body }, status);
  const open = (name: string) => writeFileSync(join(gates, name), "open");
  return { fixture, api, bot, thread, messages, busy, send, prompts, open };
}

it("marks every turn of a live call, typed or said, on every path", async () => {
  const t = await callFixture();
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start", language: "fr" });
    const replies = async () => (await t.messages()).filter((m) => m.role === "bot" && m.turnTerminal).length;
    // said on the call
    await t.send({ text: "what is the weather", voiceCall: { callId: CALL_ID } });
    await expect.poll(replies, { timeout: 15_000 }).toBe(1);
    // typed into the composer while the call runs: no mark from the page
    await t.send({ text: "and tomorrow" });
    await expect.poll(replies, { timeout: 15_000 }).toBe(2);
    // a third call turn on the same live session still says it is spoken
    await t.send({ text: "thanks", voiceCall: { callId: CALL_ID } });
    await expect.poll(replies, { timeout: 15_000 }).toBe(3);
    const sent = t.prompts();
    expect(sent).toHaveLength(3);
    for (const prompt of sent) expect(prompt).toContain(VOICE_CALL_TURN_MARK);
    const users = (await t.messages()).filter((m) => m.role === "user");
    expect(users.map((m) => m.voiceCall?.callId)).toEqual([CALL_ID, CALL_ID, CALL_ID]);
    // the stored words never hold the mark
    for (const message of users) expect(message.text).not.toContain(VOICE_CALL_TURN_MARK);

    // hung up: back to writing
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "end" });
    await t.send({ text: "in writing now" });
    await expect.poll(replies, { timeout: 15_000 }).toBe(4);
    expect(t.prompts().at(-1)).not.toContain(VOICE_CALL_TURN_MARK);
    expect((await t.messages()).filter((m) => m.role === "user").at(-1)?.voiceCall).toBeUndefined();
  } finally {
    await t.fixture.close();
  }
}, 120_000);

it("delivers words said while the bot works once: steered in, never handed back as maybe seen", async () => {
  const t = await callFixture({ FAKE_CLAUDE_MODE: "slow" });
  try {
    await t.api("POST", `/api/bots/${t.bot.id}/voice/call`, { threadId: t.thread, callId: CALL_ID, state: "start" });
    const replies = async () => (await t.messages()).filter((m) => m.role === "bot" && m.turnTerminal).length;
    await t.send({ text: "[gate:one] take a good memory of when we are talking", sendId: "send-one-0000000001", voiceCall: { callId: CALL_ID, utteranceId: "utt-00000001" } });
    await expect.poll(t.busy, { timeout: 15_000 }).toBe(true);
    // said while the bot works: joins its turn
    const steered = await t.send({ text: "give me a good prompt", sendId: "send-two-0000000002", voiceCall: { callId: CALL_ID, utteranceId: "utt-00000002" } });
    expect(steered.steered).toBe(true);
    // the same utterance again (a retry with a new send id): the first receipt
    const again = await t.send({ text: "give me a good prompt", sendId: "send-two-retry-00000003", voiceCall: { callId: CALL_ID, utteranceId: "utt-00000002" } });
    expect(again.message?.id).toBe(steered.message.id);
    t.open("one");
    await expect.poll(replies, { timeout: 15_000 }).toBe(1);
    await expect.poll(t.busy, { timeout: 15_000 }).toBe(false);
    t.open("two");
    await t.send({ text: "[gate:two] and now", voiceCall: { callId: CALL_ID, utteranceId: "utt-00000003" } });
    await expect.poll(replies, { timeout: 15_000 }).toBe(2);
    const sent = t.prompts();
    // the steer went into the first turn (its reply took it in); the next
    // turn never gets it again
    const first = (await t.messages()).find((m) => m.role === "bot" && m.kind === "text" && String(m.text).startsWith("reply to:"));
    expect(first?.text).toContain("steered:");
    expect(first?.text).toContain("give me a good prompt");
    expect(sent).toHaveLength(2);
    expect(sent[1]).not.toContain("give me a good prompt");
    expect(sent[1]).not.toContain("you may already have it");
    const users = (await t.messages()).filter((m) => m.role === "user");
    expect(users.filter((m) => m.text === "give me a good prompt")).toHaveLength(1);
  } finally {
    await t.fixture.close();
  }
}, 120_000);
