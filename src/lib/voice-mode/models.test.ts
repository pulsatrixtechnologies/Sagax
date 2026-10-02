// The on-device models of a live call, run for real with onnxruntime-web
// (the same runtime and model files the app ships) on recorded fixtures:
// Silero VAD with the turn detector and the echo guard (speech, noise,
// keyboard, music, a TV across the room, the bot's own echo, a barge-in),
// the Kaldi filter bank, and CAM++ speaker verification (accept the enrolled
// voice, reject others).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import * as ort from "onnxruntime-web/wasm";
import { beforeAll, describe, expect, it } from "vitest";

import { EchoGuard } from "./echo";
import { fbank, meanNormalize } from "./fbank";
import { judge, SpeakerEmbedder, voiceprintOf, cosine, SAME_SPEAKER } from "./speaker-id";
import { FRAME_MS, TurnDetector, type TurnEvent } from "./turns";
import { SileroVad, VAD_FRAME } from "./vad";

const HERE = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => join(HERE, "fixtures", name);
const model = (name: string) => new Uint8Array(readFileSync(join(HERE, "models", name)));

/** A 16-bit mono WAV as -1..1 floats. */
function wav(name: string): Float32Array {
  const bytes = readFileSync(fixture(name));
  let offset = 12;
  while (offset < bytes.length) {
    const id = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === "data") {
      const out = new Float32Array(size / 2);
      for (let i = 0; i < out.length; i++) out[i] = bytes.readInt16LE(offset + 8 + i * 2) / 32768;
      return out;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`no data in ${name}`);
}

const RATE = 16_000;
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / Math.max(1, x.length));

/** Deterministic noise. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000 - 0.5;
  };
}

function silence(seconds: number) {
  return new Float32Array(Math.round(seconds * RATE));
}

function concat(...parts: Float32Array[]) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function scale(x: Float32Array, gain: number) {
  return Float32Array.from(x, (v) => v * gain);
}

function mix(a: Float32Array, b: Float32Array) {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

function whiteNoise(seconds: number, level: number, seed = 1) {
  const next = random(seed);
  return Float32Array.from({ length: Math.round(seconds * RATE) }, () => next() * level * 3.46);
}

/** A keyboard: short decaying clicks every 90 to 220 ms. */
function keyboard(seconds: number) {
  const out = new Float32Array(Math.round(seconds * RATE));
  const next = random(7);
  let at = 0;
  while (at < out.length) {
    for (let i = 0; i < 160 && at + i < out.length; i++) out[at + i] = next() * 0.9 * Math.exp(-i / 25);
    at += Math.round((0.09 + (next() + 0.5) * 0.13) * RATE);
  }
  return out;
}

/** Music: piano-like chords changing every 400 ms over a soft beat. */
function music(seconds: number) {
  const out = new Float32Array(Math.round(seconds * RATE));
  const chords = [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
  const next = random(11);
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    const chord = chords[Math.floor(t / 0.4) % chords.length]!;
    const since = t % 0.4;
    let v = 0;
    for (const f of chord) for (let h = 1; h <= 4; h++) v += Math.sin(2 * Math.PI * f * h * t) / (h * h);
    v *= 0.08 * Math.exp(-since * 3);
    if (since < 0.03) v += next() * 0.15 * (1 - since / 0.03);
    out[i] = v;
  }
  return out;
}

/** A room: the signal with a short reverberant tail (a TV across the room). */
function reverb(x: Float32Array, seconds = 0.25) {
  const next = random(5);
  const taps = Array.from({ length: 24 }, (_, k) => ({ at: Math.round((0.01 + (k / 24) * seconds) * RATE), gain: 0.5 * Math.exp(-k / 6) * (next() + 0.6) }));
  const out = new Float32Array(x.length + Math.round(seconds * RATE));
  for (let i = 0; i < x.length; i++) {
    out[i] += x[i]!;
    for (const tap of taps) out[i + tap.at] += x[i]! * tap.gain;
  }
  return out;
}

/** What the echo canceller leaves of the bot's voice: late, quieter, coloured. */
function echoOf(x: Float32Array, gain: number, delayMs = 48) {
  const delay = Math.round((delayMs / 1000) * RATE);
  const out = new Float32Array(x.length + delay);
  for (let i = 0; i < x.length; i++) out[i + delay] = (x[i]! + (x[i - 1] ?? 0)) * 0.5 * gain;
  return out;
}

