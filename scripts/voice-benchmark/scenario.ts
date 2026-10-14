// The 32-turn bilingual acceptance script and its generated microphone audio.
// Synthetic PCM is deterministic and carries the VAD probability in the first
// sample, the same contract as the latency bench. Live mode shells espeak-ng
// and ffmpeg with argument arrays; it never interpolates a shell string.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { VAD_FRAME } from "../../src/lib/voice-mode/vad.ts";
import type { VoiceBenchFixtureTiming, VoiceBenchLanguage } from "./model.ts";

export type VoiceScenarioKind =
  | "ordinary"
  | "interrupt-thinking"
  | "interrupt-speaking"
  | "correction"
  | "concurrent-topic"
  | "tool"
  | "stop";

export interface VoiceScenarioTurn {
  id: string;
  language: VoiceBenchLanguage;
  kind: VoiceScenarioKind;
  topicId: string;
  text: string;
  expected: "complete" | "cancelled";
  warmup?: boolean;
  /** Another topic that must also finish. Spoken answers stay serial. */
  concurrentWith?: string;
}

export const VOICE_ACCEPTANCE_SCRIPT_REVISION = "voice-acceptance-2026-10-12";

/** Fixture delays for the synthetic profile. They are part of the contract,
 * not a claim about a live provider. */
export const SYNTHETIC_VOICE_DELAYS = {
  endpointDelayMs: 40,
  sttFinalDelayMs: 30,
  llmFirstTokenDelayMs: 40,
  ttsFirstByteDelayMs: 20,
  audioStartDelayMs: 15,
} as const satisfies Omit<VoiceBenchFixtureTiming, "scriptRevision">;

const SCRIPT: readonly VoiceScenarioTurn[] = [
  { id: "u00", language: "en", kind: "ordinary", topicId: "warmup", text: "Say hello.", expected: "complete", warmup: true },
  { id: "u01", language: "fr-CA", kind: "ordinary", topicId: "seq", text: "Quelle heure est-il?", expected: "complete" },
  { id: "u02", language: "en", kind: "ordinary", topicId: "seq", text: "How is the weather?", expected: "complete" },
  { id: "u03", language: "fr-CA", kind: "ordinary", topicId: "seq", text: "Dis bonjour.", expected: "complete" },
  { id: "u04", language: "en", kind: "ordinary", topicId: "seq", text: "What is two plus two?", expected: "complete" },
  { id: "u05", language: "fr-CA", kind: "ordinary", topicId: "seq", text: "Quel temps fait-il?", expected: "complete" },
  { id: "u06", language: "en", kind: "ordinary", topicId: "seq", text: "Say hello again.", expected: "complete" },
  { id: "u07", language: "en", kind: "interrupt-thinking", topicId: "think", text: "Tell me a long story about the river.", expected: "cancelled" },
  { id: "u08", language: "en", kind: "ordinary", topicId: "think-next", text: "What time is it?", expected: "complete" },
  { id: "u09", language: "fr-CA", kind: "interrupt-speaking", topicId: "speak", text: "Décris la météo en détail s'il te plaît.", expected: "cancelled" },
  { id: "u10", language: "fr-CA", kind: "ordinary", topicId: "speak-next", text: "Laisse faire la météo.", expected: "complete" },
  { id: "u11", language: "en", kind: "ordinary", topicId: "corr-setup", text: "What time is it in Montreal?", expected: "complete" },
  { id: "u12", language: "en", kind: "correction", topicId: "corr", text: "No, I meant Toronto.", expected: "complete" },
  { id: "u13", language: "en", kind: "concurrent-topic", topicId: "topic-a", text: "What time is it in Tokyo?", expected: "complete", concurrentWith: "topic-b" },
  { id: "u14", language: "fr-CA", kind: "concurrent-topic", topicId: "topic-b", text: "Quelle heure est-il à Paris?", expected: "complete" },
  { id: "u15", language: "en", kind: "tool", topicId: "tool", text: "Check the open ticket count.", expected: "complete" },
  { id: "u16", language: "en", kind: "ordinary", topicId: "stop-target", text: "Tell me about the harbour.", expected: "cancelled" },
  { id: "u17", language: "en", kind: "stop", topicId: "stop", text: "Stop that please.", expected: "complete" },
  { id: "u18", language: "fr-CA", kind: "ordinary", topicId: "tail", text: "Combien font deux plus deux?", expected: "complete" },
  { id: "u19", language: "en", kind: "ordinary", topicId: "tail", text: "Remind me of the next meeting.", expected: "complete" },
  { id: "u20", language: "fr-CA", kind: "ordinary", topicId: "tail", text: "Résume le dernier billet.", expected: "complete" },
  { id: "u21", language: "en", kind: "ordinary", topicId: "tail", text: "How far is Quebec City?", expected: "complete" },
  { id: "u22", language: "fr-CA", kind: "ordinary", topicId: "tail", text: "Est-ce qu'il pleut?", expected: "complete" },
  { id: "u23", language: "en", kind: "ordinary", topicId: "tail", text: "Tell me a short joke.", expected: "complete" },
  { id: "u24", language: "fr-CA", kind: "ordinary", topicId: "tail", text: "Parle-moi du café.", expected: "complete" },
  { id: "u25", language: "en", kind: "ordinary", topicId: "tail", text: "What day is it?", expected: "complete" },
  { id: "u26", language: "fr-CA", kind: "ordinary", topicId: "tail", text: "Où est la gare?", expected: "complete" },
  { id: "u27", language: "en", kind: "ordinary", topicId: "tail", text: "Open the notes.", expected: "complete" },
  { id: "u28", language: "fr-CA", kind: "ordinary", topicId: "tail", text: "Merci, c'est tout.", expected: "complete" },
  { id: "u29", language: "en", kind: "ordinary", topicId: "tail", text: "Say goodbye.", expected: "complete" },
  { id: "u30", language: "fr-CA", kind: "ordinary", topicId: "tail", text: "À la prochaine.", expected: "complete" },
  { id: "u31", language: "en", kind: "ordinary", topicId: "tail", text: "That will do.", expected: "complete" },
];

