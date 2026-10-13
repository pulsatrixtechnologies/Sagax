// Voice call latency bench (docs/voice-mode-xai.md, "Latency"): the real
// call engine (src/lib/voice-mode/call.ts: VAD frames, turn detector,
// streaming speech to text, sentence by sentence speech) against the real
// server (send route, context, engine driver, voice routes), with a fake xAI
// and a fake engine CLI (Claude, or Grok over ACP) that take the time the
// real ones take. Each turn is
// timed from the person's last voiced frame to the first audio of the answer,
// stage by stage, measured by this bench itself (so it runs the same on an
// older checkout of the call engine).
//
//   SAGAX_VOICE_BENCH=1 pnpm exec vitest run scripts/voice-latency-bench.test.ts
//   SAGAX_VOICE_BENCH_REAL=1 uses live xAI STT/LLM/TTS (never prints the key).
//   A filler cue does not count: thinkingCue is off. Product gate: warm p50
//   end-of-speech -> first spoken clause under 800 ms.
//
// Knobs (env), with the defaults measured or assumed for a real setup:
//   BENCH_ENGINES (claude,grok), BENCH_TURNS (20 real / 12 fake), BENCH_COLD_MS (2600: CLI
//   boot, MCP servers and session read back, from Claude's native logs),
//   BENCH_LOAD_MS (900, assumed: one ACP session/load or session/new, the
//   MCP servers reconnected and the history read back), BENCH_FIRST_TOKEN_MS
//   (600: the model's first token), BENCH_CACHED_FIRST_TOKEN_MS (180: a harness
//   stand-in for a prefix-cache hit after the call's cache prime, not an
//   xAI measurement; unset on the fake CLI keeps BENCH_FIRST_TOKEN_MS),
//   BENCH_STT_FINAL_MS (250),
//   BENCH_TTS_FIRST_MS (300), BENCH_TLS_MS (150: a new connection to
//   api.x.ai), BENCH_SPEECH (socket: the streaming voice, GET /voice/speech,
//   the default setting; post: one POST /voice/stream per sentence),
//   BENCH_FASTER_END (1: "Faster end of turn", the default setting; 0: off),
//   BENCH_UNPUNCTUATED (1: the words never carry punctuation, so only the
//   voice's ending can shorten the endpoint), BENCH_DUPLEX (1: fullDuplex
//   on; 0: off, the default), BENCH_REPLY (the engine's
//   answer), BENCH_OUT (a JSON file).
//
// The microphone's voiced frames are a voice-like tone (a fundamental and a
// harmonic) whose last 400 ms fall in pitch and fade, as a statement ends,
// so the call's own pitch reading sees what it would see of a person.
//
// BENCH_COLD_MS starts when the call is accepted: the fake CLI waits it at
// process boot. The first utterance pays only what remains. A short first
// question can still overlap an unfinished cold start. The Grok case also
// counts each turn's ACP session establishments (session/load, /resume,
// /new): a warm call turn has none, only its session/prompt.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import WebSocket from "ws";

import { verificationServerEnvironment } from "./control-omb.ts";
import { startFakeXaiVoice } from "../server/testing/fake-xai-voice.ts";
import { freePortBlock } from "../server/testing/ports.ts";
import { VoiceCall } from "../src/lib/voice-mode/call.ts";
import { acceptVoiceOpener, type VoiceOpenerOwner } from "../src/lib/voice-mode/voice-opener.ts";
import { SpeechSocket } from "../src/lib/voice-mode/speech-stream.ts";
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

export type BenchEngine = "claude" | "grok" | "xai";

export function realVoiceBench(): boolean {
  return process.env.SAGAX_VOICE_BENCH_REAL === "1";
}

/** Load the xAI voice key without logging it. Env wins, then the develop
 * config, then the packaged-app config's leftover plaintext field. */
export function loadVoiceBenchKey(): string | undefined {
  const fromEnv = process.env.SAGAX_XAI_VOICE_KEY?.trim() || process.env.XAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const homes = new Set<string>();
  try { homes.add(userInfo().homedir); } catch { /* no passwd entry */ }
  homes.add(homedir());
  for (const home of homes) {
  for (const folder of [".openmausbot-dev", ".sagax"]) {
    const file = join(home, folder, "config.json");
    if (!existsSync(file)) continue;
    try {
      const cfg = JSON.parse(readFileSync(file, "utf8")) as { tts?: { xaiKey?: string }; xai?: { key?: string } };
      const key = cfg.tts?.xaiKey?.trim() || cfg.xai?.key?.trim();
      if (key) return key;
    } catch {
      /* unreadable: try the next home */
    }
  }
  }
  return undefined;
}

