// Voice call latency bench (docs/voice-mode-xai.md, "Latency"): the real
// call engine (src/lib/voice-mode/call.ts: VAD frames, turn detector,
// streaming speech to text, sentence by sentence speech) against the real
// server (send route, context, engine driver, voice routes), with a fake xAI
// and a fake Claude CLI that take the time the real ones take. Each turn is
// timed from the person's last voiced frame to the first audio of the answer,
// stage by stage, measured by this bench itself (so it runs the same on an
// older checkout of the call engine).
//
//   SAGAX_VOICE_BENCH=1 pnpm exec vitest run scripts/voice-latency-bench.test.ts
//
// Knobs (env), with the defaults measured or assumed for a real setup:
//   BENCH_TURNS (12), BENCH_COLD_MS (2600: Claude CLI boot, MCP servers and
//   session read back, from native logs), BENCH_FIRST_TOKEN_MS (600: the
//   model's first token), BENCH_STT_FINAL_MS (250), BENCH_TTS_FIRST_MS (300),
//   BENCH_TLS_MS (150: a new connection to api.x.ai), BENCH_OUT (a JSON file).
//
// BENCH_COLD_MS starts when the call is accepted: the fake CLI waits it at
// process boot. The first utterance pays only what remains. A short first
// question can still overlap an unfinished cold start.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import WebSocket from "ws";

import { verificationServerEnvironment } from "./control-omb.ts";
import { startFakeXaiVoice } from "../server/testing/fake-xai-voice.ts";
import { freePortBlock } from "../server/testing/ports.ts";
import { VoiceCall } from "../src/lib/voice-mode/call.ts";
import { DEFAULT_CALL_SETTINGS } from "../src/lib/voice-mode/call-settings.ts";
import type { PcmPlayer, Sentence } from "../src/lib/voice-mode/player.ts";
import { LiveTranscriber } from "../src/lib/voice-mode/stt-stream.ts";
import { VAD_FRAME, type VoiceProbability } from "../src/lib/voice-mode/vad.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_KEY = "xai-BENCHfakeKq7Zp2Lw9Rt4Mn6Bv";
const QUESTIONS = [
  "What is the weather in Montreal today?",
  "Can you remind me what my next meeting is?",
  "How long does it take to drive to Quebec City?",
  "What time is it in Tokyo right now?",
  "Do I have any unread messages from Max?",
  "Can you summarize the last ticket for me?",
];

export interface BenchTurn {
  turn: number;
  endpoint?: number;
  stt?: number;
  dispatch?: number;
  firstToken?: number;
  firstSentence?: number;
  tts?: number;
  playback?: number;
  total?: number;
  earlyEnd?: boolean;
  earlyStart?: boolean;
  reissued?: boolean;
}

const knob = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && process.env[name] !== "" && process.env[name] !== undefined ? value : fallback;
};
/** How long a person takes per word (about three words a second). */
const WORD_MS = 330;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** A player with a clock instead of a sound card: a sentence plays from its
 * first chunk (15 ms scheduling, as PcmPlayer) for as long as its PCM lasts. */
