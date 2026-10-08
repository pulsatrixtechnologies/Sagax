// How the person's voice ends, on this computer: the pitch and energy of the
// last 400 ms of speech before a silence. Pure: no browser API, so the unit
// tests drive it with synthetic contours.
//
// A statement ends on a falling pitch with fading energy; a question ends on
// a clear rise. Both are finished: the turn may end on the short, confident
// silence (turns.ts `completeMs`) even when the streamed words carry no
// punctuation yet. A flat pitch held on a filler or a linking word ("euh",
// "um", "de", "pour") is a person who is not done: the turn keeps its long
// delay. Anything else (too little voiced audio, a pitch that wobbles, a
// sound cut at full energy as in the middle of a word) says nothing, and the
// endpoint stays what it was without it.
//
// The pitch is a normalized autocorrelation over 70 to 400 Hz, one estimate
// per 32 ms frame at 16 kHz; the contour is the least squares slope of the
// voiced frames' pitch in semitones over the window.

/** The window read before a silence. */
export const CONTOUR_MS = 400;

/** One frame of the person's speech: its pitch (null when unvoiced or
 * unsure) and its level (RMS). */
export interface ContourPoint {
  pitch: number | null;
  level: number;
}

export type ContourShape = "falling" | "rising" | "flat" | "unknown";

/** finished: a statement or a question that is over; unfinished: a held
 * filler; unknown: no say. */
export type ContourVerdict = "finished" | "unfinished" | "unknown";

const MIN_HZ = 70;
const MAX_HZ = 400;
/** under this RMS a frame is too quiet to carry a pitch */
const MIN_LEVEL = 0.004;
/** the autocorrelation peak a voiced frame needs */
const MIN_CLARITY = 0.6;
/** semitones from the window's median past which an estimate is an error */
const OCTAVE_SLIP = 7;

/** The pitch of one frame (Hz), or null. */
export function estimatePitch(frame: Float32Array, rate = 16_000): number | null {
  const n = frame.length;
  const minLag = Math.floor(rate / MAX_HZ);
  const maxLag = Math.min(Math.ceil(rate / MIN_HZ), Math.floor(n / 2) - 1);
  if (maxLag <= minLag) return null;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i]!;
  mean /= n;
  const x = new Float32Array(n);
  let energy = 0;
  for (let i = 0; i < n; i++) {
    x[i] = frame[i]! - mean;
    energy += x[i]! * x[i]!;
  }
  if (Math.sqrt(energy / n) < MIN_LEVEL) return null;
  const span = n - maxLag;
  const scores = new Float32Array(maxLag + 2);
  let best = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let cross = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < span; i++) {
      const u = x[i]!;
      const v = x[i + lag]!;
      cross += u * v;
      a += u * u;
      b += v * v;
    }
    const score = a > 0 && b > 0 ? cross / Math.sqrt(a * b) : 0;
    scores[lag] = score;
    if (score > best) best = score;
  }
  if (best < MIN_CLARITY) return null;
  // the shortest lag close to the best peak: avoids an octave too low
  let pick = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    const score = scores[lag]!;
    if (score >= best * 0.92 && score >= scores[lag - 1]! && score >= scores[lag + 1]!) {
      pick = lag;
      break;
    }
  }
  if (pick < 0) return null;
  // parabolic interpolation around the peak
  const left = scores[pick - 1]!;
  const mid = scores[pick]!;
  const right = scores[pick + 1]!;
  const curve = left - 2 * mid + right;
  const shift = curve < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (left - right)) / curve)) : 0;
  return rate / (pick + shift);
}

/** The last CONTOUR_MS of the voice itself: the detector keeps a turn
 * "voiced" a little after the voice stops (Silero holds), so trailing frames
 * with no pitch and almost no energy are dropped before the window is cut. */
