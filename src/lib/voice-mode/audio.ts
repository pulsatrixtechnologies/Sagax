// Pure audio helpers for voice mode: resampling the microphone to 16 kHz,
// a WAV file for xAI speech to text, and a small endpointer that decides
// when the person has finished speaking. No browser API here, so the unit
// tests cover every rule.

export const TARGET_RATE = 16_000;

/** Mix down and resample float chunks (-1..1) to 16-bit PCM at `toRate`. */
export function toPcm16(chunks: readonly Float32Array[], fromRate: number, toRate = TARGET_RATE): Int16Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  if (!total || fromRate <= 0) return new Int16Array(0);
  const joined = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  const ratio = fromRate / toRate;
  const length = Math.max(0, Math.floor(total / ratio));
  const out = new Int16Array(length);
  for (let i = 0; i < length; i++) {
    // average the source samples this output sample covers (a cheap low-pass)
    const start = Math.floor(i * ratio);
    const end = Math.min(total, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += joined[j]!;
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    out[i] = value < 0 ? Math.round(value * 0x8000) : Math.round(value * 0x7fff);
  }
  return out;
}

/** A mono 16-bit PCM WAV file. */
export function encodeWav(samples: Int16Array, rate = TARGET_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, samples[i]!, true);
  return bytes;
}

/** Root mean square of one frame, 0..1. */
export function rms(frame: Float32Array): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!;
  return Math.sqrt(sum / frame.length);
}

export interface EndpointerOptions {
  /** silence after speech that ends the turn */
  endpointMs: number;
  /** speech shorter than this is a click or a cough, not a turn */
  minSpeechMs?: number;
  /** the longest turn; it ends there even mid-sentence */
  maxTurnMs?: number;
  /** the quietest level that counts as speech, over the noise floor */
  minLevel?: number;
}

export type EndpointState = "waiting" | "speaking" | "ended";

/** Feed it one level per audio frame; it says when the turn ends. The noise
 * floor adapts while nobody speaks, so a fan or a busy room does not read
 * as an endless sentence. */
export class Endpointer {
  private readonly endpointMs: number;
  private readonly minSpeechMs: number;
  private readonly maxTurnMs: number;
  private readonly minLevel: number;
  private floor = 0.004;
  private speechMs = 0;
  private silenceMs = 0;
  private turnMs = 0;
  state: EndpointState = "waiting";

  constructor(options: EndpointerOptions) {
    this.endpointMs = options.endpointMs;
    this.minSpeechMs = options.minSpeechMs ?? 250;
    this.maxTurnMs = options.maxTurnMs ?? 45_000;
    this.minLevel = options.minLevel ?? 0.012;
  }

  /** Whether frames so far hold speech worth sending. */
  get heardSpeech(): boolean {
    return this.speechMs >= this.minSpeechMs;
  }

  feed(level: number, frameMs: number): EndpointState {
    if (this.state === "ended") return this.state;
    const threshold = Math.max(this.minLevel, this.floor * 3);
    const loud = level >= threshold;
    if (this.state === "waiting") {
      if (loud) {
        this.speechMs += frameMs;
        if (this.speechMs >= this.minSpeechMs) {
          this.state = "speaking";
          this.silenceMs = 0;
        }
      } else {
        this.speechMs = Math.max(0, this.speechMs - frameMs);
        // follow the room's level slowly while it is quiet
        this.floor = this.floor * 0.95 + level * 0.05;
      }
      return this.state;
    }
    this.turnMs += frameMs;
    if (loud) {
      this.speechMs += frameMs;
      this.silenceMs = 0;
    } else {
      this.silenceMs += frameMs;
    }
    if (this.silenceMs >= this.endpointMs || this.turnMs >= this.maxTurnMs) this.state = "ended";
    return this.state;
  }
}
