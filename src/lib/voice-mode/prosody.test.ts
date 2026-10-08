// The end of turn on intonation (docs/voice-mode-xai.md, Latency): the pitch
// estimate, the contour classifier on synthetic contours (falling, rising,
// flat filler, mid-word), and the turn detector using it (a short end with
// no punctuation, a long one on a held filler, never mid-word, never on an
// unsure silence, never in Patient).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { contourVerdict, endOfVoice, estimatePitch, readContour, type ContourPoint } from "./prosody";
import { endsOnContinuingWord, frenchEnding, PAUSE_PRESETS, TurnDetector, type TurnEvent } from "./turns";

const RATE = 16_000;
const FRAME = 512;

/** A voice-like frame: a fundamental and two harmonics, phase continuous. */
function voiceFrames(contour: Array<{ hz: number; level: number }>): Float32Array[] {
  let phase = 0;
  return contour.map(({ hz, level }) => {
    const out = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) {
      phase += (2 * Math.PI * hz) / RATE;
      out[i] = level * (Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.25 * Math.sin(3 * phase)) / 1.75;
    }
    return out;
  });
}

/** n frames from `from` to `to` Hz, level from `a` to `b`. */
function glide(n: number, from: number, to: number, a: number, b: number): Array<{ hz: number; level: number }> {
  return Array.from({ length: n }, (_, i) => {
    const t = n === 1 ? 1 : i / (n - 1);
    return { hz: from * (to / from) ** t, level: a + (b - a) * t };
  });
}

const points = (contour: Array<{ hz: number; level: number }>): ContourPoint[] =>
  voiceFrames(contour).map((frame, i) => ({ pitch: estimatePitch(frame), level: contour[i]!.level * 0.62 }));

describe("pitch estimate", () => {
  it("finds the fundamental of a voice-like frame within a few percent", () => {
    for (const hz of [90, 120, 180, 240, 320]) {
      const [frame] = voiceFrames([{ hz, level: 0.2 }]);
      const pitch = estimatePitch(frame!);
      expect(pitch, String(hz)).not.toBeNull();
      expect(Math.abs(pitch! - hz) / hz, String(hz)).toBeLessThan(0.04);
    }
  });

  it("says nothing for silence, a flat level, or noise", () => {
    expect(estimatePitch(new Float32Array(FRAME))).toBeNull();
    expect(estimatePitch(new Float32Array(FRAME).fill(0.05))).toBeNull();
    let seed = 7;
    const noise = new Float32Array(FRAME).map(() => {
      seed = (seed * 16807) % 2147483647;
      return (seed / 2147483647 - 0.5) * 0.2;
    });
    expect(estimatePitch(noise)).toBeNull();
  });
});

describe("contour classifier (synthetic contours)", () => {
  it("a statement: the pitch falls and the voice fades out: finished", () => {
    const falling = points(glide(12, 190, 130, 0.25, 0.06));
    expect(readContour(falling).shape).toBe("falling");
    expect(contourVerdict(falling, false)).toBe("finished");
  });

  it("a question: a clear rise: finished", () => {
    const rising = points(glide(12, 150, 260, 0.22, 0.12));
    expect(readContour(rising).shape).toBe("rising");
    expect(contourVerdict(rising, false)).toBe("finished");
    // a filler raised in doubt is not a question
    expect(contourVerdict(rising, true)).toBe("unknown");
  });

  it("a flat pitch held on a filler: unfinished; on another word: no say", () => {
    const flat = points(glide(12, 160, 162, 0.2, 0.18));
    expect(readContour(flat).shape).toBe("flat");
    expect(contourVerdict(flat, true)).toBe("unfinished");
    expect(contourVerdict(flat, false)).toBe("unknown");
  });

  it("mid-word: a falling pitch cut at full strength is never finished", () => {
    const cut = points(glide(12, 190, 130, 0.12, 0.25));
    expect(readContour(cut).abrupt).toBe(true);
    expect(contourVerdict(cut, false)).toBe("unknown");
  });

  it("a fall without the voice fading out says nothing", () => {
    const even = points([...glide(8, 190, 140, 0.2, 0.2), ...glide(4, 140, 130, 0.2, 0.15)]);
    expect(contourVerdict(even, false)).toBe("unknown");
  });

  it("too little voiced audio says nothing", () => {
    expect(contourVerdict(points(glide(3, 190, 130, 0.25, 0.06)), false)).toBe("unknown");
    expect(contourVerdict(Array.from({ length: 12 }, () => ({ pitch: null, level: 0.1 })), false)).toBe("unknown");
  });
});

