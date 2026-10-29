// Composer dictation (the grey mic beside the Voice button): the words heard
// are written into the message field, never sent on their own. Two engines:
//
//   - "xai": voice mode's streaming speech to text (GET /api/bots/:id/voice/listen,
//     the xAI key of the person or the organization): the audio streams
//     while the person speaks and the words join the field as they come;
//     the stop only waits for the last ones. The whole recording is sent
//     (POST .../voice/transcribe) only when the socket cannot open. First
//     whenever an xAI key serves this person (2026-10-28): the same ears as
//     the call, with the call's keyterms and formatting, on every platform alike.
//   - "native": the macOS dictation helper (window.ogb.speechStart), whose
//     partial transcripts stream into the field as they come. Only when no
//     xAI key serves, and the mic's label says so (an announced fallback,
//     never a silent one).
//
// With neither, the mic opens the Keys card (the xAI key carries both voice
// and dictation) instead of failing in silence.
import { rms } from "./voice-mode/audio";

export type DictationEngine = "native" | "xai";

/** Which engine a composer dictates with; null opens the Keys card. */
export function dictationEngine(input: { native: boolean; xai: boolean }): DictationEngine | null {
  if (input.xai) return "xai";
  if (input.native) return "native";
  return null;
}

/** "0:04", "1:23", "12:05": the recording chip's timer. */
export function formatDictationTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** The chip's level bars: five, like the reference design's 18 px meter (2 px bars, 2 px gaps). */
export const DICTATION_BARS = 5;

/** Bar heights (0..1) for the last frames' loudness, newest on the right. A
 * quiet room still shows the bars at their 3 px floor. */
export function dictationLevels(history: readonly number[], bars = DICTATION_BARS): number[] {
  const recent = history.slice(-bars);
  const padded = [...Array.from({ length: bars - recent.length }, () => 0), ...recent];
  // speech sits around 0.02..0.2 RMS: a square root spreads it over the bar
  return padded.map((value) => Math.max(0, Math.min(1, Math.sqrt(Math.max(0, value) * 6))));
}

/** One frame's loudness, for the bars. */
export function frameLevel(frame: Float32Array): number {
  return rms(frame);
}

/** The words heard, joined to what the field held before the mic went on. */
export function joinDictated(base: string, heard: string): string {
  const words = heard.trim();
  if (!words) return base;
  return base ? `${base} ${words}` : words;
}

/** Held at least this long, a press of the mic or of its shortcut is a
 * "hold to dictate": letting go stops. Shorter, it is a tap that toggles. */
export const DICTATION_HOLD_MS = 350;

/** Whether a press that began at `at` and ends at `now` was a hold. */
export function isDictationHold(at: number, now: number): boolean {
  return now - at >= DICTATION_HOLD_MS;
}

/** What xAI's streaming speech to text hears: 16 kHz mono. */
export const DICTATION_RATE = 16_000;

/** One captured frame at 16 kHz: as is when the microphone already runs at
 * that rate, else averaged down (a cheap low-pass, enough for speech). */
export function dictationFrame(frame: Float32Array, rate: number): Float32Array {
  if (rate === DICTATION_RATE || rate <= 0) return frame;
  const ratio = rate / DICTATION_RATE;
  const length = Math.floor(frame.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(frame.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += frame[j]!;
    out[i] = sum / (end - start);
  }
  return out;
}
