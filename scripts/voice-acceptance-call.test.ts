// Review 4: score a scripted real duplex call (issue #292). The scorer is
// pure. The live run (SAGAX_VOICE_ACCEPTANCE=1) drives real STT/LLM/TTS.
import { expect, it } from "vitest";

import { classifyVoiceIntent } from "../src/lib/voice-mode/voice-topics.ts";
import {
  ACCEPTANCE_SCRIPT,
  ACCEPTANCE_STOP_SCRIPT,
  acceptanceVoiceCall,
  matchAcceptanceLine,
  mergeAcceptanceScores,
  noteWarmTotal,
  scoreAcceptance,
  scoreAcceptanceCancel,
  scoreAcceptanceInterrupt,
  shouldPostAcceptanceUtterance,
  shouldSkipDuplicateAcceptance,
  acceptanceInjectWait,
  assignAcceptanceTurnIds,
  waitForAcceptanceSend,
  waitForAcceptanceSpeech,
  waitForAcceptanceDone,
  acceptanceBotSpeaking,
  stampAcceptanceMainThread,
  type AcceptanceEvent,
} from "./voice-acceptance-call.ts";

it("matches spoken lines to script ids, including stop and correction", () => {
  expect(matchAcceptanceLine("Please wait twenty seconds, then count to three")?.id).toBe("A");
  expect(matchAcceptanceLine("Please wait twelve seconds")?.id).toBe("A");
  expect(matchAcceptanceLine("Please wait 12 seconds")?.id).toBe("A");
  expect(matchAcceptanceLine("Count to two hundred please")?.id).toBe("A");
  expect(matchAcceptanceLine("Name the capital of Japan.")?.id).toBe("B");
  expect(matchAcceptanceLine("What time is it in Tokyo?")?.id).toBe("B");
  expect(matchAcceptanceLine("Rédige un court courriel de bonjour.")?.id).toBe("C");
  expect(matchAcceptanceLine("stop")?.id).toBe("stop");
  expect(matchAcceptanceLine("no, I meant Toronto")?.id).toBe("corr");
  expect(matchAcceptanceLine("Prépare aussi le rapport mensuel")?.id).toBe("lim");
  expect(matchAcceptanceLine("hey what time is it in Paris")?.id).toBe("barge");
  expect(classifyVoiceIntent("hey what time is it in Paris")).toBe("new_topic");
});

it("the script covers overlapping topics, barge-in, correction, stop, three parallel, EN and FR", () => {
  const ids = ACCEPTANCE_SCRIPT.map((row) => row.id);
  expect(ids).toEqual(expect.arrayContaining(["A", "B", "C", "D", "barge", "corr", "lim"]));
  expect(ACCEPTANCE_STOP_SCRIPT.map((row) => row.id)).toEqual(["A", "B", "stop"]);
  expect(ACCEPTANCE_SCRIPT.some((row) => row.lang === "fr")).toBe(true);
  expect(ACCEPTANCE_SCRIPT.some((row) => row.lang === "en")).toBe(true);
  const b = ACCEPTANCE_SCRIPT.find((row) => row.id === "B")!;
  const a = ACCEPTANCE_SCRIPT.find((row) => row.id === "A")!;
  expect(b.atMs).toBeGreaterThan(a.atMs);
  expect(b.atMs).toBeLessThan(10_000);
  const spaced = ["A", "B", "C", "D", "lim"] as const;
  for (let i = 1; i < spaced.length; i++) {
    const prev = ACCEPTANCE_SCRIPT.find((row) => row.id === spaced[i - 1])!;
    const next = ACCEPTANCE_SCRIPT.find((row) => row.id === spaced[i])!;
    expect(next.atMs - prev.atMs, `${spaced[i]} after ${spaced[i - 1]}`).toBeGreaterThanOrEqual(4_000);
  }
  const stopB = ACCEPTANCE_STOP_SCRIPT.find((row) => row.id === "B")!;
  expect(stopB.atMs).toBeGreaterThanOrEqual(8_000);
});