let vad: SileroVad;
let embedder: SpeakerEmbedder;

beforeAll(async () => {
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  vad = await SileroVad.load(ort as never, model("silero-vad-v5.onnx"));
  embedder = await SpeakerEmbedder.load(ort as never, model("campplus-sv-en-int8.onnx"));
}, 60_000);

interface Run {
  events: Array<TurnEvent & { at: number }>;
  probabilities: number[];
}

/** The call's listening path, frame by frame: VAD, echo guard, turn detector. */
async function listen(mic: Float32Array, options: { playback?: Float32Array; nearLevel?: number } = {}): Promise<Run> {
  vad.reset();
  const guard = new EchoGuard();
  const turns = new TurnDetector({ nearLevel: options.nearLevel });
  const events: Run["events"] = [];
  const probabilities: number[] = [];
  for (let at = 0; at + VAD_FRAME <= mic.length; at += VAD_FRAME) {
    const frame = mic.subarray(at, at + VAD_FRAME);
    const probability = await vad.probability(frame);
    probabilities.push(probability);
    const playback = options.playback?.subarray(at, at + VAD_FRAME);
    const playbackLevel = playback && playback.length ? rms(playback) : 0;
    const level = rms(frame);
    const botAudible = playbackLevel > 0.004;
    const echo = guard.update(level, playbackLevel);
    const event = turns.feed({ probability, level, botAudible, echo });
    if (event) events.push({ ...event, at: (at / RATE) * 1000 + FRAME_MS });
  }
  return { events, probabilities };
}

const turnsOf = (run: Run) => run.events.filter((e) => e.type === "end");
const startsOf = (run: Run) => run.events.filter((e) => e.type === "start");

describe("Kaldi filter bank", () => {
  it("matches kaldi-native-fbank on a recording", () => {
    const reference = JSON.parse(readFileSync(fixture("fbank-kaldi.json"), "utf8")) as { frames: number; rows: Record<string, number[]> };
    const rows = fbank(wav("speaker-a-1.wav").subarray(0, RATE));
    expect(rows.length).toBe(reference.frames);
    for (const [index, expected] of Object.entries(reference.rows)) {
      const row = rows[Number(index)]!;
      expect(Math.max(...expected.map((value, bin) => Math.abs(value - row[bin]!)))).toBeLessThan(0.01);
    }
    const normalized = meanNormalize(rows);
    expect(Math.abs(normalized.reduce((sum, row) => sum + row[10]!, 0) / normalized.length)).toBeLessThan(1e-4);
  });
});

describe("Silero VAD and turn detection on recorded fixtures", () => {
  const speech = () => wav("speaker-a-1.wav");

  it("a person speaking then silent is one turn, ended within the endpoint", async () => {
    const audio = concat(silence(0.5), speech(), silence(1.2));
    const run = await listen(audio);
    const ends = turnsOf(run);
    expect(ends).toHaveLength(1);
    const start = startsOf(run)[0]!;
    // the voice starts at 0.5 s plus the clip's own lead-in; detected within 300 ms
    expect(start.at - (500 + firstVoiced(speech()) * 1000)).toBeLessThan(300);
    // the turn ends between the endpoint and endpoint + two frames after the speech
    const speechEnd = 500 + (speech().length / RATE) * 1000;
    const lastVoice = speechEnd - 300; // the clip's own trailing quiet
    expect(ends[0]!.at).toBeGreaterThan(lastVoice);
    expect(ends[0]!.at - speechEnd).toBeLessThan(800);
  });

  it("steady noise is never a turn", async () => {
    const run = await listen(concat(whiteNoise(3, 0.05), whiteNoise(2, 0.12, 2)));
    expect(run.events.filter((e) => e.type === "start")).toEqual([]);
  });

  it("typing on a keyboard is never a turn", async () => {
    const run = await listen(keyboard(4));
    expect(startsOf(run)).toEqual([]);
  });

  it("music is never a turn", async () => {
    const run = await listen(music(4));
    expect(startsOf(run)).toEqual([]);
  });

  it("speech over a noisy room is still a turn", async () => {
    const audio = mix(concat(silence(0.5), speech(), silence(1.2)), whiteNoise(0.5 + speech().length / RATE + 1.2, 0.01, 3));
    expect(turnsOf(await listen(audio))).toHaveLength(1);
  });

  it("a TV across the room is not a turn once the person's level is known", async () => {
    const near = rms(speech());
    const tv = reverb(scale(wav("speaker-b-2.wav"), 0.12));
    const room = mix(tv, whiteNoise(tv.length / RATE, 0.003, 4));
    const run = await listen(room, { nearLevel: near });
    expect(startsOf(run)).toEqual([]);
    // and the person, close to the microphone, still is
    const both = mix(room, concat(silence(0.4), speech()));
    expect(startsOf(await listen(both, { nearLevel: near })).length).toBeGreaterThan(0);
  });

  it("the bot's own voice coming back (echo residue) never interrupts it", async () => {
    const bot = scale(wav("speaker-c-2.wav"), 0.6);
    const mic = echoOf(bot, 0.12);
    const run = await listen(mic, { playback: bot });
    expect(startsOf(run)).toEqual([]);
  });

  it("the person talking over the bot is a barge-in, detected within 250 ms", async () => {
    const bot = scale(wav("speaker-c-2.wav"), 0.6);
    const person = concat(silence(1.0), speech());
    const mic = mix(echoOf(bot, 0.12), person);
    const run = await listen(mic, { playback: bot });
    const candidate = run.events.find((e) => e.type === "candidate" && e.bargeIn);
    const start = startsOf(run).find((e) => e.bargeIn);
    expect(candidate).toBeDefined();
    expect(start).toBeDefined();
    // the person starts at 1.0 s (the clip's first voiced frame is a little later)
    const onset = 1000 + firstVoiced(speech()) * 1000;
    expect(candidate!.at - onset).toBeLessThan(150);
    expect(start!.at - onset).toBeLessThan(250);
  });
});

