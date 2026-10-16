import { describe, expect, it } from "vitest";

import { VOICE_MODE_MAX_AUDIO_BYTES } from "../../shared/voice-mode";
import { TARGET_RATE } from "./voice-mode/audio";
import {
  isVoiceNoteName,
  nextVoiceNoteSpeed,
  speedLabel,
  transcriptionChunkSamples,
  transcriptionClips,
  voiceNoteFileName,
  waveformBars,
  wordIndexAt,
  VOICE_NOTE_BARS,
} from "./voice-note";

describe("voice notes", () => {
  it("names a recording so the transcript knows it is a voice note", () => {
    const name = voiceNoteFileName(new Date(2026, 9, 16, 9, 3, 7));
    expect(name).toBe("voice-note-20261016-090307.wav");
    expect(isVoiceNoteName(name)).toBe(true);
    expect(isVoiceNoteName("meeting.wav")).toBe(false);
    expect(isVoiceNoteName("voice-note-<script>.wav")).toBe(false);
  });

  it("cycles 1x, 1.5x, 2x", () => {
    expect(nextVoiceNoteSpeed(1)).toBe(1.5);
    expect(nextVoiceNoteSpeed(1.5)).toBe(2);
    expect(nextVoiceNoteSpeed(2)).toBe(1);
    expect(nextVoiceNoteSpeed(3)).toBe(1);
    expect(speedLabel(1.5)).toBe("1.5x");
  });

  it("cuts a long recording into clips the transcription route accepts", () => {
    const perClip = transcriptionChunkSamples();
    expect(44 + perClip * 2).toBeLessThanOrEqual(VOICE_MODE_MAX_AUDIO_BYTES);
    expect(perClip % TARGET_RATE).toBe(0);
    const samples = new Int16Array(perClip * 2 + 100);
    const clips = transcriptionClips(samples);
    expect(clips).toHaveLength(3);
    for (const clip of clips) expect(clip.byteLength).toBeLessThanOrEqual(VOICE_MODE_MAX_AUDIO_BYTES);
    expect(clips[2]!.byteLength).toBe(44 + 200);
    expect(transcriptionClips(new Int16Array(0))).toEqual([]);
  });

  it("draws the waveform from the latest levels, oldest first", () => {
    const bars = waveformBars([0.5, 1, 0]);
    expect(bars).toHaveLength(VOICE_NOTE_BARS);
    expect(bars.slice(0, VOICE_NOTE_BARS - 3).every((bar) => bar === 0)).toBe(true);
    expect(bars.at(-2)).toBe(1);
  });

  it("finds the word playing", () => {
    const words = [{ text: "bonjour", start: 0, end: 0.6 }, { text: "JC", start: 0.7, end: 1.1 }];
    expect(wordIndexAt(words, 0.3)).toBe(0);
    expect(wordIndexAt(words, 0.65)).toBe(-1);
    expect(wordIndexAt(words, 0.9)).toBe(1);
  });
});