it("a continues first POST that forks still counts as a live fork", () => {
  const events: AcceptanceEvent[] = [
    { t: 0, kind: "send", id: "A", threadId: "main" },
    { t: 100, kind: "turn-started", id: "A", threadId: "main" },
    { t: 400, kind: "send", id: "B", threadId: "b", parallel: "running", continues: true },
    { t: 900, kind: "turn-completed", id: "B", threadId: "b" },
    { t: 2_000, kind: "turn-completed", id: "A", threadId: "main" },
  ];
  expect(scoreAcceptance(events).find((s) => s.scenario === "a")!.pass).toBe(true);
});

it("a) B while A is thinking: both complete and A is not cancelled", () => {
  const events: AcceptanceEvent[] = [
    { t: 0, kind: "send", id: "A", threadId: "main" },
    { t: 100, kind: "turn-started", id: "A", threadId: "main" },
    { t: 400, kind: "send", id: "B", threadId: "b", parallel: "running" },
    { t: 900, kind: "turn-completed", id: "B", threadId: "b" },
    { t: 2_000, kind: "turn-completed", id: "A", threadId: "main" },
  ];
  const row = scoreAcceptance(events).find((s) => s.scenario === "a")!;
  expect(row.pass).toBe(true);

  const cancelled: AcceptanceEvent[] = [
    { t: 0, kind: "send", id: "A", threadId: "main" },
    { t: 100, kind: "turn-started", id: "A", threadId: "main" },
    { t: 400, kind: "send", id: "B", threadId: "main" },
    { t: 410, kind: "cancelled", id: "A", threadId: "main" },
    { t: 900, kind: "turn-completed", id: "B", threadId: "main" },
  ];
  expect(scoreAcceptance(cancelled).find((s) => s.scenario === "a")!.pass).toBe(false);

  const sequential: AcceptanceEvent[] = [
    { t: 0, kind: "send", id: "A", threadId: "main" },
    { t: 100, kind: "turn-completed", id: "A", threadId: "main" },
    { t: 200, kind: "send", id: "B", threadId: "main" },
    { t: 300, kind: "turn-completed", id: "B", threadId: "main" },
  ];
  expect(scoreAcceptance(sequential).find((s) => s.scenario === "a")!.pass).toBe(false);

  const laterCancel: AcceptanceEvent[] = [
    ...events,
    { t: 5_000, kind: "cancelled", id: "A", threadId: "main" },
  ];
  expect(scoreAcceptance(laterCancel).find((s) => s.scenario === "a")!.pass).toBe(true);
});

it("b) three overlapping topics all complete", () => {
  const events: AcceptanceEvent[] = [
    { t: 0, kind: "send", id: "A", threadId: "main" },
    { t: 200, kind: "send", id: "B", threadId: "b", parallel: "running" },
    { t: 400, kind: "send", id: "C", threadId: "c", parallel: "running" },
    { t: 800, kind: "turn-completed", id: "C", threadId: "c" },
    { t: 900, kind: "turn-completed", id: "B", threadId: "b" },
    { t: 1_200, kind: "turn-completed", id: "A", threadId: "main" },
  ];
  expect(scoreAcceptance(events).find((s) => s.scenario === "b")!.pass).toBe(true);
});

it("c) barge-in during speech does not kill a running background task", () => {
  const events: AcceptanceEvent[] = [
    { t: 0, kind: "send", id: "A", threadId: "main" },
    { t: 200, kind: "send", id: "B", threadId: "b", parallel: "running" },
    { t: 500, kind: "bot-speak-start", id: "A" },
    { t: 700, kind: "interrupt", id: "barge" },
    { t: 720, kind: "cancelled", id: "A", threadId: "main" },
    { t: 1_400, kind: "turn-completed", id: "B", threadId: "b" },
  ];
  expect(scoreAcceptance(events).find((s) => s.scenario === "c")!.pass).toBe(true);
});

