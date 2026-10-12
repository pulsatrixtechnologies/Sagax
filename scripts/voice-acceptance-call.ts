// Review 4: scripted real duplex acceptance (issue #292). Score a-f plus
// warm p50 end-of-speech -> first audio against 800 ms. Live run uses real
// STT/LLM/TTS; this module's scorer is pure.

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

import { verificationServerEnvironment } from "./control-omb.ts";
import { freePortBlock } from "../server/testing/ports.ts";
import { VoiceCall } from "../src/lib/voice-mode/call.ts";
import { SpeechSocket } from "../src/lib/voice-mode/speech-stream.ts";
import { DEFAULT_CALL_SETTINGS } from "../src/lib/voice-mode/call-settings.ts";
import { LiveTranscriber } from "../src/lib/voice-mode/stt-stream.ts";
import { VAD_FRAME, type VoiceProbability } from "../src/lib/voice-mode/vad.ts";
import { nextSpeakSlot, type SpeakItem } from "../src/lib/voice-mode/voice-speak-queue.ts";
import { classifyVoiceIntent } from "../src/lib/voice-mode/voice-topics.ts";
import { percentile } from "../src/lib/voice-mode/latency.ts";
import { VOICE_BENCH_THRESHOLDS } from "./voice-benchmark/model.ts";
import {
  BENCH_SAY_VOICE_FR,
  ClockPlayer,
  applyBenchRuntimeEvent,
  holdVoiceUntilTail,
  loadVoiceBenchKey,
  pcmFrames,
  spokenPcm,
  voiceCallMarkLanguage,
  type BenchReplyState,
} from "./voice-latency-bench.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const log = (line: string) => { process.stderr.write(`[voice-accept] ${line}\n`); };

export type AcceptanceLang = "en" | "fr";

export interface AcceptanceLine {
  id: string;
  lang: AcceptanceLang;
  atMs: number;
  text: string;
}

/** Overlapping topics, barge-in, correction, stop, a queued extra. EN+FR. */
export const ACCEPTANCE_SCRIPT: AcceptanceLine[] = [
  { id: "A", lang: "en", atMs: 0, text: "Tell me a long four paragraph story about Montreal weather. Take your time." },
  { id: "B", lang: "en", atMs: 4_000, text: "What time is it in Tokyo?" },
  { id: "C", lang: "fr", atMs: 6_000, text: "Rédige un court courriel de bonjour." },
  { id: "D", lang: "en", atMs: 7_500, text: "How far is Quebec City from Montreal?" },
  { id: "lim", lang: "fr", atMs: 8_000, text: "Prépare aussi le rapport mensuel des billets." },
  { id: "barge", lang: "en", atMs: 16_000, text: "hey what time is it in Paris" },
  { id: "corr", lang: "en", atMs: 24_000, text: "no, I meant Toronto" },
  { id: "stop", lang: "en", atMs: 32_000, text: "stop" },
];

export type AcceptanceEvent = {
  t: number;
  kind:
    | "send"
    | "turn-started"
    | "turn-completed"
    | "cancelled"
    | "interrupt"
    | "bot-speak-start"
    | "bot-speak-end"
    | "parallel-running";
  id?: string;
  threadId?: string;
  parallel?: "running" | "queued";
  intent?: "stop" | "correction" | "new_topic";
};

export type AcceptanceScenario = "a" | "b" | "c" | "d" | "e" | "f" | "latency";

export interface AcceptanceScore {
  scenario: AcceptanceScenario;
  pass: boolean;
  reason: string;
  detail?: string;
}

const done = (events: AcceptanceEvent[], id: string) =>
  events.some((event) => event.kind === "turn-completed" && event.id === id);
const killed = (events: AcceptanceEvent[], id: string) =>
  events.some((event) => event.kind === "cancelled" && event.id === id);

function speakOverlap(events: AcceptanceEvent[]): { overlap: boolean; lines: number } {
  let speaking = 0;
  let overlap = false;
  let lines = 0;
  for (const event of [...events].sort((a, b) => a.t - b.t || a.kind.localeCompare(b.kind))) {
    if (event.kind === "bot-speak-start") {
      lines += 1;
      if (speaking > 0) overlap = true;
      speaking += 1;
    } else if (event.kind === "bot-speak-end") {
      speaking = Math.max(0, speaking - 1);
    }
  }
  return { overlap, lines };
}

