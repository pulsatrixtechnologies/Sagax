import { describe, expect, it } from "vitest";

import { USER_PREFERENCE_KEYS } from "../../../shared/user-preferences";
import { DEFAULT_VOICE_MODE_SETTINGS, VOICE_MODE_STORAGE_KEY, cleanVoiceLocale, cleanVoiceModeSettings, stripFillers, sttLanguage, sttRequest, ttsLanguage } from "../../../shared/voice-mode";
import { encodeWav, toPcm16 } from "./audio";
import { voiceModeListenUrl } from "./api";
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
    expect(ttsLanguage("fr-CA")).toBe("fr");
    expect(ttsLanguage("ca")).toBe("auto");
    expect(sttLanguage("pt-BR")).toBe("pt");
    expect(sttLanguage("zh")).toBeUndefined();
    expect(sttLanguage("auto")).toBeUndefined();
    expect(speedLabel(1)).toBe("1x");
    expect(speedLabel(1.25)).toBe("1.25x");
  });

  it("asks xAI for French and formatting when auto meets a French locale", () => {
    // auto on a fr-CA computer: the French waits and formatting apply
    expect(sttRequest("auto", "fr-CA")).toEqual({ language: "fr", format: true });
    expect(sttRequest("auto", "fr")).toEqual({ language: "fr", format: true });
    // auto elsewhere stays pure detection
    expect(sttRequest("auto", "en-US")).toEqual({ format: false });
    expect(sttRequest("auto")).toEqual({ format: false });
    // an explicit language: formatting where xAI formats it (en, fr)
    expect(sttRequest("fr")).toEqual({ language: "fr", format: true });
    expect(sttRequest("en", "fr-CA")).toEqual({ language: "en", format: true });
    expect(sttRequest("pt-BR")).toEqual({ language: "pt", format: false });
    // no STT language for it: detection, no formatting
    expect(sttRequest("zh", "fr-CA")).toEqual({ format: false });
  });

  it("sends the computer's locale beside auto only", () => {
    const auto = new URL(voiceModeListenUrl("b-1", "auto", "t-1", "https://app.test", "fr-CA"));
    expect(auto.protocol).toBe("wss:");
    expect(auto.searchParams.get("locale")).toBe("fr-CA");
    expect(new URL(voiceModeListenUrl("b-1", "en", "t-1", "https://app.test", "fr-CA")).searchParams.get("locale")).toBeNull();
    expect(new URL(voiceModeListenUrl("b-1", "auto", undefined, "https://app.test", "")).searchParams.get("locale")).toBeNull();
  });

  it("keeps only a well formed locale", () => {
    expect(cleanVoiceLocale("fr-CA")).toBe("fr-CA");
    expect(cleanVoiceLocale("en")).toBe("en");
    expect(cleanVoiceLocale("zh-Hant-TW")).toBe("zh-Hant-TW");
    expect(cleanVoiceLocale("fr-CA; drop table")).toBeUndefined();
    expect(cleanVoiceLocale("")).toBeUndefined();
    expect(cleanVoiceLocale(42)).toBeUndefined();
    expect(cleanVoiceLocale("x".repeat(40))).toBeUndefined();
  });

  it("removes fillers from the words a bot reads, never the words themselves", () => {
    expect(stripFillers("Euh, peux-tu regarder le billet euh de CONTOSO?")).toBe("Peux-tu regarder le billet de CONTOSO?");
    expect(stripFillers("um so the uh server is down")).toBe("so the server is down");
    expect(stripFillers("Hum... ok, regarde")).toBe("Ok, regarde");
    expect(stripFillers("euh")).toBe("");
    // words that only look like fillers stay
    expect(stripFillers("Humain, humble, Uhaul")).toBe("Humain, humble, Uhaul");
    expect(stripFillers("Ben oui")).toBe("Ben oui");
    // a backchannel is not a filler: the call decides what to do with it
    expect(stripFillers("mm-hmm")).toBe("mm-hmm");
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
});
