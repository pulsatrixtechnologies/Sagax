// A voice note the person records in the composer (Grok Bot's "Record a
// voice message"). The clip is a 16 kHz mono WAV uploaded through the
// ordinary attachment store (`/api/files`), so it travels as an
// `<attached-file>` like any audio file. The words go through the same
// speech to text as dictation (`/voice/transcribe`), in clips under that
// route's size limit, and become the message's text for the bot.
import { TARGET_RATE, encodeWav } from "./voice-mode/audio";
import { VOICE_MODE_MAX_AUDIO_BYTES } from "../../shared/voice-mode";

/** Our recordings are named this way; the transcript shows them as a voice note. */
export const VOICE_NOTE_PREFIX = "voice-note-";
/** Five minutes: about 9.6 MB of WAV, under the 25 MB attachment limit. */
export const VOICE_NOTE_MAX_SECONDS = 5 * 60;
/** Bars drawn by the recorder's waveform. */
export const VOICE_NOTE_BARS = 24;
export const VOICE_NOTE_SPEEDS = [1, 1.5, 2] as const;
export type VoiceNoteSpeed = (typeof VOICE_NOTE_SPEEDS)[number];

const WAV_HEADER_BYTES = 44;

export function voiceNoteFileName(at = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${VOICE_NOTE_PREFIX}${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${pad(at.getMinutes())}${pad(at.getSeconds())}.wav`;
}

export function isVoiceNoteName(name: string): boolean {
  return /^voice-note-[0-9-]+\.wav$/i.test(name.trim());
}

/** 1x -> 1.5x -> 2x -> 1x. */
export function nextVoiceNoteSpeed(current: number): VoiceNoteSpeed {
  const index = VOICE_NOTE_SPEEDS.findIndex((speed) => speed === current);
  return VOICE_NOTE_SPEEDS[(index + 1) % VOICE_NOTE_SPEEDS.length]!;
}

export function speedLabel(speed: number): string {
  return `${speed}x`;
}

/** The waveform: the last `bars` loudness values, oldest first, scaled 0..1. */
export function waveformBars(history: readonly number[], bars = VOICE_NOTE_BARS): number[] {
  const recent = history.slice(-bars);
  const padded = [...Array.from({ length: bars - recent.length }, () => 0), ...recent];
  // speech sits around 0.02..0.2 RMS: a square root spreads it over the bar
  return padded.map((value) => Math.max(0, Math.min(1, Math.sqrt(Math.max(0, value) * 6))));
}

/** Samples per transcription clip: each WAV stays under the route's limit. */
export function transcriptionChunkSamples(maxBytes = VOICE_MODE_MAX_AUDIO_BYTES, rate = TARGET_RATE): number {
  const fit = Math.floor((maxBytes - WAV_HEADER_BYTES) / 2);
  // whole seconds keep the cut away from a word as often as chance allows
  return Math.max(rate, Math.floor(fit / rate) * rate);
}

/** The recording cut into WAV clips the transcription route accepts. */
export function transcriptionClips(samples: Int16Array, maxBytes = VOICE_MODE_MAX_AUDIO_BYTES): Uint8Array[] {
  const size = transcriptionChunkSamples(maxBytes);
  const clips: Uint8Array[] = [];
  for (let start = 0; start < samples.length; start += size) {
    clips.push(encodeWav(samples.subarray(start, Math.min(samples.length, start + size))));
  }
  return clips;
}

/** A word of a transcript with its place in the clip, in seconds. */
export interface VoiceNoteWord {
  text: string;
  start: number;
  end: number;
}

/** The word playing at `time`, or -1. */
export function wordIndexAt(words: readonly VoiceNoteWord[], time: number): number {
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    if (time >= word.start && time < word.end) return index;
  }
  return -1;
}
