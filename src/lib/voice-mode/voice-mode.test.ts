import { describe, expect, it, vi } from "vitest";

import { USER_PREFERENCE_KEYS } from "../../../shared/user-preferences";
import { DEFAULT_VOICE_MODE_SETTINGS, VOICE_MODE_STORAGE_KEY, cleanVoiceModeSettings, sttLanguage, ttsLanguage } from "../../../shared/voice-mode";
import { VoiceModeRefused } from "./api";
import { Endpointer, encodeWav, toPcm16 } from "./audio";
import { XaiSpeechEngine, type SpeechEndInfo, type TranscriptLine } from "./engine";
import { readVoiceModeSettings, speedLabel, writeVoiceModeSettings } from "./settings";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("voice mode settings", () => {
  it("defaults to Not set, 1x, Auto-detect", () => {
    expect(readVoiceModeSettings(memoryStorage())).toEqual({ voice: "", speed: 1, language: "auto" });
  });

  it("persists a change under the key that travels with the person", () => {
    const storage = memoryStorage();
    writeVoiceModeSettings({ voice: "ara" }, storage);
    writeVoiceModeSettings({ speed: 1.25, language: "fr" }, storage);
    expect(JSON.parse(storage.data.get(VOICE_MODE_STORAGE_KEY)!)).toEqual({ voice: "ara", speed: 1.25, language: "fr" });
    expect(readVoiceModeSettings(storage)).toEqual({ voice: "ara", speed: 1.25, language: "fr" });
    expect(USER_PREFERENCE_KEYS).toContain(VOICE_MODE_STORAGE_KEY);
  });

  it("reads a value the server synced into storage", () => {
    const storage = memoryStorage({ [VOICE_MODE_STORAGE_KEY]: JSON.stringify({ voice: "eve", speed: 0.75, language: "ar-EG" }) });
    expect(readVoiceModeSettings(storage)).toEqual({ voice: "eve", speed: 0.75, language: "ar-EG" });
  });

  it("drops what is broken or out of range", () => {
    expect(readVoiceModeSettings(memoryStorage({ [VOICE_MODE_STORAGE_KEY]: "{not json" }))).toEqual(DEFAULT_VOICE_MODE_SETTINGS);
    expect(cleanVoiceModeSettings({ voice: "../x", speed: 9, language: "klingon" })).toEqual(DEFAULT_VOICE_MODE_SETTINGS);
    const storage = memoryStorage();
    writeVoiceModeSettings({ speed: 3 }, storage);
    expect(readVoiceModeSettings(storage).speed).toBe(1);
  });

  it("maps languages to what xAI takes", () => {
    expect(ttsLanguage("fr")).toBe("fr");
    expect(ttsLanguage("ca")).toBe("auto");
    expect(sttLanguage("pt-BR")).toBe("pt");
    expect(sttLanguage("zh")).toBeUndefined();
    expect(sttLanguage("auto")).toBeUndefined();
    expect(speedLabel(1)).toBe("1x");
    expect(speedLabel(1.25)).toBe("1.25x");
  });
});

describe("voice mode audio", () => {
  it("resamples to 16 kHz 16-bit and writes a WAV header", () => {
    const pcm = toPcm16([new Float32Array(48_000).fill(0.5)], 48_000);
    expect(pcm.length).toBe(16_000);
    expect(pcm[0]).toBe(Math.round(0.5 * 0x7fff));
    const wav = encodeWav(pcm);
    const ascii = (from: number, to: number) => String.fromCharCode(...wav.subarray(from, to));
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 12)).toBe("WAVE");
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(40, true)).toBe(32_000);
    expect(wav.byteLength).toBe(44 + 32_000);
  });

  it("ends a turn after the silence that follows speech, never on silence alone", () => {
    const endpointer = new Endpointer({ endpointMs: 800 });
    for (let i = 0; i < 50; i++) expect(endpointer.feed(0.002, 40)).toBe("waiting");
    for (let i = 0; i < 10; i++) endpointer.feed(0.2, 40);
    expect(endpointer.state).toBe("speaking");
    for (let i = 0; i < 19; i++) endpointer.feed(0.002, 40);
    expect(endpointer.state).toBe("speaking");
    endpointer.feed(0.002, 40);
    expect(endpointer.state).toBe("ended");
  });

  it("ignores a click shorter than a word", () => {
    const endpointer = new Endpointer({ endpointMs: 800 });
    endpointer.feed(0.3, 40);
    for (let i = 0; i < 40; i++) endpointer.feed(0.001, 40);
    expect(endpointer.state).toBe("waiting");
  });
});