it("d) two results that land together are spoken one after another with no overlap", () => {
  const overlap: AcceptanceEvent[] = [
    { t: 0, kind: "bot-speak-start", id: "A" },
    { t: 50, kind: "bot-speak-start", id: "B" },
    { t: 400, kind: "bot-speak-end", id: "A" },
    { t: 500, kind: "bot-speak-end", id: "B" },
  ];
  expect(scoreAcceptance(overlap).find((s) => s.scenario === "d")!.pass).toBe(false);
  const ordered: AcceptanceEvent[] = [
    { t: 0, kind: "bot-speak-start", id: "A" },
    { t: 400, kind: "bot-speak-end", id: "A" },
    { t: 410, kind: "bot-speak-start", id: "B" },
    { t: 800, kind: "bot-speak-end", id: "B" },
  ];
  expect(scoreAcceptance(ordered).find((s) => s.scenario === "d")!.pass).toBe(true);
});

it("e) over the per-person limit the extra task is queued then later runs", () => {
  const events: AcceptanceEvent[] = [
    { t: 0, kind: "send", id: "A", threadId: "main" },
    { t: 200, kind: "send", id: "B", threadId: "b", parallel: "running" },
    { t: 400, kind: "send", id: "C", threadId: "c", parallel: "running" },
    { t: 600, kind: "send", id: "lim", threadId: "d", parallel: "queued" },
    { t: 700, kind: "bot-speak-start", id: "queued-notice" },
    { t: 900, kind: "bot-speak-end", id: "queued-notice" },
    { t: 1_200, kind: "parallel-running", id: "lim", threadId: "d" },
    { t: 1_800, kind: "turn-completed", id: "lim", threadId: "d" },
  ];
  expect(scoreAcceptance(events).find((s) => s.scenario === "e")!.pass).toBe(true);
});

it("f) stop cancels the thinking turn; an unrelated background task keeps running", () => {
  const events: AcceptanceEvent[] = [
    { t: 0, kind: "send", id: "A", threadId: "main" },
    { t: 200, kind: "send", id: "B", threadId: "b", parallel: "running" },
    { t: 500, kind: "send", id: "stop", intent: "stop", stopped: true },
    { t: 520, kind: "cancelled", id: "A", threadId: "main" },
    { t: 1_200, kind: "turn-completed", id: "B", threadId: "b" },
  ];
  expect(scoreAcceptance(events).find((s) => s.scenario === "f")!.pass).toBe(true);
});

it.skipIf(process.env.SAGAX_VOICE_ACCEPTANCE !== "1")("runs the real STT/LLM/TTS acceptance call", async () => {
  const { runVoiceAcceptanceCall } = await import("./voice-acceptance-call.ts");
  const result = await runVoiceAcceptanceCall();
  expect(result.dir).toMatch(/sagax-voice-acceptance/);
  expect(result.scores.map((row) => row.scenario)).toEqual(["a", "b", "c", "d", "e", "f", "latency"]);
}, 600_000);

it("records one warm total per utterance, not every metrics event", () => {
  const seen = new Set<string>();
  const totals: number[] = [];
  expect(noteWarmTotal(seen, totals, { utteranceId: "u1", stoppedAt: 100, firstAudioAt: 900 })).toBe(true);
  expect(noteWarmTotal(seen, totals, { utteranceId: "u1", stoppedAt: 100, firstAudioAt: 900 })).toBe(false);
  expect(noteWarmTotal(seen, totals, { utteranceId: "u2", stoppedAt: 2000, firstAudioAt: 2700 })).toBe(true);
  expect(totals).toEqual([800, 700]);
});

it("waitForAcceptanceSend returns once that line has been posted", async () => {
  const events: AcceptanceEvent[] = [];
  const pending = waitForAcceptanceSend(events, "C", 1_000);
  events.push({ t: 1, kind: "send", id: "C" });
  await expect(pending).resolves.toBe(true);
});