export const VOICE_ACCEPTANCE_SCRIPT: readonly VoiceScenarioTurn[] = SCRIPT;

export function scenarioLanguages(script: readonly VoiceScenarioTurn[] = SCRIPT): Set<VoiceBenchLanguage> {
  return new Set(script.map((turn) => turn.language));
}

export function scenarioKinds(script: readonly VoiceScenarioTurn[] = SCRIPT): Set<VoiceScenarioKind> {
  return new Set(script.map((turn) => turn.kind));
}

const SAMPLE_RATE = 16_000;

function pitchFor(language: VoiceBenchLanguage): { base: number; low: number } {
  return language === "fr-CA" ? { base: 188, low: 132 } : { base: 165, low: 118 };
}

function toneFrame(hz: number, amplitude: number, phase: { value: number }, voiced: boolean): Float32Array {
  const out = new Float32Array(VAD_FRAME);
  if (!voiced) {
    out.fill(0.001);
    out[0] = 0.03 / 1000;
    return out;
  }
  for (let i = 0; i < VAD_FRAME; i++) {
    phase.value += (2 * Math.PI * hz) / SAMPLE_RATE;
    out[i] = amplitude * Math.sin(phase.value);
  }
  out[0] = 0.92 / 1000;
  return out;
}

/** Language-specific pitch and cadence at 16 kHz. The first sample is the
 * scripted VAD probability. The same turn always yields the same frames. */
export function syntheticVoiceFrames(turn: VoiceScenarioTurn): Float32Array[] {
  const { base, low } = pitchFor(turn.language);
  const words = turn.text.trim().split(/\s+/).filter(Boolean).length;
  const steady = Math.max(8, words * 2);
  const falling = 12;
  const quiet = 4;
  const phase = { value: 0 };
  const frames: Float32Array[] = [];
  for (let i = 0; i < steady; i++) frames.push(toneFrame(base, 0.08, phase, true));
  for (let i = 0; i < falling; i++) {
    const t = falling === 1 ? 1 : i / (falling - 1);
    const hz = base * (low / base) ** t;
    const amplitude = 0.08 * (1 - 0.75 * t);
    frames.push(toneFrame(hz, amplitude, phase, true));
  }
  for (let i = 0; i < quiet; i++) frames.push(toneFrame(0, 0, phase, false));
  return frames;
}

export function hashFrames(frames: readonly Float32Array[]): string {
  const hash = createHash("sha256");
  for (const frame of frames) hash.update(Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength));
  return hash.digest("hex");
}

export interface LiveVoiceCommand {
  command: string;
  args: string[];
}

export function liveVoiceCommand(
  turn: VoiceScenarioTurn,
  outputWav: string,
  bins: { espeak: string; ffmpeg?: string },
): LiveVoiceCommand[] {
  if (!bins.espeak) throw new Error("espeak-ng is required");
  const ffmpeg = bins.ffmpeg ?? "ffmpeg";
  if (!ffmpeg) throw new Error("ffmpeg is required");
  const voice = turn.language === "fr-CA" ? "fr-ca" : "en-us";
  const raw = outputWav.replace(/\.wav$/i, "") + ".espeak.wav";
  return [
    { command: bins.espeak, args: ["-v", voice, "-w", raw, "--", turn.text] },
    { command: ffmpeg, args: ["-y", "-loglevel", "error", "-i", raw, "-ar", "16000", "-ac", "1", outputWav] },
  ];
}

function runCommand(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (${code ?? "signal"}): ${stderr.slice(0, 400)}`));
    });
  });
}

/** Speak one scripted turn into an isolated 16 kHz mono WAV. */
export async function generateLiveVoiceFixture(turn: VoiceScenarioTurn, outputDir: string): Promise<string> {
  mkdirSync(outputDir, { recursive: true });
  const outputWav = join(outputDir, `${turn.id}.wav`);
  const steps = liveVoiceCommand(turn, outputWav, {
    espeak: process.env.SAGAX_ESPEAK?.trim() || "espeak-ng",
    ffmpeg: process.env.SAGAX_FFMPEG?.trim() || "ffmpeg",
  });
  for (const step of steps) await runCommand(step.command, step.args);
  return outputWav;
}