export function scoreAcceptance(
  events: AcceptanceEvent[],
  opts: { warmTotals?: number[]; targetMs?: number } = {},
): AcceptanceScore[] {
  const aPass = done(events, "A") && done(events, "B") && !killed(events, "A");
  const bPass = (["A", "B", "C"] as const).every((id) => done(events, id));
  const cPass = events.some((event) => event.kind === "interrupt")
    && killed(events, "A")
    && done(events, "B");
  const spoken = speakOverlap(events);
  const dPass = spoken.lines >= 2 && !spoken.overlap;
  const ePass = events.some((event) => event.kind === "send" && event.parallel === "queued")
    && events.some((event) => event.kind === "bot-speak-start" && event.id === "queued-notice")
    && events.some((event) => event.kind === "parallel-running" && event.id === "lim")
    && done(events, "lim");
  const fPass = events.some((event) => event.id === "stop")
    && killed(events, "A")
    && done(events, "B");
  const warm = opts.warmTotals ?? [];
  const target = opts.targetMs ?? VOICE_BENCH_THRESHOLDS.p50Ms;
  const p50 = percentile(warm, 50);
  const latPass = typeof p50 === "number" && p50 <= target;
  return [
    { scenario: "a", pass: aPass, reason: aPass ? "A and B both completed, A not cancelled" : "A cancelled or a topic did not finish" },
    { scenario: "b", pass: bPass, reason: bPass ? "A, B and C all completed" : "fewer than three overlapping topics completed" },
    { scenario: "c", pass: cPass, reason: cPass ? "barge-in cancelled speech, B kept running" : "background task died or barge-in missing" },
    { scenario: "d", pass: dPass, reason: dPass ? "spoken lines were sequential" : "spoken lines overlapped or never played" },
    { scenario: "e", pass: ePass, reason: ePass ? "queued extra was announced then ran" : "queued extra missing, silent, or never ran" },
    { scenario: "f", pass: fPass, reason: fPass ? "stop cancelled A, B kept running" : "stop did not cancel A or killed B" },
    { scenario: "latency", pass: latPass, reason: latPass ? `warm p50 ${p50} <= ${target}` : `warm p50 ${p50 ?? "n/a"} vs ${target}`, detail: `p50=${p50 ?? "n/a"} n=${warm.length} target=${target}` },
  ];
}

export function formatAcceptanceSummary(scores: AcceptanceScore[], extras: string[] = []): string {
  const lines = [
    "# Sagax voice acceptance",
    "",
    ...scores.map((row) => `- ${row.scenario}: ${row.pass ? "PASS" : "FAIL"} ${row.reason}${row.detail ? ` (${row.detail})` : ""}`),
    ...extras.map((line) => `- ${line}`),
    "",
  ];
  return lines.join("\n");
}

const HINT: Record<string, RegExp> = {
  stop: /^(stop|arr[eê]te|cancel)\b/i,
  corr: /\b(toronto|i meant|je voulais|no,)\b/i,
  barge: /\bparis\b/i,
  lim: /\b(rapport|mensuel)\b/i,
  C: /\b(courriel|bonjour|email)\b/i,
  B: /\btokyo\b/i,
  D: /\b(quebec|québec|how far)\b/i,
  A: /\b(montreal|montréal|story|weather|histoire)\b/i,
};

export function matchAcceptanceLine(text: string): AcceptanceLine | undefined {
  const intent = classifyVoiceIntent(text);
  if (intent === "stop") return ACCEPTANCE_SCRIPT.find((row) => row.id === "stop");
  if (intent === "correction") return ACCEPTANCE_SCRIPT.find((row) => row.id === "corr");
  for (const id of ["barge", "lim", "C", "B", "D", "A"]) {
    if (HINT[id]!.test(text)) return ACCEPTANCE_SCRIPT.find((row) => row.id === id);
  }
  return undefined;
}

export function writePcm16Wav(path: string, pcm: Buffer, sampleRate = 24_000): void {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([header, pcm]));
}

const scriptedVad: VoiceProbability = { probability: async (frame) => Math.round(frame[0]! * 1e4) / 10, reset() {} };
function quietFrame(): Float32Array {
  const out = new Float32Array(VAD_FRAME).fill(0.001);
  out[0] = 0.03 / 1000;
  return out;
}

