// Kaldi-compatible log mel filter bank features (80 bins up to 8 kHz, 25 ms windows every
// 10 ms, Povey window, pre-emphasis 0.97, no dither, snip_edges), the input
// the speaker embedding model (speaker-id.ts, 3D-Speaker CAM++) was trained
// on, with its global mean normalization. Pure; checked against
// kaldi-native-fbank in fbank.test.ts.

const RATE = 16_000;
const FRAME = 400;
const SHIFT = 160;
const FFT = 512;
const BINS = 80;
const LOW_HZ = 20;
const HIGH_HZ = RATE / 2;
const PREEMPH = 0.97;

const mel = (hz: number) => 1127 * Math.log(1 + hz / 700);

let cache: { window: Float64Array; banks: Array<{ start: number; weights: Float64Array }>; cos: Float64Array; sin: Float64Array; rev: Uint32Array } | null = null;

function tables() {
  if (cache) return cache;
  const window = new Float64Array(FRAME);
  for (let i = 0; i < FRAME; i++) window[i] = Math.pow(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)), 0.85);
  const melLow = mel(LOW_HZ);
  const melHigh = mel(HIGH_HZ);
  const delta = (melHigh - melLow) / (BINS + 1);
  const fftBin = RATE / FFT;
  const banks: Array<{ start: number; weights: Float64Array }> = [];
  for (let b = 0; b < BINS; b++) {
    const left = melLow + b * delta;
    const center = left + delta;
    const right = center + delta;
    let start = -1;
    const weights: number[] = [];
    for (let k = 0; k < FFT / 2; k++) {
      const m = mel(fftBin * k);
      if (m <= left || m >= right) continue;
      if (start < 0) start = k;
      weights[k - start] = m <= center ? (m - left) / (center - left) : (right - m) / (right - center);
    }
    banks.push({ start: Math.max(0, start), weights: Float64Array.from(weights) });
  }
  const cos = new Float64Array(FFT / 2);
  const sin = new Float64Array(FFT / 2);
  for (let i = 0; i < FFT / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / FFT);
    sin[i] = -Math.sin((2 * Math.PI * i) / FFT);
  }
  const bits = Math.log2(FFT);
  const rev = new Uint32Array(FFT);
  for (let i = 0; i < FFT; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
    rev[i] = r;
  }
  cache = { window, banks, cos, sin, rev };
  return cache;
}

/** In place radix-2 FFT of a real frame (imaginary part zero). */
function fft(re: Float64Array, im: Float64Array): void {
  const { cos, sin, rev } = tables();
  for (let i = 0; i < FFT; i++) {
    const j = rev[i]!;
    if (j > i) {
      const t = re[i]!;
      re[i] = re[j]!;
      re[j] = t;
    }
  }
  im.fill(0);
  for (let size = 2; size <= FFT; size <<= 1) {
    const half = size >> 1;
    const step = FFT / size;
    for (let start = 0; start < FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const c = cos[k * step]!;
        const s = sin[k * step]!;
        const a = start + k;
        const b = a + half;
        const tr = re[b]! * c - im[b]! * s;
        const ti = re[b]! * s + im[b]! * c;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
      }
    }
  }
}

/** Log mel features of 16 kHz samples (-1..1), one Float32Array(80) per 10 ms. */
export function fbank(samples: Float32Array): Float32Array[] {
  const { window, banks } = tables();
  if (samples.length < FRAME) return [];
  const frames = 1 + Math.floor((samples.length - FRAME) / SHIFT);
  const out: Float32Array[] = [];
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  const frame = new Float64Array(FRAME);
  const power = new Float64Array(FFT / 2 + 1);
  for (let f = 0; f < frames; f++) {
    const offset = f * SHIFT;
    let mean = 0;
    // samples stay in -1..1 (the model's normalize_samples)
    for (let i = 0; i < FRAME; i++) {
      frame[i] = samples[offset + i]!;
      mean += frame[i]!;
    }
    mean /= FRAME;
    for (let i = 0; i < FRAME; i++) frame[i] = frame[i]! - mean;
    for (let i = FRAME - 1; i > 0; i--) frame[i] = frame[i]! - PREEMPH * frame[i - 1]!;
    frame[0] = frame[0]! - PREEMPH * frame[0]!;
    re.fill(0);
    for (let i = 0; i < FRAME; i++) re[i] = frame[i]! * window[i]!;
    fft(re, im);
    for (let k = 0; k <= FFT / 2; k++) power[k] = re[k]! * re[k]! + im[k]! * im[k]!;
    const row = new Float32Array(BINS);
    for (let b = 0; b < BINS; b++) {
      const bank = banks[b]!;
      let energy = 0;
      for (let j = 0; j < bank.weights.length; j++) energy += bank.weights[j]! * power[bank.start + j]!;
      row[b] = Math.log(Math.max(energy, 1.1920928955078125e-7));
    }
    out.push(row);
  }
  return out;
}

/** Subtract each bin's mean over time (the model's `global-mean`). */
export function meanNormalize(rows: Float32Array[]): Float32Array[] {
  if (!rows.length) return rows;
  const mean = new Float64Array(BINS);
  for (const row of rows) for (let b = 0; b < BINS; b++) mean[b] += row[b]!;
  for (let b = 0; b < BINS; b++) mean[b] /= rows.length;
  return rows.map((row) => Float32Array.from(row, (value, b) => value - mean[b]!));
}