class ClockPlayer {
  events: PcmPlayer["events"] = {};
  private queue: Sentence[] = [];
  private pumping = false;
  private nextTime = 0;
  private generation = 0;
  open() { return {} as AudioContext; }
  get output() { return null; }
  get busy() { return this.queue.length > 0 || this.pumping || performance.now() < this.nextTime; }
  level() { return 0; }
  enqueue(sentence: Sentence) {
    this.queue.push(sentence);
    if (!this.pumping) void this.pump();
  }
  duck() {}
  unduck() {}
  async cancel() {
    this.generation += 1;
    for (const sentence of this.queue) sentence.abort();
    this.queue = [];
    this.nextTime = 0;
  }
  tone() {}
  async close() { await this.cancel(); }
  resetLedger() {}
  playback() { return { heard: "", unheard: "" }; }
  private async pump() {
    this.pumping = true;
    const mine = this.generation;
    try {
      while (this.queue.length && mine === this.generation) {
        const sentence = this.queue.shift()!;
        const audio = await sentence.audio.catch(() => null);
        if (!audio) continue;
        const reader = audio.body.getReader();
        let first = true;
        for (;;) {
          const { done, value } = await reader.read();
          if (done || mine !== this.generation) break;
          const now = performance.now();
          const start = Math.max(now + 15, this.nextTime);
          this.nextTime = start + (value.byteLength / 2 / audio.sampleRate) * 1000;
          if (first) {
            first = false;
            setTimeout(() => this.events.onSentenceStart?.(sentence.text), start - now);
          }
        }
      }
    } finally {
      this.pumping = false;
    }
    setTimeout(() => {
      if (!this.busy) this.events.onIdle?.();
    }, Math.max(0, this.nextTime - performance.now()) + 20);
  }
}

/** The VAD from the bench's script: the frame's first sample is its probability. */
const scriptedVad: VoiceProbability = { probability: async (frame) => Math.round(frame[0]! * 1e4) / 10, reset() {} };
function frame(probability: number, level: number): Float32Array {
  const out = new Float32Array(VAD_FRAME).fill(level);
  out[0] = probability / 1000;
  return out;
}

async function startServer(env: Record<string, string>) {
  const port = await freePortBlock([0, 1]);
  const dataDir = mkdtempSync(join(tmpdir(), "omb-voice-bench-"));
  mkdirSync(join(dataDir, "tmp"), { recursive: true });
  const wrapper = join(dataDir, "bench-claude.mjs");
  writeFileSync(wrapper, [
    "#!/usr/bin/env node",
    ...Object.entries(env).map(([key, value]) => `process.env[${JSON.stringify(key)}] = ${JSON.stringify(value)};`),
    'process.stdin.on("end", () => process.exit(0));',
    `await import(${JSON.stringify(pathToFileURL(join(ROOT, "server", "testing", "fake-claude-cli.ts")).href)});`,
  ].join("\n"), { mode: 0o700 });
  writeFileSync(join(dataDir, "config.json"), JSON.stringify({ instances: { claude: { driver: "claudeAgent", displayName: "Bench", config: { cli: wrapper } } } }));
  const childEnv = { ...verificationServerEnvironment(process.env, dataDir, port), SAGAX_XAI_TTS_API: env.SAGAX_XAI_TTS_API!, XAI_API_KEY: FAKE_KEY };
  let log = "";
  const child: ChildProcess = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], { cwd: ROOT, env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", (chunk) => (log += chunk));
  child.stderr!.on("data", (chunk) => (log += chunk));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    try { if ((await fetch(`${url}/api/health`)).ok) break; } catch { /* starting */ }
    if (Date.now() > deadline) throw new Error(`bench server did not start:\n${log}`);
    await sleep(150);
  }
  return { url, child, log: () => log };
}

