// Fresh topic on return (single stream, JC 2026-10-18) against the real
// server, the way both clients drive it: the shared rule
// (shared/fresh-topic.ts) reads the bot's live snapshot; coming back after
// the threshold lands on a fresh topic that the server creates only with its
// first message, whose turn still knows the earlier topic (digest); coming
// back while a turn runs stays in that topic.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { freshTopicAfterMs, freshTopicOnReturn, FRESH_TOPIC_AFTER_DEFAULT_HOURS } from "../shared/fresh-topic.ts";
import { removeTempDir } from "./testing/cleanup.ts";

type Json = { [key: string]: any };
const AFTER = freshTopicAfterMs(FRESH_TOPIC_AFTER_DEFAULT_HOURS);

it("comes back after 4 h to a fresh topic made with its first message; during a turn to the same topic", async () => {
  const gates = mkdtempSync(join(tmpdir(), "sagax-fresh-topic-"));
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_GATE_DIR: gates });
  const env = { SAGAX_URL: fixture.info.url };
  const api = async (method: string, path: string, body?: unknown, expected = [200, 201, 202]): Promise<Json> => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await response.json() as Json;
    expect(expected, JSON.stringify(result)).toContain(response.status);
    return result;
  };
  const snapshot = async (botId: string): Promise<Json> => (await api("GET", "/api/bots?messages=0")).bots.find((b: Json) => b.id === botId);
  // SAFETY: a WireTask always carries createdAt
  const taskOf = (bot: Json, threadId: string): Json & { createdAt: number } => bot.tasks.find((task: Json) => task.threadId === threadId);
  const segments = (bot: Json) => (bot.tasks as Json[]).filter((task) => !task.routineRunId && !task.hidden && !task.confidential);
  const prompt = () => {
    // SAFETY: the fake CLI writes exactly this shape
    const sent = JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")) as { systemPrompt?: string; prompt?: unknown };
    return `${sent.systemPrompt ?? ""}\n${JSON.stringify(sent.prompt ?? "")}`;
  };
  const settled = async (botId: string, threadId: string) =>
    expect((await runControlOmb(["wait", "--bot", botId, "--task", threadId, "--timeout", "30"], { env }) as Json).status).toBe("settled");
  try {
    // SAFETY: control-omb returns the created bot record under `bot`
    const { bot } = await runControlOmb(["new-bot", "--name", "Returner"], { env }) as { bot: { id: string; activeTaskId: string } };
    const first = bot.activeTaskId;
    await api("POST", `/api/bots/${bot.id}/messages`, { text: "Audit the September invoices for ACME-42.", threadId: first, singleStream: true });
    await settled(bot.id, first);
    // An answer nobody read yet keeps the person in its topic.
    const unread = taskOf(await snapshot(bot.id), first);
    expect(freshTopicOnReturn({ topic: unread, now: unread.updatedAt + AFTER + 1, afterMs: AFTER })).toEqual({ fresh: false, reason: "unread" });
    await api("POST", `/api/bots/${bot.id}/read`, { threadId: first });

    // Back 4 h later: the topic is quiet past the threshold, so a fresh one.
    let live = await snapshot(bot.id);
    const quiet = taskOf(live, first);
    expect(quiet.updatedAt).toBeGreaterThan(quiet.createdAt);
    expect(freshTopicOnReturn({ topic: quiet, now: quiet.updatedAt + AFTER + 1, afterMs: AFTER })).toEqual({ fresh: true, reason: "idle" });
    // Back sooner: the same topic.
    expect(freshTopicOnReturn({ topic: quiet, now: quiet.updatedAt + AFTER - 60_000, afterMs: AFTER }).fresh).toBe(false);
    // Landing creates nothing on the server: no empty topics pile up.
    const before = segments(live).length;
    expect(segments(await snapshot(bot.id))).toHaveLength(before);

    // The first message creates the topic, then goes there (what the
    // desktop store and the phone do).
    const created = await api("POST", `/api/bots/${bot.id}/tasks`, { stream: true });
    const second = created.task.threadId as string;
    expect(second).not.toBe(first);
    await api("POST", `/api/bots/${bot.id}/messages`, { text: "What did we settle earlier? [gate:hold]", threadId: second, singleStream: true });
    // The bot keeps the history: the earlier topic is in this turn's digest.
    await expect.poll(() => { try { return prompt(); } catch { return ""; } }, { timeout: 20_000 }).toContain("Earlier topics in this same conversation");
    expect(prompt()).toContain(`id ${first}`);
    live = await snapshot(bot.id);
    expect(segments(live)).toHaveLength(before + 1);

    // Coming back while that turn runs, even hours later: the same topic.
    await expect.poll(async () => taskOf(await snapshot(bot.id), second).busy, { timeout: 20_000 }).toBe(true);
    const running = taskOf(await snapshot(bot.id), second);
    expect(freshTopicOnReturn({ topic: running, now: Date.now() + 10 * AFTER, afterMs: AFTER, leftAt: Date.now() - 2 * AFTER })).toEqual({ fresh: false, reason: "live" });
    writeFileSync(join(gates, "hold"), "go");
    await settled(bot.id, second);
    // Once answered and read, the topic is at rest: a long absence is a return.
    await api("POST", `/api/bots/${bot.id}/read`, { threadId: second });
    const rested = taskOf(await snapshot(bot.id), second);
    expect(rested.busy).toBeFalsy();
    // left once it was answered, back 4 h later: a fresh topic
    expect(freshTopicOnReturn({ topic: rested, now: rested.updatedAt + AFTER + 2, afterMs: AFTER, leftAt: rested.updatedAt + 1 })).toEqual({ fresh: true, reason: "away" });
    // left before the answer came: the answer is shown first
    expect(freshTopicOnReturn({ topic: rested, now: rested.updatedAt + AFTER + 2, afterMs: AFTER, leftAt: rested.updatedAt - 1 })).toEqual({ fresh: false, reason: "unread" });
  } finally {
    await fixture.close();
    await removeTempDir(gates);
  }
}, 180_000);