it("inject waits are counted from post-warmup origin so A and B stay 4s apart", () => {
  const origin = 14_000;
  expect(acceptanceInjectWait(origin, 0, origin)).toBe(0);
  expect(acceptanceInjectWait(origin, 4_000, origin)).toBe(4_000);
  expect(acceptanceInjectWait(origin, 4_000, origin + 1_000)).toBe(3_000);
  expect(acceptanceInjectWait(0, 4_000, 14_000)).toBe(0);
});

it("a continues send does not relabel later completions; a new topic on the same thread does", () => {
  const events: AcceptanceEvent[] = [
    { t: 0, kind: "send", id: "A", threadId: "main" },
    { t: 50, kind: "turn-started", threadId: "main" },
    { t: 80, kind: "send", id: "A", threadId: "main", continues: true },
    { t: 100, kind: "turn-completed", threadId: "main" },
    { t: 200, kind: "send", id: "B", threadId: "b" },
    { t: 250, kind: "turn-completed", threadId: "b" },
    { t: 300, kind: "send", id: "corr", threadId: "main" },
    { t: 350, kind: "turn-completed", threadId: "main" },
  ];
  assignAcceptanceTurnIds(events);
  expect(events.filter((event) => event.kind === "turn-completed").map((event) => event.id)).toEqual(["A", "B", "corr"]);
});

it("a continues fork still owns later completions on that parallel thread", () => {
  const events: AcceptanceEvent[] = [
    { t: 0, kind: "send", id: "lim", threadId: "d", continues: true, parallel: "queued" },
    { t: 50, kind: "turn-completed", threadId: "d" },
  ];
  assignAcceptanceTurnIds(events);
  expect(events[1]!.id).toBe("lim");
});

it("a continues interrupt is not scored as barge-in cancelling A", () => {
  expect(scoreAcceptanceInterrupt("A")).toBeUndefined();
  expect(scoreAcceptanceInterrupt(undefined)).toBeUndefined();
  expect(scoreAcceptanceCancel("A")).toBe(false);
  expect(scoreAcceptanceInterrupt("barge")).toEqual({ kind: "interrupt", id: "barge" });
  expect(scoreAcceptanceCancel("barge")).toBe(true);
  expect(scoreAcceptanceCancel("stop")).toBe(true);
});

it("skips a second POST of the same scripted utterance", () => {
  expect(shouldSkipDuplicateAcceptance(
    "Rédige un court courriel de bonjour.",
    "Rédige un court courriel de bonjour.",
  )).toBe(true);
  expect(shouldSkipDuplicateAcceptance(
    "Name the capital of Japan.",
    "How far is Quebec City from Montreal?",
  )).toBe(false);
  expect(shouldSkipDuplicateAcceptance(undefined, "Name the capital of Japan.")).toBe(false);
});

it("skips speculative posts so a wait instruction is not a 4-word short turn", () => {
  expect(shouldPostAcceptanceUtterance({ speculative: true }, "Please wait twenty seconds")).toBe(false);
  expect(shouldPostAcceptanceUtterance({ speculative: true }, "Please wait twelve seconds", "A")).toBe(false);
  expect(shouldPostAcceptanceUtterance({ speculative: true }, "Please wait 12 seconds", "A")).toBe(false);
  expect(shouldPostAcceptanceUtterance({ speculative: true }, "How far is Quebec City from Montreal?")).toBe(true);
  expect(shouldPostAcceptanceUtterance({ speculative: true }, "Name the capital of Japan.")).toBe(true);
  expect(shouldPostAcceptanceUtterance({ speculative: true }, "hey what time is it in Paris")).toBe(true);
  expect(shouldPostAcceptanceUtterance({ speculative: false }, "Please wait twenty seconds")).toBe(true);
  expect(shouldPostAcceptanceUtterance({})).toBe(true);
});

it("a prefix complete on main is not A until the labeled A send", () => {
  const events: AcceptanceEvent[] = [
    { t: 10, kind: "send", threadId: "main" },
    { t: 20, kind: "turn-completed", threadId: "main" },
    { t: 30, kind: "send", id: "A", threadId: "main", continues: true },
    { t: 40, kind: "turn-started", threadId: "main" },
    { t: 80, kind: "turn-completed", threadId: "main" },
  ];
  assignAcceptanceTurnIds(events);
  stampAcceptanceMainThread(events, "main");
  expect(events[1]!.id).toBeUndefined();
  expect(events[3]!.id).toBe("A");
  expect(events[4]!.id).toBe("A");
});