export async function runVoiceLatencyBench(): Promise<{ turns: BenchTurn[]; serverLog: string }> {
  const turns = knob("BENCH_TURNS", 12);
  const transcripts = Array.from({ length: turns }, (_, i) => QUESTIONS[i % QUESTIONS.length]!);
  const xai = await startFakeXaiVoice({
    transcripts,
    sttFinalizeMs: knob("BENCH_STT_FINAL_MS", 250),
    ttsFirstChunkMs: knob("BENCH_TTS_FIRST_MS", 300),
    ttsSeconds: 1.4,
    newConnectionMs: knob("BENCH_TLS_MS", 150),
    // xAI's interim words keep up with the person, a quarter second behind
    sttPartials: { msPerWord: WORD_MS - 30, latencyMs: 250 },
  });
  const server = await startServer({
    FAKE_CLAUDE_MODE: "voice",
    FAKE_CLAUDE_COLD_MS: String(knob("BENCH_COLD_MS", 2600)),
    FAKE_CLAUDE_FIRST_TOKEN_MS: String(knob("BENCH_FIRST_TOKEN_MS", 600)),
    FAKE_CLAUDE_TOKEN_MS: "25",
    SAGAX_XAI_TTS_API: `${xai.url}/v1`,
  });
  const origin = server.url;
  const headers = { "content-type": "application/json", origin };
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return response.json() as Promise<any>;
  };
  const results: BenchTurn[] = [];
  let call: VoiceCall | null = null;
  const events = new AbortController();
  try {
    const bot = (await api("GET", "/api/bots")).bots[0];
    const threadId = bot.threadId as string;
    const callId = `bench-${Date.now().toString(36)}`;
    await api("POST", `/api/bots/${bot.id}/voice/call`, { threadId, callId, state: "start", language: "en" });

    // what this bench sees of each turn
    let current: { sentAt?: number; firstToken?: number; ttsFirstByte?: number; text: string } = { text: "" };
    const transcriber = new LiveTranscriber({
      botId: bot.id,
      language: () => "en",
      threadId: () => threadId,
      socket: (url) => new WebSocket(url.replace(/^ws:\/\/localhost/, origin.replace(/^http/, "ws")), { headers: { origin } }) as unknown as globalThis.WebSocket,
    });
    const speech = async (_botId: string, text: string, voice: { voice?: string; speed?: number; language?: string }, thread?: string, signal?: AbortSignal) => {
      const response = await fetch(`${origin}/api/bots/${bot.id}/voice/stream`, {
        method: "POST", headers, signal,
        body: JSON.stringify({ text, voice: voice.voice, speed: voice.speed, language: voice.language, threadId: thread }),
      });
      if (response.status === 204 || !response.body) return null;
      const mine = current;
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          if (mine.sentAt !== undefined && mine.ttsFirstByte === undefined && chunk.byteLength) mine.ttsFirstByte = performance.now();
          controller.enqueue(chunk);
        },
      }));
      return { body, sampleRate: Number(response.headers.get("x-voice-sample-rate")) || 24_000 };
    };
    call = new VoiceCall({
      botId: bot.id,
      threadId: () => threadId,
      voice: () => ({ voice: "", speed: 1, language: "en" }) as never,
      settings: () => ({ ...DEFAULT_CALL_SETTINGS, onlyMyVoice: false, earcons: false, thinkingCue: false, pause: "normal" }) as never,
      player: new ClockPlayer() as unknown as PcmPlayer,
      transcriber,
      models: async () => ({ vad: scriptedVad, embedder: null }),
      speech: speech as never,
      voiceprint: null,
      getUserMedia: async () => ({ getTracks: () => [], getAudioTracks: () => [] }) as unknown as MediaStream,
      createCaptureContext: () => ({
        sampleRate: 16_000, state: "running", resume: async () => {}, close: async () => {}, destination: {},
        createMediaStreamSource: () => ({ connect() {}, disconnect() {} }),
        createAnalyser: () => ({ fftSize: 0, connect() {}, disconnect() {} }),
        createScriptProcessor: () => ({ connect() {}, disconnect() {}, onaudioprocess: null }),
      }) as unknown as AudioContext,
    });
    const live = call;
    let metrics: Record<string, number | boolean | undefined> = {};
    live.on("metrics", (turn) => { if (turn) metrics = { ...turn } as never; });
    live.on("utterance", (text, _m, turn) => {
      current.sentAt = performance.now();
      const utteranceId = (turn as { utteranceId?: string }).utteranceId ?? `bench-${Math.random().toString(36).slice(2, 12)}`;
      void api("POST", `/api/bots/${bot.id}/messages`, {
        threadId, text, sendId: utteranceId,
        voiceCall: { callId, utteranceId, language: "en", ...(turn.continues ? { continues: true } : {}) },
      });
    });
    live.on("interrupt-bot", () => void api("POST", `/api/bots/${bot.id}/interrupt`, { threadId }));

    // the answer as the page gets it: the live events' streamed text
    void (async () => {
      const response = await fetch(`${origin}/api/events`, { headers: { origin }, signal: events.signal });
      const reader = response.body!.getReader();
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
          const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
          if (!data) continue;
          let frame: any;
          try { frame = JSON.parse(data); } catch { continue; }
          const event = frame?.kind === "runtime" ? frame.event : null;
          if (!event || event.threadId !== threadId) continue;
          if (event.type === "content.delta" && event.streamKind === "assistant_text") {
            if (current.sentAt !== undefined && current.firstToken === undefined) current.firstToken = performance.now();
            current.text += event.delta;
            live.replyProgress(current.text);
          } else if (event.type === "turn.started") {
            live.setBotBusy(true);
          } else if (event.type === "turn.completed") {
            const text = current.text;
            current.text = "";
            if (text) void live.replyDone(text);
            live.setBotBusy(false);
          }
        }
      }
    })().catch(() => {});

    await live.start();
    await sleep(300);
    // the microphone: real-time 32 ms frames, speech then silence
    let speaking = false;
    let stopMic = false;
    const mic = (async () => {
      const t0 = performance.now();
      for (let i = 0; !stopMic; i++) {
        await sleep(t0 + i * 32 - performance.now());
        live.frame(speaking ? frame(0.92, 0.05) : frame(0.03, 0.001));
      }
    })();
    for (let turn = 1; turn <= turns; turn++) {
      current = { text: "" };
      metrics = {};
      speaking = true;
      await sleep(transcripts[turn - 1]!.split(/\s+/).length * WORD_MS);
      speaking = false;
      const deadline = performance.now() + 20_000;
      while (metrics.firstAudioAt === undefined && performance.now() < deadline) await sleep(20);
      const m = metrics as Record<string, number | undefined> & { earlyEnd?: boolean; earlyStart?: boolean; reissued?: boolean };
      const d = (a?: number, b?: number) => (a === undefined || b === undefined ? undefined : Math.round(b - a));
      results.push({
        turn,
        endpoint: d(m.stoppedAt, m.endedAt),
        stt: d(m.endedAt, m.transcribedAt),
        dispatch: d(m.transcribedAt, m.sentAt),
        firstToken: d(m.sentAt, current.firstToken),
        firstSentence: d(current.firstToken, m.firstSentenceAt),
        tts: d(m.firstSentenceAt, current.ttsFirstByte),
        playback: d(current.ttsFirstByte, m.firstAudioAt),
        total: d(m.stoppedAt, m.firstAudioAt),
        ...(m.earlyEnd ? { earlyEnd: true } : {}),
        ...(m.earlyStart ? { earlyStart: true } : {}),
        ...(m.reissued ? { reissued: true } : {}),
      });
      // the answer plays out, then the person thinks a moment
      while (live.player.busy || live.current.botBusy) await sleep(50);
      await sleep(1_000);
    }
    stopMic = true;
    await mic;
  } finally {
    events.abort();
    call?.end();
    server.child.kill("SIGTERM");
    await xai.close();
  }
  return { turns: results, serverLog: server.log() };
}

/** p50 and p90 of each stage (nearest rank). */
export function summarize(turns: BenchTurn[]): Record<string, { p50?: number; p90?: number }> {
  const pick = (values: number[], p: number) => {
    if (!values.length) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
  };
  const out: Record<string, { p50?: number; p90?: number }> = {};
  for (const stage of ["endpoint", "stt", "dispatch", "firstToken", "firstSentence", "tts", "playback", "total"] as const) {
    const values = turns.map((turn) => turn[stage]).filter((value): value is number => typeof value === "number");
    out[stage] = { p50: pick(values, 50), p90: pick(values, 90) };
  }
  return out;
}