export function readWavPcm16(path: string): Float32Array {
  const buf = readFileSync(path);
  let i = 12;
  while (i + 8 <= buf.length) {
    const id = buf.toString("ascii", i, i + 4);
    const size = buf.readUInt32LE(i + 4);
    if (id === "data") {
      const pcm = buf.subarray(i + 8, i + 8 + size);
      const out = new Float32Array(Math.floor(pcm.length / 2));
      for (let s = 0; s < out.length; s++) out[s] = pcm.readInt16LE(s * 2) / 32768;
      return out;
    }
    i += 8 + size + (size % 2);
  }
  throw new Error("wav has no data chunk");
}

const knob = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && process.env[name] !== "" && process.env[name] !== undefined ? value : fallback;
};

/** Québec French macOS voice for real-bench French turns. */
export const BENCH_SAY_VOICE_FR = "Amélie";

export function defaultBenchTurns(real: boolean): number {
  return knob("BENCH_TURNS", real ? 20 : 12);
}

/** STT/TTS may use `auto`; a send's voiceCall.language must not (the mark
 * parser rejects it and the turn never starts). */
export function voiceCallMarkLanguage(lang: string): "en" | "fr" {
  return lang === "fr" ? "fr" : "en";
}

export type BenchReplyState = { sentAt?: number; firstToken?: number; ttsFirstByte?: number; text: string; posted?: boolean; discard?: boolean };

/** LiveCall pins /interrupt to the cancelled utterance so a replacement
 * send is not killed. The bench must do the same. */
export function benchInterruptBody(threadId: string, target?: { utteranceId: string }): { threadId: string; expectedUtteranceId?: string } {
  return { threadId, ...(target?.utteranceId ? { expectedUtteranceId: target.utteranceId } : {}) };
}

/** One POST per bench turn. A reissued STT of the same question would
 * otherwise fork a sibling under Phase 6 admit (new topic while thinking). */
export function shouldSendBenchUtterance(
  state: { posted?: boolean },
  turn?: { continues?: boolean; interrupted?: boolean },
): boolean {
  if (turn?.continues || turn?.interrupted) {
    state.posted = true;
    return true;
  }
  if (state.posted) return false;
  state.posted = true;
  return true;
}

export type BenchReplySink = {
  progress(text: string): void;
  done(text: string): void;
  setBusy(busy: boolean): void;
};

/** Drive VoiceCall from one /api/events runtime frame. item.completed is
 * the LiveCall settle path: if content.delta was missed, still speak. */
export function applyBenchRuntimeEvent(
  event: {
    type?: string;
    threadId?: string;
    streamKind?: string;
    delta?: string;
    itemType?: string;
    text?: string;
  } | null | undefined,
  threadId: string,
  state: BenchReplyState,
  sink: BenchReplySink,
  now: () => number = () => performance.now(),
): boolean {
  if (!event || event.threadId !== threadId) return false;
  if (event.type === "content.delta" && event.streamKind === "assistant_text" && typeof event.delta === "string") {
    if (state.sentAt !== undefined && state.firstToken === undefined) state.firstToken = now();
    state.text += event.delta;
    sink.progress(state.text);
    return true;
  }
  if (event.type === "item.completed" && event.itemType === "assistant_text" && typeof event.text === "string" && event.text && !state.text) {
    if (state.sentAt !== undefined && state.firstToken === undefined) state.firstToken = now();
    state.text = event.text;
    sink.progress(state.text);
    return true;
  }
  if (event.type === "turn.started") {
    state.discard = false;
    state.text = "";
    state.firstToken = undefined;
    state.ttsFirstByte = undefined;
    sink.setBusy(true);
    return true;
  }
  if (event.type === "turn.completed") {
    const text = state.text;
    state.text = "";
    if (text && !state.discard) sink.done(text);
    if (!state.discard) sink.setBusy(false);
    return true;
  }
  return true;
}

/** Local spoken audio of `text` at 16 kHz, for real STT (macOS `say`). */
export function spokenPcm(text: string, voice?: string): Float32Array {
  const dir = mkdtempSync(join(tmpdir(), "voice-bench-say-"));
  const aiff = join(dir, "q.aiff");
  const wav = join(dir, "q.wav");
  const args = voice ? ["-v", voice, "-o", aiff, text] : ["-o", aiff, text];
  const said = spawnSync("say", args, { stdio: "ignore", timeout: 20_000 });
  if (said.status !== 0) throw new Error("say failed to record the question");
  const converted = spawnSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", aiff, wav], { stdio: "ignore", timeout: 15_000 });
  if (converted.status !== 0 || !existsSync(wav)) throw new Error("afconvert failed");
  return readWavPcm16(wav);
}