export function endOfVoice(points: readonly ContourPoint[], frameMs = 32): ContourPoint[] {
  const peak = Math.max(0, ...points.map((point) => point.level));
  let end = points.length;
  while (end > 0 && points[end - 1]!.pitch === null && points[end - 1]!.level < peak * 0.15) end -= 1;
  const keep = Math.max(4, Math.round(CONTOUR_MS / frameMs));
  return points.slice(Math.max(0, end - keep), end);
}

/** The shape of the pitch over the window, and whether the energy fades. */
export function readContour(points: readonly ContourPoint[], frameMs = 32): { shape: ContourShape; semitones: number; fading: boolean; abrupt: boolean } {
  const unknown = { shape: "unknown" as const, semitones: 0, fading: false, abrupt: false };
  if (points.length < 4) return unknown;
  const pitched = points.map((point, index) => ({ index, pitch: point.pitch })).filter((p): p is { index: number; pitch: number } => p.pitch !== null && p.pitch > 0);
  if (pitched.length < 4) return unknown;
  const reference = pitched.map((p) => p.pitch).sort((a, b) => a - b)[Math.floor(pitched.length / 2)]!;
  // an estimate an octave off (a real voice's harmonics fool it now and
  // then) is dropped, not trusted
  const voiced = pitched.filter((p) => Math.abs(12 * Math.log2(p.pitch / reference)) <= OCTAVE_SLIP);
  // at least four pitched frames over at least 160 ms
  if (voiced.length < 4 || (voiced.at(-1)!.index - voiced[0]!.index) * frameMs < 160) return unknown;
  const xs = voiced.map((p) => p.index);
  const ys = voiced.map((p) => 12 * Math.log2(p.pitch / reference));
  const mx = xs.reduce((s, v) => s + v, 0) / xs.length;
  const my = ys.reduce((s, v) => s + v, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  // the change across the pitched part of the window
  const semitones = slope * (xs.at(-1)! - xs[0]!);
  // a pitch that jumps around (an estimate gone wrong) says nothing
  let residual = 0;
  for (let i = 0; i < xs.length; i++) residual += (ys[i]! - (my + slope * (xs[i]! - mx))) ** 2;
  const wobbly = Math.sqrt(residual / xs.length) > 2.5;
  const levels = points.map((point) => point.level);
  const peak = Math.max(...levels);
  const peakAt = levels.lastIndexOf(peak);
  // the voice fades out: its loudest frame is not in the last quarter, and
  // it ends well under it (a pause between words earlier in the window does
  // not count against it)
  const fading = peak > 0 && peakAt < levels.length * 0.75 && levels.at(-1)! < peak * 0.6 &&
    levels.slice(peakAt).every((level, i, rest) => i === 0 || level <= rest[i - 1]! * 1.25 || level < peak * 0.15);
  // the sound stopped at full strength: a word cut, not a phrase ending
  const abrupt = peak > 0 && levels.at(-1)! >= peak * 0.8;
  if (wobbly) return { shape: "unknown", semitones, fading, abrupt };
  const shape: ContourShape = semitones <= -1.5 ? "falling" : semitones >= 3 ? "rising" : Math.abs(semitones) < 1 ? "flat" : "unknown";
  return { shape, semitones, fading, abrupt };
}

/** Does the person's voice say the turn is over? `continuing`: the words so
 * far end on a filler or linking word (turns.ts). */
export function contourVerdict(points: readonly ContourPoint[], continuing: boolean, frameMs = 32): ContourVerdict {
  const { shape, fading, abrupt } = readContour(endOfVoice(points, frameMs), frameMs);
  if (shape === "unknown") return "unknown";
  // a flat, held filler: the person is looking for the next word
  if (shape === "flat") return continuing ? "unfinished" : "unknown";
  // a word cut in its middle stops at full strength: never a finished turn
  if (abrupt) return "unknown";
  // a statement: down, and fading out
  if (shape === "falling") return fading ? "finished" : "unknown";
  // a question: a clear rise (a filler raised in doubt is not one)
  return continuing ? "unknown" : "finished";
}