export async function runVoiceAcceptanceCall(outDir?: string): Promise<{
  dir: string;
  scores: AcceptanceScore[];
  events: AcceptanceEvent[];
  warmTotals: number[];
}> {
  const key = loadVoiceBenchKey();
  if (!key) throw new Error("SAGAX_VOICE_ACCEPTANCE needs tts.xaiKey in the develop config");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = outDir ?? join("/tmp/sagax-voice-acceptance", runId);
  mkdirSync(dir, { recursive: true });
  const events: AcceptanceEvent[] = [];
  const mark = (event: Omit<AcceptanceEvent, "t">) => events.push({ t: Math.round(performance.now() - t0), ...event });
  const t0 = performance.now();

  const port = await freePortBlock([0, 1]);
  const dataDir = mkdtempSync(join(tmpdir(), "omb-voice-accept-"));
  mkdirSync(join(dataDir, "tmp"), { recursive: true });
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({
    tts: { provider: "xai" },
    instances: {
      grok: {
        driver: "grok",
        displayName: "Accept",
        config: { tools: false, url: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY" },
      },
    },
  }));
  const childEnv = {
    ...verificationServerEnvironment(process.env, dataDir, port),
    SAGAX_XAI_VOICE_KEY: key,
    XAI_API_KEY: key,
  };
  let serverLog = "";
  const child: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
    cwd: ROOT, env: childEnv, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (chunk) => { serverLog += chunk; });
  child.stderr!.on("data", (chunk) => { serverLog += chunk; });
  const origin = `http://127.0.0.1:${port}`;
  const up = Date.now() + 30_000;
  for (;;) {
    try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* starting */ }
    if (Date.now() > up) throw new Error(`acceptance server did not start:\n${serverLog.slice(-2000)}`);
    await sleep(150);
  }
  const headers = { origin, "content-type": "application/json" };
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${origin}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };

  const chunks: Uint8Array[] = [];
  const player = new ClockPlayer();
  const origEnqueue = player.enqueue.bind(player);
  player.enqueue = ((sentence) => {
    const audio = sentence.audio;
    sentence.audio = audio.then(async (result) => {
      if (!result) return result;
      const reader = result.body.getReader();
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) parts.push(value);
      }
      for (const part of parts) chunks.push(part);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          controller.close();
        },
      });
      return { ...result, body };
    });
    origEnqueue(sentence);
  }) as typeof player.enqueue;

  try {
    await api("PATCH", "/api/config", { threads: { maxParallelPerPerson: 2 } });
    const created = await api("POST", "/api/bots", { name: "Accept" });
    const bot = (created.body as { bot: { id: string; threadId: string } }).bot;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grok", model: "grok-4-fast-non-reasoning" } });
    const threadId = bot.threadId;
    const callId = `accept-${Date.now().toString(36)}`;
    await api("POST", `/api/bots/${bot.id}/voice/call`, { threadId, callId, state: "start", language: "auto" });

    const spoken = ACCEPTANCE_SCRIPT.map((row) => {
      log(`say ${row.id} ${row.lang}`);
      return {
        row,
        frames: holdVoiceUntilTail(pcmFrames(spokenPcm(row.text, row.lang === "fr" ? BENCH_SAY_VOICE_FR : undefined))),
      };
    });

    let current: BenchReplyState = { text: "" };
    const transcriber = new LiveTranscriber({
      botId: bot.id,
      language: () => "auto",
      threadId: () => threadId,
      socket: (url) => new WebSocket(url.replace(/^ws:\/\/localhost/, origin.replace(/^http/, "ws")), { headers: { origin } }) as unknown as globalThis.WebSocket,
      transcribe: async (_botId, audio, language, thread) => {
        const query = new URLSearchParams({ language, ...(thread ? { threadId: thread } : {}) });
        const response = await fetch(`${origin}/api/bots/${bot.id}/voice/transcribe?${query}`, {
          method: "POST", headers: { origin, "content-type": audio.type || "audio/wav" }, body: audio,
        });
        if (!response.ok) throw new Error(`transcribe ${response.status}`);
        const body = await response.json() as { text?: string };
        return typeof body.text === "string" ? body.text : "";
      },
    });
    const speech = async (_botId: string, text: string, voice: { voice?: string; speed?: number; language?: string }, thread?: string, signal?: AbortSignal) => {
      const response = await fetch(`${origin}/api/bots/${bot.id}/voice/stream`, {
        method: "POST", headers, signal,
        body: JSON.stringify({ text, voice: voice.voice, speed: voice.speed, language: voice.language, threadId: thread }),
      });
      if (response.status === 204 || !response.body) return null;
      return { body: response.body, sampleRate: Number(response.headers.get("x-voice-sample-rate")) || 24_000 };
    };
    const speechSocket = new SpeechSocket({
      botId: bot.id,
      threadId: () => threadId,
      voice: () => ({ voice: "", speed: 1, language: "auto" }) as never,
      socket: (url) => new WebSocket(url.replace(/^ws:\/\/localhost/, origin.replace(/^http/, "ws")), { headers: { origin } }) as unknown as globalThis.WebSocket,
      post: speech as never,
    });
    const call = new VoiceCall({
      botId: bot.id,
      threadId: () => threadId,
      voice: () => ({ voice: "", speed: 1, language: "auto" }) as never,
      settings: () => ({ ...DEFAULT_CALL_SETTINGS, onlyMyVoice: false, earcons: false, thinkingCue: false, pause: "normal", streamingVoice: true, fasterEndOfTurn: true, fullDuplex: true }) as never,
      player: player as never,
      transcriber,
      models: async () => ({ vad: scriptedVad, embedder: null }),
      speechSocket,
      voiceprint: null,
      getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) as unknown as MediaStream,
      createCaptureContext: () => ({
        sampleRate: 16_000, state: "running", resume: async () => {}, close: async () => {}, destination: {},
        createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
        createAnalyser: () => ({ fftSize: 0, connect() {}, disconnect() {} }),
        createScriptProcessor: () => ({ connect() {}, disconnect() {}, onaudioprocess: null }),
      }) as unknown as AudioContext,
    });

    const pendingSpeak: Array<SpeakItem & { text: string }> = [];
    const drainSpeak = () => {
      const slot = nextSpeakSlot({
        userSpeaking: call.current.phase === "hearing",
        botSpeaking: player.busy || call.current.botAudible,
        waiting: pendingSpeak,
      });
      if (slot.action === "hold") return;
      const item = pendingSpeak.find((row) => row.id === slot.id);
      if (!item) return;
      pendingSpeak.splice(pendingSpeak.indexOf(item), 1);
      mark({ kind: "bot-speak-start", id: item.id });
      void Promise.resolve(item.id === "queued-notice" ? call.say(item.text) : call.replyDone(item.text)).finally(() => {
        mark({ kind: "bot-speak-end", id: item.id });
        drainSpeak();
      });
    };

    const warmTotals: number[] = [];
    let metrics: Record<string, number | boolean | undefined> = {};
    call.on("metrics", (turn) => {
      if (!turn) return;
      metrics = { ...turn } as never;
      if (typeof turn.stoppedAt === "number" && typeof turn.firstAudioAt === "number") {
        warmTotals.push(Math.max(0, Math.round(turn.firstAudioAt - turn.stoppedAt)));
      }
    });
    call.on("utterance", (text, turnMetrics) => {
      metrics = { ...metrics, ...turnMetrics } as never;
      current.sentAt ??= performance.now();
      const line = matchAcceptanceLine(text);
      const utteranceId = `acc-${Math.random().toString(36).slice(2, 10)}`;
      void api("POST", `/api/bots/${bot.id}/messages`, {
        threadId, text, sendId: utteranceId,
        voiceCall: { callId, utteranceId, language: voiceCallMarkLanguage(line?.lang ?? "en"), duplex: true },
      }).then((sent) => {
        const parallel = (sent.body as { parallel?: { state?: string; threadId?: string } }).parallel;
        const stopped = (sent.body as { stopped?: boolean }).stopped;
        mark({
          kind: "send",
          id: line?.id,
          threadId: parallel?.threadId ?? threadId,
          parallel: parallel?.state === "queued" || parallel?.state === "running" ? parallel.state : undefined,
          intent: classifyVoiceIntent(text),
        });
        if (stopped) mark({ kind: "cancelled", id: "A", threadId });
        log(`send ${line?.id ?? "?"} status=${sent.status} parallel=${parallel?.state ?? "none"}`);
      });
    });
    call.on("interrupt-bot", () => {
      mark({ kind: "interrupt", id: "barge" });
      void api("POST", `/api/bots/${bot.id}/interrupt`, { threadId }).then(() => mark({ kind: "cancelled", id: "A", threadId }));
    });

    const eventsAbort = new AbortController();
    void (async () => {
      const response = await fetch(`${origin}/api/events`, { headers: { origin }, signal: eventsAbort.signal });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = block.split("\n").filter((row) => row.startsWith("data:")).map((row) => row.slice(5).trim()).join("");
          if (!data) continue;
          let frame: { kind?: string; event?: { type?: string; threadId?: string; streamKind?: string; delta?: string; itemType?: string; text?: string } };
          try { frame = JSON.parse(data); } catch { continue; }
          const event = frame?.kind === "runtime" ? frame.event : null;
          if (!event) continue;
          if (event.type === "turn.started") mark({ kind: "turn-started", threadId: event.threadId });
          if (event.type === "turn.completed") mark({ kind: "turn-completed", threadId: event.threadId });
          applyBenchRuntimeEvent(event, threadId, current, {
            progress: (text) => call.replyProgress(text),
            done: (text) => {
              pendingSpeak.push({ id: `reply-${pendingSpeak.length}`, priority: "user-reply", at: performance.now(), text });
              drainSpeak();
            },
            setBusy: (busy) => call.setBotBusy(busy),
          });
        }
      }
    })().catch(() => {});

    await call.start();
    await speechSocket.connect();
    await sleep(300);

    let pendingFrames: Float32Array[] = [];
    let stopMic = false;
    const mic = (async () => {
      const started = performance.now();
      for (let i = 0; !stopMic; i++) {
        await sleep(started + i * 32 - performance.now());
        call.frame(pendingFrames.length ? pendingFrames.shift()! : quietFrame());
      }
    })();

    const seen = new Set<string>();
    const poll = async () => {
      const messages = ((await api("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? []) as Array<{
        text?: string; parallelTask?: { role?: string; state?: string; threadId?: string }; role?: string;
      }>;
      for (const message of messages) {
        const key = `${message.parallelTask?.role}:${message.parallelTask?.threadId}:${message.text?.slice(0, 40)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (message.parallelTask?.state === "queued") {
          pendingSpeak.push({ id: "queued-notice", priority: "queued-notice", at: performance.now(), text: "That one is waiting for a free slot." });
          drainSpeak();
        }
        if (message.parallelTask?.state === "running" && message.parallelTask.role === "card") {
          mark({ kind: "parallel-running", id: "lim", threadId: message.parallelTask.threadId });
        }
        if (message.parallelTask?.role === "result" && message.text) {
          const line = matchAcceptanceLine(message.text) ?? ACCEPTANCE_SCRIPT.find((row) => row.id === "B");
          mark({ kind: "turn-completed", id: line?.id, threadId: message.parallelTask.threadId });
          pendingSpeak.push({ id: line?.id ?? "topic", priority: "topic-result", at: performance.now(), text: message.text });
          drainSpeak();
        }
      }
      const tasks = ((await api("GET", "/api/bots")).body as { bots: Array<{ id: string; tasks?: Array<{ threadId: string; busy?: boolean }> }> }).bots.find((row) => row.id === bot.id)?.tasks ?? [];
      for (const task of tasks) {
        if (!task.busy && events.some((event) => event.threadId === task.threadId && event.kind === "send") && !events.some((event) => event.threadId === task.threadId && event.kind === "turn-completed")) {
          mark({ kind: "turn-completed", threadId: task.threadId });
        }
      }
    };

    for (const item of spoken) {
      const wait = Math.max(0, item.row.atMs - (performance.now() - t0));
      await sleep(wait);
      log(`inject ${item.row.id}`);
      pendingFrames.push(...item.frames);
    }
    const end = performance.now() + 45_000;
    while (performance.now() < end) {
      await poll();
      await sleep(500);
    }
    stopMic = true;
    await mic;
    eventsAbort.abort();
    call.end();

    const byThread = new Map<string, string>();
    for (const event of events) {
      if (event.kind === "send" && event.id && event.threadId) byThread.set(event.threadId, event.id);
    }
    for (const event of events) {
      if ((event.kind === "turn-started" || event.kind === "turn-completed") && event.threadId && !event.id) {
        event.id = byThread.get(event.threadId) ?? (event.threadId === threadId ? "A" : event.id);
      }
    }

    const scores = scoreAcceptance(events, { warmTotals: warmTotals.slice(1) });
    writeFileSync(join(dir, "events.json"), JSON.stringify({ events, warmTotals, scores }, null, 2));
    writeFileSync(join(dir, "transcripts.md"), events.filter((event) => event.kind === "send" || event.kind === "turn-completed").map((event) => `${event.t} ${event.kind} ${event.id ?? ""}`).join("\n"));
    writePcm16Wav(join(dir, "bot.wav"), Buffer.concat(chunks.map((part) => Buffer.from(part))));
    writeFileSync(join(dir, "summary.md"), formatAcceptanceSummary(scores, [
      `run ${runId}`,
      `events ${events.length}`,
      `warm n=${warmTotals.slice(1).length} raw=${warmTotals.join(",")}`,
    ]));
    log(`wrote ${dir}`);
    return { dir, scores, events, warmTotals };
  } finally {
    child.kill("SIGTERM");
  }
}

/** The 32-turn acceptance benchmark. Imported on call so scoring this file
 * does not boot a server. */
export async function runAcceptanceBenchmark(profile: "synthetic" | "real" = "synthetic") {
  const { runVoiceBenchmark } = await import("./voice-benchmark/run.ts");
  return runVoiceBenchmark({ profile });
}