/** ClockPlayer schedules onSentenceStart 15 ms after the first PCM byte.
 * If that callback is missed (cancel/generation race) but TTS already
 * started, stamp firstAudio from the first byte so the turn still has a total. */
export function stampClockPlayback(metrics: {
  firstAudioAt?: number | boolean;
  ttsFirstByteAt?: number | boolean;
  firstSentenceAt?: number | boolean;
  earlyStart?: boolean;
  stoppedAt?: number;
  endedAt?: number;
}): void {
  // held speculative TTS has first-byte timestamps before speech-end.
  // stamping firstAudio here is what made real18 turn 16 wait 45 s for
  // firstSentence after a leftover firstAudioAt.
  if (metrics.earlyStart && metrics.endedAt === metrics.stoppedAt) return;
  if (
    metrics.firstAudioAt === undefined
    && typeof metrics.ttsFirstByteAt === "number"
    && typeof metrics.firstSentenceAt === "number"
  ) {
    metrics.firstAudioAt = metrics.ttsFirstByteAt + 15;
  }
}

/** A metrics event from VoiceCall does not carry a ClockPlayer fallback
 * stamp. Keep the one we already have unless the turn itself stamped. */
export function mergeBenchMetrics<T extends { firstAudioAt?: number | boolean; utteranceId?: string }>(prev: T, next: T): T {
  const out = { ...next };
  if (prev.utteranceId && next.utteranceId && prev.utteranceId !== next.utteranceId) return out;
  if (out.firstAudioAt === undefined && prev.firstAudioAt !== undefined) out.firstAudioAt = prev.firstAudioAt;
  return out;
}

/** Keep VAD voiced until the last `tailMs` of the utterance. macOS `say`
 * inserts pauses that would otherwise false-cut a completeMs endpoint. */
export function holdVoiceUntilTail(frames: Float32Array[], tailMs = 400): Float32Array[] {
  if (!frames.length) return frames;
  const tail = Math.max(1, Math.ceil(tailMs / 32));
  let lastVoiced = -1;
  for (let i = 0; i < frames.length; i++) {
    if ((frames[i]![0] ?? 0) * 1000 > 0.5) lastVoiced = i;
  }
  const holdUntil = Math.max(0, lastVoiced - tail + 1);
  for (let i = 0; i < holdUntil; i++) {
    const frame = frames[i]!;
    if ((frame[0] ?? 0) * 1000 < 0.5) frame[0] = 0.92 / 1000;
  }
  return frames;
}

export function pcmFrames(pcm: Float32Array): Float32Array[] {
  const frames: Float32Array[] = [];
  for (let i = 0; i + VAD_FRAME <= pcm.length; i += VAD_FRAME) {
    const slice = pcm.subarray(i, i + VAD_FRAME);
    const out = new Float32Array(slice);
    let energy = 0;
    for (let s = 0; s < out.length; s++) energy += out[s]! * out[s]!;
    const voiced = Math.sqrt(energy / out.length) > 0.01;
    out[0] = (voiced ? 0.92 : 0.03) / 1000;
    frames.push(out);
  }
  return frames;
}

export interface BenchTurn {
  turn: number;
  lang?: "en" | "fr";
  text?: string;
  /** Grok: the ACP session establishments (session/load, /resume, /new) this turn paid */
  establish?: number;
  endpoint?: number;
  stt?: number;
  dispatch?: number;
  firstToken?: number;
  firstSentence?: number;
  tts?: number;
  playback?: number;
  total?: number;
  earlyEnd?: boolean;
  /** ended on the voice's ending alone (no punctuation) */
  contourEnd?: boolean;
  /** spoken over the streaming voice socket */
  streamed?: boolean;
  earlyStart?: boolean;
  reissued?: boolean;
  /** first audio arrived this many ms before end-of-speech */
  beatEosMs?: number;
}

/** How long a person takes per word (about three words a second). */
const WORD_MS = 330;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
const benchLog = (line: string) => {
  process.stderr.write(`[voice-bench] ${line}\n`);
};

/** A player with a clock instead of a sound card: a sentence plays from its
 * first chunk (15 ms scheduling, as PcmPlayer) for as long as its PCM lasts. */