describe("XaiSpeechEngine", () => {
  const loud = new Float32Array(1600).fill(0.3);
  const quiet = new Float32Array(1600).fill(0);
  // 1600 samples at 16 kHz = 100 ms per frame

  function engine(transcribe: (...args: unknown[]) => Promise<string>) {
    const xai = new XaiSpeechEngine({ botId: "b-cryptic", threadId: () => "t-ada", language: () => "fr", transcribe: transcribe as never });
    const lines: TranscriptLine[] = [];
    const ends: SpeechEndInfo[] = [];
    xai.onTranscript((line) => lines.push(line));
    xai.onEnd((info) => ends.push(info));
    // skip the real microphone: a capture as start() leaves it
    (xai as unknown as { open: () => Promise<void> }).open = async () => {};
    return { xai, lines, ends };
  }

  it("sends one recorded turn as WAV with the language and thread, then reports the transcript", async () => {
    const transcribe = vi.fn(async () => "bonjour Cryptic");
    const { xai, lines, ends } = engine(transcribe);
    await xai.start({ endpointMs: 300 });
    for (let i = 0; i < 5; i++) xai.frame(loud, 16_000);
    for (let i = 0; i < 4; i++) xai.frame(quiet, 16_000);
    await vi.waitFor(() => expect(ends).toEqual([{ code: 0 }]));
    const [botId, blob, language, threadId] = transcribe.mock.calls[0] as unknown as [string, Blob, string, string];
    expect([botId, language, threadId]).toEqual(["b-cryptic", "fr", "t-ada"]);
    expect(blob.type).toBe("audio/wav");
    expect(lines.at(-1)).toEqual({ text: "bonjour Cryptic", partial: false });
  });

  it("hears nothing while muted and resumes listening when unmuted", async () => {
    const transcribe = vi.fn(async () => "x");
    const { xai } = engine(transcribe);
    xai.setMuted(true);
    await xai.start({ endpointMs: 300 });
    for (let i = 0; i < 10; i++) xai.frame(loud, 16_000);
    for (let i = 0; i < 10; i++) xai.frame(quiet, 16_000);
    expect(transcribe).not.toHaveBeenCalled();
    xai.setMuted(false);
    await vi.waitFor(() => expect((xai as unknown as { capture: unknown }).capture).not.toBeNull());
  });

  it("keeps a refusal for the access card", async () => {
    const { xai, ends } = engine(async () => { throw new VoiceModeRefused("no key", "no_credentials", "https://keys.example.test"); });
    await xai.start({ endpointMs: 300 });
    for (let i = 0; i < 5; i++) xai.frame(loud, 16_000);
    for (let i = 0; i < 4; i++) xai.frame(quiet, 16_000);
    await vi.waitFor(() => expect(ends).toEqual([{ code: 1, reason: "voice_no_access" }]));
    expect(xai.refusal?.keysUrl).toBe("https://keys.example.test");
  });

  it("says when the microphone is refused", async () => {
    const xai = new XaiSpeechEngine({
      botId: "b", language: () => "auto",
      getUserMedia: async () => { throw new DOMException("denied", "NotAllowedError"); },
    });
    const ends: SpeechEndInfo[] = [];
    xai.onEnd((info) => ends.push(info));
    await expect(xai.start({})).rejects.toThrow();
    expect(ends).toEqual([{ code: 1, reason: "mic-denied" }]);
  });
});