it("barge can wait until A has completed", async () => {
  const events: AcceptanceEvent[] = [];
  const pending = waitForAcceptanceDone(events, "A", 1_000);
  events.push({ t: 1, kind: "turn-completed", id: "A", threadId: "main" });
  await expect(pending).resolves.toBe(true);
});

it("barge waits until the bot is currently speaking", async () => {
  expect(acceptanceBotSpeaking([])).toBe(false);
  expect(acceptanceBotSpeaking([
    { t: 1, kind: "bot-speak-start", id: "A" },
    { t: 2, kind: "bot-speak-end", id: "reply" },
  ])).toBe(false);
  expect(acceptanceBotSpeaking([{ t: 1, kind: "bot-speak-start", id: "A" }])).toBe(true);
  const events: AcceptanceEvent[] = [];
  const pending = waitForAcceptanceSpeech(events, 1_000);
  events.push({ t: 1, kind: "bot-speak-start", id: "queued-notice" });
  await expect(pending).resolves.toBe(true);
});

it("scores stop from a second call, not from sequential replace on the first", () => {
  const fork = scoreAcceptance([
    { t: 0, kind: "send", id: "A", threadId: "main" },
    { t: 200, kind: "send", id: "B", threadId: "b", parallel: "running" },
    { t: 400, kind: "send", id: "C", threadId: "c", parallel: "running" },
    { t: 800, kind: "turn-completed", id: "C", threadId: "c" },
    { t: 900, kind: "turn-completed", id: "B", threadId: "b" },
    { t: 1_200, kind: "turn-completed", id: "A", threadId: "main" },
  ]);
  const stop = scoreAcceptance([
    { t: 0, kind: "send", id: "A", threadId: "main" },
    { t: 200, kind: "send", id: "B", threadId: "b", parallel: "running" },
    { t: 500, kind: "send", id: "stop", intent: "stop", stopped: true },
    { t: 520, kind: "cancelled", id: "A", threadId: "main" },
    { t: 1_200, kind: "turn-completed", id: "B", threadId: "b" },
  ]);
  const merged = mergeAcceptanceScores(fork, stop);
  expect(merged.find((row) => row.scenario === "a")!.pass).toBe(true);
  expect(merged.find((row) => row.scenario === "f")!.pass).toBe(true);
});

it("marks speculative and continues on an acceptance send like LiveCall", () => {
  expect(acceptanceVoiceCall("c", "u", "fr", { speculative: true })).toMatchObject({
    callId: "c", utteranceId: "u", language: "fr", duplex: true, speculative: true,
  });
  expect(acceptanceVoiceCall("c", "u", "en", { continues: true })).toMatchObject({ continues: true, language: "en" });
  expect(acceptanceVoiceCall("c", "u", "en", {})).not.toHaveProperty("continues");
  expect(acceptanceVoiceCall("c", "u", "en", {})).not.toHaveProperty("speculative");
});

it("latency reports warm p50 against 800 ms without inventing a pass", () => {
  const miss = scoreAcceptance([], { warmTotals: [900, 1100, 1300, 1500, 1600, 1700], targetMs: 800 });
  const latency = miss.find((s) => s.scenario === "latency")!;
  expect(latency.pass).toBe(false);
  expect(latency.detail).toMatch(/p50=1300 n=6/);
  const one = scoreAcceptance([], { warmTotals: [787], targetMs: 800 });
  expect(one.find((s) => s.scenario === "latency")!.pass).toBe(false);
  const hit = scoreAcceptance([], { warmTotals: [400, 500, 600, 700, 750, 780], targetMs: 800 });
  expect(hit.find((s) => s.scenario === "latency")!.pass).toBe(true);
});