export class ClockPlayer {
  events: PcmPlayer["events"] = {};
  private queue: Sentence[] = [];
  private pumping = false;
  private nextTime = 0;
  private generation = 0;
  open() { return {} as AudioContext; }
  get output() { return null; }
  get busy() { return this.queue.length > 0 || this.pumping || performance.now() < this.nextTime; }
  level() { return this.busy ? 0.1 : 0; }
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
    if (this.pumping) return;
    this.pumping = true;
    const mine = this.generation;
    try {
      while (this.queue.length && mine === this.generation) {
        const sentence = this.queue.shift()!;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const audio = await Promise.race([
          sentence.audio.catch(() => null),
          new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 15_000); }),
        ]);
        if (timer) clearTimeout(timer);
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
            setTimeout(() => {
              if (mine === this.generation) this.events.onSentenceStart?.(sentence.text);
            }, start - now);
          }
        }
      }
    } finally {
      this.pumping = false;
    }
    if (this.queue.length) {
      void this.pump();
      return;
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

/** A voiced frame of the bench's "person": 175 Hz, falling to 125 Hz and
 * fading over the last 400 ms before `remainingMs` reaches 0. */
let voicePhase = 0;
function voicedFrame(remainingMs: number): Float32Array {
  const t = remainingMs >= 400 ? 0 : Math.min(1, Math.max(0, 1 - remainingMs / 400));
  const hz = 175 * (125 / 175) ** t;
  const amplitude = 0.08 * (1 - 0.75 * t);
  const out = new Float32Array(VAD_FRAME);
  for (let i = 0; i < VAD_FRAME; i++) {
    voicePhase += (2 * Math.PI * hz) / 16_000;
    out[i] = amplitude * (Math.sin(voicePhase) + 0.5 * Math.sin(2 * voicePhase)) / 1.5;
  }
  out[0] = 0.92 / 1000;
  return out;
}

async function startServer(engine: BenchEngine, env: Record<string, string>, real = false) {
  const port = await freePortBlock([0, 1]);
  const dataDir = mkdtempSync(join(tmpdir(), "omb-voice-bench-"));
  mkdirSync(join(dataDir, "tmp"), { recursive: true });
  if (real) {
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({
      tts: { provider: "xai" },
      instances: {
        grok: {
          driver: "grok",
          displayName: "Bench",
          config: { tools: false, url: "https://api.x.ai/v1", apiKeyEnv: "XAI_API_KEY" },
        },
      },
    }));
  } else {
    const wrapper = join(dataDir, `bench-${engine}.mjs`);
    const fake = engine === "grok" ? "fake-acp-cli.ts" : "fake-claude-cli.ts";
    writeFileSync(wrapper, [
      "#!/usr/bin/env node",
      ...Object.entries(env).map(([key, value]) => `process.env[${JSON.stringify(key)}] = ${JSON.stringify(value)};`),
      ...(engine === "claude" ? ['process.stdin.on("end", () => process.exit(0));'] : []),
      `await import(${JSON.stringify(pathToFileURL(join(ROOT, "server", "testing", fake)).href)});`,
    ].join("\n"), { mode: 0o700 });
    writeFileSync(join(dataDir, "config.json"), JSON.stringify({ instances: engine === "grok"
      ? { grok: { driver: "grokAgent", displayName: "Bench", config: { cli: wrapper, fullAuto: false } } }
      : { claude: { driver: "claudeAgent", displayName: "Bench", config: { cli: wrapper } } } }));
  }
  // The server's own xAI voice key (server/config.ts): XAI_API_KEY is not
  // read there, and a bench given only that one gets no speech at all.
  const childEnv = {
    ...verificationServerEnvironment(process.env, dataDir, port),
    ...(real ? {} : { SAGAX_XAI_TTS_API: env.SAGAX_XAI_TTS_API! }),
    SAGAX_XAI_VOICE_KEY: real ? env.SAGAX_XAI_VOICE_KEY! : FAKE_KEY,
    ...(real ? { XAI_API_KEY: env.XAI_API_KEY! } : {}),
  };
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

/** The ACP requests the fake Grok logged, in order. */
function acpMethods(file: string): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => (JSON.parse(line) as { method: string }).method);
}
const ESTABLISH = new Set(["session/load", "session/resume", "session/new"]);

export type RealBenchQuestion = { text: string; lang: "en" | "fr" };

/** 20 real turns: English and Québec French, short and long. Cryptic: no
 * p50 claim from fewer than 20. */