describe("the words' ending", () => {
  it("knows fillers and linking words, and French endings worth a shorter wait", () => {
    expect(endsOnContinuingWord("je voudrais euh")).toBe(true);
    expect(endsOnContinuingWord("give me a prompt to")).toBe(true);
    expect(endsOnContinuingWord("what time is it")).toBe(false);
    expect(frenchEnding("on se voit demain puis")).toBe(true);
    expect(frenchEnding("je voudrais euh")).toBe(false);
    expect(frenchEnding("give me a prompt to")).toBe(false);
    expect(frenchEnding("je pense que,")).toBe(false);
  });
});

/** The detector fed a spoken turn: `contour` frames voiced (VAD 0.95),
 * then silence at `quiet` probability. Returns the end event and when. */
function speak(detector: TurnDetector, contour: Array<{ hz: number; level: number }>, options: { words?: string; quiet?: number; silenceFrames?: number; lead?: number } = {}) {
  const lead = options.lead ?? 20;
  const frames = voiceFrames([...glide(lead, 170, 175, 0.2, 0.2), ...contour]);
  let event: TurnEvent | null = null;
  for (const frame of frames) {
    let sum = 0;
    for (const v of frame) sum += v * v;
    const level = Math.sqrt(sum / frame.length);
    detector.feed({ probability: 0.95, level, pitch: estimatePitch(frame) });
    if (options.words !== undefined) detector.hint(options.words);
  }
  let silentMs = 0;
  for (let i = 0; i < (options.silenceFrames ?? 60) && !event; i++) {
    event = detector.feed({ probability: options.quiet ?? 0.02, level: 0.001, pitch: null });
    silentMs += 32;
  }
  return { event, silentMs };
}

const normal = () => new TurnDetector({ ...PAUSE_PRESETS.normal, prosody: true });

