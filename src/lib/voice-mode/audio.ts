// Pure audio helpers for voice mode: resampling to 16 kHz 16-bit PCM and a
// WAV file for xAI speech to text (a whole-turn upload). No browser API here.
// When a turn ends is turns.ts's job.

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