export const REAL_QUESTIONS: RealBenchQuestion[] = [
  { text: "What time is it?", lang: "en" },
  { text: "How is the weather?", lang: "en" },
  { text: "What is two plus two?", lang: "en" },
  { text: "Say hello.", lang: "en" },
  { text: "Can you remind me what my next meeting is?", lang: "en" },
  { text: "How long does it take to drive from Montreal to Quebec City?", lang: "en" },
  { text: "Please summarize the last ticket I opened.", lang: "en" },
  { text: "What is the difference between a process and a thread in one sentence?", lang: "en" },
  { text: "Do I have any unread messages from Max?", lang: "en" },
  { text: "Tell me a two sentence joke about coffee.", lang: "en" },
  { text: "Quelle heure est-il?", lang: "fr" },
  { text: "Quel temps fait-il?", lang: "fr" },
  { text: "Combien font deux plus deux?", lang: "fr" },
  { text: "Dis bonjour.", lang: "fr" },
  { text: "Peux-tu me rappeler quel est mon prochain rendez-vous?", lang: "fr" },
  { text: "Combien de temps pour aller de Montréal à Québec en voiture?", lang: "fr" },
  { text: "Résume-moi le dernier billet que j'ai ouvert.", lang: "fr" },
  { text: "C'est quoi la différence entre un process et un thread, en une phrase?", lang: "fr" },
  { text: "Est-ce que j'ai des messages non lus?", lang: "fr" },
  { text: "Raconte-moi une blague de deux phrases sur le café.", lang: "fr" },
];