/** Seconds into a clip where its voice starts (level over 15 % of its peak frame). */
function firstVoiced(x: Float32Array): number {
  let peak = 0;
  const levels: number[] = [];
  for (let at = 0; at + VAD_FRAME <= x.length; at += VAD_FRAME) {
    const level = rms(x.subarray(at, at + VAD_FRAME));
    levels.push(level);
    peak = Math.max(peak, level);
  }
  return Math.max(0, levels.findIndex((level) => level > peak * 0.15)) * (VAD_FRAME / RATE);
}

describe("speaker verification (Only my voice)", () => {
  it("accepts the enrolled person and rejects two other people", async () => {
    const enrolled = await Promise.all(["speaker-a-1.wav", "speaker-a-2.wav"].map((name) => embedder.embed(wav(name))));
    const print = voiceprintOf(enrolled as Float32Array[], 0.05);
    const verdict = async (name: string) => {
      const audio = wav(name);
      return judge(print, await embedder.embed(audio), audio.length / RATE);
    };
    const same = await verdict("speaker-a-3.wav");
    expect(same.accepted).toBe(true);
    expect(same.similarity!).toBeGreaterThanOrEqual(SAME_SPEAKER);
    for (const other of ["speaker-b-1.wav", "speaker-b-2.wav", "speaker-c-1.wav", "speaker-c-2.wav"]) {
      const result = await verdict(other);
      expect(result.accepted, `${other} ${result.similarity}`).toBe(false);
      expect(result.reason).toBe("other-voice");
    }
  });

  it("separates people on one-second clips with the short-turn bar", async () => {
    const enrolled = await Promise.all(["speaker-a-1.wav", "speaker-a-2.wav"].map((name) => embedder.embed(wav(name))));
    const print = voiceprintOf(enrolled as Float32Array[], 0.05);
    const clip = (name: string) => wav(name).subarray(RATE / 2, RATE / 2 + RATE * 1.2);
    const same = judge(print, await embedder.embed(clip("speaker-a-3.wav")), 1.2);
    expect(same.accepted, String(same.similarity)).toBe(true);
    const other = judge(print, await embedder.embed(clip("speaker-b-2.wav")), 1.2);
    expect(other.accepted, String(other.similarity)).toBe(false);
  });

  it("a turn too short to judge is accepted (a yes, a stop)", async () => {
    const print = voiceprintOf([new Float32Array(512).fill(1)], 0.05);
    expect(judge(print, null, 0.3)).toMatchObject({ accepted: true, reason: "too-short" });
  });

  it("embeddings are stable for the same clip", async () => {
    const a = await embedder.embed(wav("speaker-b-1.wav"));
    const b = await embedder.embed(wav("speaker-b-1.wav"));
    expect(cosine(a!, b!)).toBeGreaterThan(0.999);
  });
});