describe("end of turn on intonation (Faster end of turn)", () => {
  it("ends a falling, fading statement on the short window with no punctuation at all", () => {
    const { event, silentMs } = speak(normal(), glide(12, 190, 130, 0.25, 0.05), { words: "I want the report for Montreal" });
    expect(event).toMatchObject({ type: "end", early: true, onContour: true, contour: "finished" });
    expect(silentMs).toBe(352);
  });

  it("ends a rising question the same way", () => {
    const { event, silentMs } = speak(normal(), glide(12, 150, 270, 0.22, 0.1), { words: "is it raining in Quebec" });
    expect(event).toMatchObject({ type: "end", early: true, onContour: true });
    expect(silentMs).toBe(352);
  });

  it("keeps the long delay on a flat filler, even with no words yet", () => {
    const { event, silentMs } = speak(normal(), glide(12, 160, 161, 0.2, 0.18), { words: "je voudrais euh" });
    expect(event).toMatchObject({ type: "end", contour: "unfinished" });
    expect(event?.type === "end" && event.early).toBeFalsy();
    expect(silentMs).toBeGreaterThanOrEqual(700 + PAUSE_PRESETS.normal.incompleteMs);
  });

  it("never ends mid-word: a contour cut at full strength waits the normal endpoint", () => {
    const { event, silentMs } = speak(normal(), glide(12, 190, 130, 0.12, 0.26), { words: "I want the report for Montreal" });
    expect(event?.type === "end" && event.onContour).toBeFalsy();
    expect(silentMs).toBeGreaterThan(352);
  });

  it("never ends on an unsure silence: the VAD must stay under 0.15 the whole short window", () => {
    const { event, silentMs } = speak(normal(), glide(12, 190, 130, 0.25, 0.05), { words: "I want the report for Montreal", quiet: 0.2 });
    expect(event?.type === "end" && event.early).toBeFalsy();
    expect(silentMs).toBeGreaterThan(352);
  });

  it("an unfinished clause in English is not shortened by its contour", () => {
    const { event, silentMs } = speak(normal(), glide(12, 190, 130, 0.25, 0.05), { words: "give me a good prompt to" });
    expect(event?.type === "end" && event.early).toBeFalsy();
    expect(silentMs).toBeGreaterThanOrEqual(700 + PAUSE_PRESETS.normal.incompleteMs);
  });

  it("a French linking word on a finished contour waits half the extra delay", () => {
    const { silentMs } = speak(normal(), glide(12, 190, 130, 0.25, 0.05), { words: "on se voit demain puis" });
    expect(silentMs).toBeGreaterThanOrEqual(700 + PAUSE_PRESETS.normal.incompleteMs / 2);
    expect(silentMs).toBeLessThan(700 + PAUSE_PRESETS.normal.incompleteMs);
  });

  it("off (the switch, or Patient): the contour changes nothing", () => {
    const off = new TurnDetector({ ...PAUSE_PRESETS.normal });
    const { event, silentMs } = speak(off, glide(12, 190, 130, 0.25, 0.05), { words: "I want the report for Montreal" });
    expect(event).toMatchObject({ type: "end" });
    expect(event?.type === "end" && (event.early || event.contour)).toBeFalsy();
    expect(silentMs).toBe(704);
    const patient = new TurnDetector({ ...PAUSE_PRESETS.patient });
    const late = speak(patient, glide(12, 190, 130, 0.25, 0.05), { words: "I want the report for Montreal" });
    expect(late.silentMs).toBe(1024);
  });
});

describe("real voices", () => {
  it("a recorded statement's end reads finished, and the VAD's hold after it does not hide it", () => {
    const wav = readFileSync(fileURLToPath(new URL("./fixtures/speaker-a-1.wav", import.meta.url)));
    const at = wav.indexOf("data") + 8;
    const pcm = new Int16Array(wav.buffer.slice(wav.byteOffset + at, wav.byteOffset + at + Math.floor((wav.length - at) / 2) * 2));
    const frames: ContourPoint[] = [];
    for (let i = 0; i + FRAME <= pcm.length; i += FRAME) {
      const frame = Float32Array.from(pcm.subarray(i, i + FRAME), (v) => v / 32768);
      frames.push({ pitch: estimatePitch(frame), level: Math.sqrt(frame.reduce((sum, v) => sum + v * v, 0) / FRAME) });
    }
    let last = frames.length - 1;
    while (last > 0 && frames[last]!.level < 0.01) last -= 1;
    for (const hold of [0, 3, 6]) expect(contourVerdict(frames.slice(last - 24 + hold, last + 1 + hold), false), `hold ${hold}`).toBe("finished");
  });

  it("the same sentence through Chromium's voice processing (frames seen by verify-voice-mode): finished despite octave slips and a pause between words", () => {
    const seen: Array<[number, number | null]> = [[0.038, 166], [0.038, 158], [0.05, null], [0.356, 210], [0.35, 209], [0.341, 213], [0.153, 212], [0.051, null], [0.073, null], [0.05, null], [0.213, 177], [0.269, 167], [0.326, 312], [0.459, 357], [0.417, 192], [0.361, 196], [0.257, 189], [0.208, 159], [0.1, null], [0.045, null], [0.031, null], [0.01, null], [0.012, null]];
    const points = seen.map(([level, pitch]) => ({ level, pitch }));
    expect(endOfVoice(points).at(-1)).toEqual({ level: 0.1, pitch: null });
    expect(readContour(endOfVoice(points))).toMatchObject({ shape: "falling", fading: true, abrupt: false });
    expect(contourVerdict(points, false)).toBe("finished");
  });
});