export async function runVoiceLatencyBench(engine: BenchEngine = "claude"): Promise<{ engine: BenchEngine; turns: BenchTurn[]; serverLog: string; diag?: unknown; acp?: string[]; real?: boolean }> {
  const real = realVoiceBench() || engine === "xai";
  const turns = defaultBenchTurns(real);
  const useSocket = (process.env.BENCH_SPEECH ?? "socket") !== "post";
  const fasterEnd = knob("BENCH_FASTER_END", 1) !== 0;
  const unpunctuated = knob("BENCH_UNPUNCTUATED", 0) === 1;
  const callLanguage = real ? "auto" : "en";
  const questionBank: RealBenchQuestion[] = real ? REAL_QUESTIONS : QUESTIONS.map((text) => ({ text, lang: "en" }));
  const transcripts = Array.from({ length: turns }, (_, i) => {
    const q = questionBank[i % questionBank.length]!;
    return { ...q, text: unpunctuated ? q.text.replace(/[?.!]+$/, "") : q.text };
  });
  const reply = process.env.BENCH_REPLY ? { FAKE_CLAUDE_VOICE_REPLY: process.env.BENCH_REPLY, FAKE_ACP_VOICE_REPLY: process.env.BENCH_REPLY } : {};
  const key = real ? loadVoiceBenchKey() : undefined;
  if (real && !key) throw new Error("SAGAX_VOICE_BENCH_REAL needs SAGAX_XAI_VOICE_KEY (or tts.xaiKey in the develop config)");
  const xai = real ? null : await startFakeXaiVoice({
    transcripts: transcripts.map((q) => q.text),
    sttFinalizeMs: knob("BENCH_STT_FINAL_MS", 250),
    ttsFirstChunkMs: knob("BENCH_TTS_FIRST_MS", 300),
    ttsSeconds: 1.4,
    newConnectionMs: knob("BENCH_TLS_MS", 150),
    // xAI's interim words keep up with the person, a quarter second behind
    sttPartials: { msPerWord: WORD_MS - 30, latencyMs: 250 },
  });
  const acpLog = join(mkdtempSync(join(tmpdir(), "omb-voice-bench-acp-")), "rpc.jsonl");
  const fakeApi = xai ? `${xai.url}/v1` : "";
  const server = await startServer(real ? "xai" : engine, real ? {
    SAGAX_XAI_VOICE_KEY: key!,
    XAI_API_KEY: key!,
  } : engine === "grok" ? {
    FAKE_ACP_MODE: "voice",
    FAKE_ACP_COLD_MS: String(knob("BENCH_COLD_MS", 2600)),
    FAKE_ACP_LOAD_MS: String(knob("BENCH_LOAD_MS", 900)),
    FAKE_ACP_FIRST_TOKEN_MS: String(knob("BENCH_FIRST_TOKEN_MS", 600)),
    FAKE_ACP_CACHED_FIRST_TOKEN_MS: String(knob("BENCH_CACHED_FIRST_TOKEN_MS", 180)),
    FAKE_ACP_TOKEN_MS: "25",
    FAKE_ACP_RPC_APPEND_FILE: acpLog,
    SAGAX_XAI_TTS_API: fakeApi,
    ...reply,
  } : {
    FAKE_CLAUDE_MODE: "voice",
    FAKE_CLAUDE_COLD_MS: String(knob("BENCH_COLD_MS", 2600)),
    FAKE_CLAUDE_FIRST_TOKEN_MS: String(knob("BENCH_FIRST_TOKEN_MS", 600)),
    FAKE_CLAUDE_TOKEN_MS: "25",
    SAGAX_XAI_TTS_API: fakeApi,
    ...reply,
  }, real);
  const origin = server.url;
  const headers = { "content-type": "application/json", origin };
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${origin}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const parsed = await response.json().catch(() => ({})) as any;
    return { ok: response.ok, status: response.status, ...parsed };
  };
  const results: BenchTurn[] = [];
  let call: VoiceCall | null = null;
  const events = new AbortController();
  const diag: {
    bot?: { id?: string; model?: unknown };
    streaming?: boolean;
    startMs?: number;
    partials: string[];
    utterances: string[];
    rejects: string[];
    errors: string[];
    sends: Array<{ status: number; ok: boolean; superseded?: boolean }>;
    sse: number;
    speechReady?: boolean;
    uploadError?: string;
  } = { partials: [], utterances: [], rejects: [], errors: [], sends: [], sse: 0 };
  try {
    let bot = real ? null : (await api("GET", "/api/bots")).bots?.[0];
    if (!bot) {
      const created = await api("POST", "/api/bots", {
        name: "Bench",
        modelSelection: { instanceId: "grok", model: "grok-4-fast-non-reasoning" },
      });
      bot = created.bot;
      if (!bot) throw new Error(`bench server has no bot (${created.status}: ${created.error ?? "unknown"})`);
    }
    diag.bot = { id: bot.id, model: bot.modelSelection };
    const threadId = bot.threadId as string;
    const callId = `bench-${Date.now().toString(36)}`;
    await api("POST", `/api/bots/${bot.id}/voice/call`, { threadId, callId, state: "start", language: callLanguage });

    // what this bench sees of each turn
    let current: BenchReplyState = { text: "" };
    const transcriber = new LiveTranscriber({
      botId: bot.id,
      language: () => callLanguage,
      threadId: () => threadId,
      socket: (url) => new WebSocket(url.replace(/^ws:\/\/localhost/, origin.replace(/^http/, "ws")), { headers: { origin } }) as unknown as globalThis.WebSocket,
      transcribe: async (_botId, audio, language, thread) => {
        const query = new URLSearchParams({ language, ...(thread ? { threadId: thread } : {}) });
        const response = await fetch(`${origin}/api/bots/${bot.id}/voice/transcribe?${query}`, {
          method: "POST",
          headers: { origin, "content-type": audio.type || "audio/wav" },
          body: audio,
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
      const mine = current;
      const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          if (mine.sentAt !== undefined && mine.ttsFirstByte === undefined && chunk.byteLength) mine.ttsFirstByte = performance.now();
          controller.enqueue(chunk);
        },
      }));
      return { body, sampleRate: Number(response.headers.get("x-voice-sample-rate")) || 24_000 };
    };
    const voiceSettings = () => ({ voice: "", speed: 1, language: callLanguage }) as never;
    const speechSocket = useSocket ? new SpeechSocket({
      botId: bot.id,
      threadId: () => threadId,
      voice: voiceSettings,
      socket: (url) => new WebSocket(url.replace(/^ws:\/\/localhost/, origin.replace(/^http/, "ws")), { headers: { origin } }) as unknown as globalThis.WebSocket,
      post: speech as never,
    }) : null;
    call = new VoiceCall({
      botId: bot.id,
      threadId: () => threadId,
      voice: voiceSettings,
      settings: () => ({ ...DEFAULT_CALL_SETTINGS, onlyMyVoice: false, earcons: false, thinkingCue: false, pause: "normal", streamingVoice: useSocket, fasterEndOfTurn: fasterEnd, fullDuplex: process.env.BENCH_DUPLEX !== "0" }) as never,
      player: new ClockPlayer() as unknown as PcmPlayer,
      transcriber,
      models: async () => ({ vad: scriptedVad, embedder: null }),
      ...(speechSocket ? { speechSocket } : { speech: speech as never }),
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
    live.on("metrics", (turn) => { if (turn) metrics = mergeBenchMetrics(metrics, { ...turn } as never); });
    live.on("partial", (text) => { if (diag.partials.at(-1) !== text) diag.partials.push(text); });
    live.on("rejected", (reason) => diag.rejects.push(reason));
    live.on("error", (reason) => diag.errors.push(reason));
    let currentLang: "en" | "fr" = "en";
    const benchOwner: { current: VoiceOpenerOwner | null } = { current: null };
    live.on("utterance", (text, turnMetrics, turn) => {
      metrics = mergeBenchMetrics(metrics, { ...metrics, ...turnMetrics } as never);
      current.sentAt ??= performance.now();
      diag.utterances.push(text);
      if (turn.continues) {
        current.firstToken = undefined;
        current.ttsFirstByte = undefined;
        current.text = "";
        current.discard = true;
      }
      if (!shouldSendBenchUtterance(current, turn)) {
        benchLog("send skipped reissue");
        return;
      }
      const utteranceId = (turn as { utteranceId?: string }).utteranceId ?? `bench-${Math.random().toString(36).slice(2, 12)}`;
      benchOwner.current = { threadId, callId, utteranceId, replyStarted: false };
      void api("POST", `/api/bots/${bot.id}/messages`, {
        threadId, text, sendId: utteranceId,
        voiceCall: { callId, utteranceId, language: voiceCallMarkLanguage(currentLang), duplex: true, ...(turn.interrupted ? { interrupted: true } : {}), ...(turn.continues ? { continues: true } : {}), ...((turn as { speculative?: boolean }).speculative ? { speculative: true } : {}) },
      }).then((sent) => {
        diag.sends.push({ status: sent.status, ok: sent.ok, superseded: sent.superseded });
        benchLog(`send status=${sent.status} ok=${sent.ok}`);
      });
    });
    live.on("interrupt-bot", (target) => {
      current.discard = true;
      void api("POST", `/api/bots/${bot.id}/interrupt`, benchInterruptBody(threadId, target));
    });

    // spawnSync(`say`) blocks the event loop. Generate PCM first so the
    // SSE reader is not starved (real11: 202s, content.delta on disk,
    // firstAudio always false).
    const spoken = real ? transcripts.map((q, i) => {
      benchLog(`say ${i + 1}/${transcripts.length} ${q.lang}`);
      return holdVoiceUntilTail(pcmFrames(spokenPcm(q.text, q.lang === "fr" ? BENCH_SAY_VOICE_FR : undefined)));
    }) : [];

    const replySink: BenchReplySink = {
      progress: (text) => {
        if (text.trim() && benchOwner.current) benchOwner.current = { ...benchOwner.current, replyStarted: true };
        live.replyProgress(text);
      },
      done: (text) => { void live.replyDone(text); },
      setBusy: (busy) => live.setBotBusy(busy),
    };
    let eventsReady: (ok: boolean) => void = () => {};
    const eventsOpened = new Promise<boolean>((resolve) => { eventsReady = resolve; });
    void (async () => {
      const response = await fetch(`${origin}/api/events`, { headers: { origin }, signal: events.signal });
      if (!response.ok || !response.body) {
        diag.errors.push(`events ${response.status}`);
        benchLog(`events failed status=${response.status}`);
        eventsReady(false);
        return;
      }
      benchLog("events open");
      eventsReady(true);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          benchLog(`events closed sse=${diag.sse}`);
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        let cut;
        while ((cut = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
          if (!data) continue;
          let frame: any;
          try { frame = JSON.parse(data); } catch { continue; }
          if (frame?.kind === "voice.opener") {
            const opener = acceptVoiceOpener(benchOwner.current, frame);
            if (opener) {
              benchOwner.current = benchOwner.current ? { ...benchOwner.current, replyStarted: true } : null;
              void live.say(opener);
            }
            continue;
          }
          const event = frame?.kind === "runtime" ? frame.event : null;
          if (!applyBenchRuntimeEvent(event, threadId, current, replySink)) continue;
          diag.sse += 1;
        }
      }
    })().catch((error) => {
      const message = error instanceof Error ? error.message : "events failed";
      diag.errors.push(message);
      benchLog(`events error ${message}`);
      eventsReady(false);
    });
    const opened = await Promise.race([eventsOpened, sleep(5_000).then(() => false)]);
    if (!opened) benchLog("events not open yet");

    const started = performance.now();
    await live.start();
    diag.startMs = Math.round(performance.now() - started);
    diag.streaming = transcriber.streaming;
    if (speechSocket) diag.speechReady = await speechSocket.connect();
    benchLog(`start streaming=${diag.streaming} speechReady=${diag.speechReady}`);
    await sleep(300);
    // the microphone: real-time 32 ms frames, speech then silence
    let speaking = false;
    let speakUntil = 0;
    let stopMic = false;
    let pendingFrames: Float32Array[] = [];
    const mic = (async () => {
      const t0 = performance.now();
      for (let i = 0; !stopMic; i++) {
        await sleep(t0 + i * 32 - performance.now());
        if (pendingFrames.length) live.frame(pendingFrames.shift()!);
        else live.frame(speaking ? voicedFrame(speakUntil - performance.now()) : frame(0.03, 0.001));
      }
    })();
    for (let turn = 1; turn <= turns; turn++) {
      current = { text: "" };
      metrics = {};
      const q = transcripts[turn - 1]!;
      currentLang = q.lang;
      benchLog(`turn ${turn}/${turns} ${q.lang} begin`);
      await live.player.cancel();
      const establishedBefore = acpMethods(acpLog).filter((method) => ESTABLISH.has(method)).length;
      if (real) {
        pendingFrames = [...spoken[turn - 1]!];
        const drainUntil = performance.now() + Math.max(8_000, pendingFrames.length * 32 + 2_000);
        while (pendingFrames.length && performance.now() < drainUntil) await sleep(32);
        if (pendingFrames.length) {
          benchLog(`turn ${turn} leftover frames ${pendingFrames.length}`);
          pendingFrames = [];
        }
        await sleep(800);
      } else {
        const speakMs = q.text.split(/\s+/).length * WORD_MS;
        speakUntil = performance.now() + speakMs;
        speaking = true;
        await sleep(speakMs);
        speaking = false;
      }
      const deadline = performance.now() + (real ? 45_000 : 20_000);
      while ((metrics.firstAudioAt === undefined || metrics.firstSentenceAt === undefined) && performance.now() < deadline) {
        stampClockPlayback(metrics);
        if (metrics.firstAudioAt !== undefined && metrics.firstSentenceAt !== undefined) break;
        await sleep(20);
      }
      stampClockPlayback(metrics);
      const m = { ...metrics } as Record<string, number | undefined> & { earlyEnd?: boolean; contourEnd?: boolean; streamed?: boolean; earlyStart?: boolean; reissued?: boolean };
      stampClockPlayback(m);
      if (m.firstAudioAt !== undefined) metrics.firstAudioAt = m.firstAudioAt;
      benchLog(`turn ${turn} firstAudio=${m.firstAudioAt !== undefined} utterances=${diag.utterances.length} sse=${diag.sse} firstToken=${current.firstToken !== undefined} firstSentence=${m.firstSentenceAt !== undefined}`);
      // over the socket, the call's own first-bytes mark (the POST wrapper above sees nothing)
      current.ttsFirstByte ??= m.ttsFirstByteAt;
      const d = (a?: number, b?: number) => (a === undefined || b === undefined ? undefined : Math.round(b - a));
      const rawTotal = d(m.stoppedAt, m.firstAudioAt);
      results.push({
        turn,
        lang: transcripts[turn - 1]!.lang,
        text: transcripts[turn - 1]!.text,
        endpoint: d(m.stoppedAt, m.endedAt),
        stt: d(m.endedAt, m.transcribedAt),
        dispatch: d(m.transcribedAt, m.sentAt),
        firstToken: d(m.sentAt, current.firstToken),
        firstSentence: d(current.firstToken, m.firstSentenceAt),
        tts: d(m.firstSentenceAt, current.ttsFirstByte),
        playback: d(current.ttsFirstByte, m.firstAudioAt),
        // speculative audio before end-of-speech is a beat, not negative latency
        total: rawTotal === undefined ? undefined : Math.max(0, rawTotal),
        ...(rawTotal !== undefined && rawTotal < 0 ? { beatEosMs: -rawTotal } : {}),
        ...(rawTotal === undefined ? { incomplete: Object.keys(m) } : {}),
        ...(m.earlyEnd ? { earlyEnd: true } : {}),
        ...(m.contourEnd ? { contourEnd: true } : {}),
        ...(m.streamed ? { streamed: true } : {}),
        ...(m.earlyStart ? { earlyStart: true } : {}),
        ...(m.reissued ? { reissued: true } : {}),
        ...(engine === "grok" && !real ? { establish: acpMethods(acpLog).filter((method) => ESTABLISH.has(method)).length - establishedBefore } : {}),
      });
      // the answer plays out, then the person thinks a moment
      const idleUntil = performance.now() + (real ? 45_000 : 8_000);
      while ((live.player.busy || live.current.botBusy) && performance.now() < idleUntil) await sleep(50);
      await sleep(1_600);
      const last = results.at(-1);
      benchLog(`turn ${turn} total=${last?.total ?? "none"} endpoint=${last?.endpoint ?? "none"}`);
    }
    stopMic = true;
    await mic;
    if (transcriber.uploadError instanceof Error) diag.uploadError = transcriber.uploadError.message;
  } finally {
    events.abort();
    call?.end();
    server.child.kill("SIGTERM");
    await xai?.close();
  }
  return { engine: real ? "xai" : engine, turns: results, serverLog: server.log(), diag, ...(real ? { real: true } : {}), ...(engine === "grok" && !real ? { acp: acpMethods(acpLog) } : {}) };
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
