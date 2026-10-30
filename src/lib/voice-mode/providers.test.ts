// Who speaks for which bot (2026-10-29): the person's choice, a bot's own
// choice, and what each request tells the server.
import { afterEach, describe, expect, it, vi } from "vitest";

import { VOICE_MODE_STORAGE_KEY, cleanVoiceModeSettings } from "../../../shared/voice-mode";
import { providerOrder } from "../../../shared/voice-providers";
import { speakVoiceMode, voiceModeListenUrl, voiceModeSpeechUrl } from "./api";
import { migrateInstalledVoiceSettings, readVoiceModeSettings, voiceSettingsForBot, writeBotVoiceChoice, writeVoiceForBot, writeVoiceProviders } from "./settings";

function memory(initial?: unknown) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(VOICE_MODE_STORAGE_KEY, JSON.stringify(initial));
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, map };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The page's storage with this preference in it. */
function page(initial: unknown) {
  const store = memory(initial);
  vi.stubGlobal("window", { localStorage: store });
  return store;
}

describe("voice providers in the person's settings", () => {
  it("migrates the installed provider and bot voices once, without replacing a saved Auto choice", () => {
    const store = memory();
    migrateInstalledVoiceSettings({ provider: "system", voice: "Thomas (French)" }, [{ id: "b-1", voice: "Amelie" }], store);
    expect(voiceSettingsForBot(readVoiceModeSettings(store), "b-1")).toMatchObject({ tts: "system", voice: "Amelie" });
    expect(voiceSettingsForBot(readVoiceModeSettings(store), "b-2")).toMatchObject({ tts: "system", voice: "Thomas (French)" });
    writeVoiceProviders({ tts: "auto" }, store);
    migrateInstalledVoiceSettings({ provider: "fish", voice: "oldVoice" }, [], store);
    expect(voiceSettingsForBot(readVoiceModeSettings(store), "b-2").tts).toBe("auto");
  });

  it("saves the voice of Auto's actual provider without changing another provider's voice", () => {
    const store = memory({ voice: "eve", speed: 1, language: "auto" });
    writeVoiceForBot(undefined, "myClone", store, "elevenlabs");
    expect(readVoiceModeSettings(store)).toMatchObject({ voice: "eve", voices: { elevenlabs: "myClone" } });
  });
  it("keeps an untouched preference as it was, and cleans what is not a provider", () => {
    expect(cleanVoiceModeSettings({ voice: "eve", speed: 1, language: "fr" })).toEqual({ voice: "eve", speed: 1, language: "fr" });
    expect(cleanVoiceModeSettings({ voice: "", speed: 1, language: "auto", tts: "nope", stt: "auto", voices: { openai: "../x", elevenlabs: "abc" }, bots: { "b 1": { tts: "xai" }, "b-2": { tts: "openai" } } }))
      .toEqual({ voice: "", speed: 1, language: "auto", voices: { elevenlabs: "abc" }, bots: { "b-2": { tts: "openai" } } });
  });

  it("puts the chosen provider first, then the others in order", () => {
    expect(providerOrder("elevenlabs", ["xai", "elevenlabs"], ["xai", "openai", "elevenlabs"])).toEqual(["elevenlabs", "xai"]);
    expect(providerOrder("openai", ["xai"], ["xai", "openai"])).toEqual(["xai"]);
    expect(providerOrder("auto", ["openai", "xai"], ["xai", "openai"])).toEqual(["xai", "openai"]);
  });

  it("gives a bot its own provider and voice, else the person's", () => {
    const store = memory({ voice: "eve", speed: 1, language: "auto" });
    writeVoiceProviders({ tts: "openai" }, store);
    writeVoiceForBot("b-1", "cedar", store);
    expect(voiceSettingsForBot(readVoiceModeSettings(store), "b-1")).toMatchObject({ tts: "openai", voice: "cedar" });
    writeBotVoiceChoice("b-2", { tts: "elevenlabs" }, store);
    writeVoiceForBot("b-2", "myClone", store);
    const settings = readVoiceModeSettings(store);
    expect(voiceSettingsForBot(settings, "b-2")).toMatchObject({ tts: "elevenlabs", voice: "myClone" });
    expect(settings.voice).toBe("eve");
    expect(settings.voices).toEqual({ openai: "cedar" });
    // back to "Same as my settings"
    writeBotVoiceChoice("b-2", null, store);
    expect(readVoiceModeSettings(store).bots).toBeUndefined();
  });
});

describe("what a request says about the voice", () => {
  it("sends the bot's provider and voice, and the voices of the others for a fallback", async () => {
    page({ voice: "eve", speed: 1, language: "fr", stt: "openai", bots: { "b-1": { tts: "elevenlabs", voices: { elevenlabs: "myClone" } } } });
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(new Uint8Array([1]), { status: 200, headers: { "x-voice-key": "voice-key:abcd", "x-voice-provider": "elevenlabs" } }));
    vi.stubGlobal("fetch", fetch);
    await speakVoiceMode("b-1", "Bonjour", readVoiceModeSettings());
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toEqual({ text: "Bonjour", voice: "myClone", speed: 1, language: "fr", tts: "elevenlabs", voices: { xai: "eve", elevenlabs: "myClone" } });
    expect(voiceModeSpeechUrl("b-1", readVoiceModeSettings(), "t-1", "http://x")).toBe("ws://x/api/bots/b-1/voice/speech?language=fr&speed=1&voice=myClone&threadId=t-1&tts=elevenlabs&stt=openai&voices=xai%3Aeve%2Celevenlabs%3AmyClone");
    expect(voiceModeListenUrl("b-1", "fr", "t-1", "http://x")).toBe("ws://x/api/bots/b-1/voice/listen?language=fr&threadId=t-1&stt=openai");
  });

  it("keeps a preview's voice for this bot", async () => {
    page({ voice: "", speed: 1, language: "auto" });
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(new Uint8Array([1])));
    vi.stubGlobal("fetch", fetch);
    const view = { ...voiceSettingsForBot({ voice: "", speed: 1, language: "auto", tts: "openai" }, "b-1"), voice: "verse" };
    await speakVoiceMode("b-1", "Hi", view);
    expect(JSON.parse(String(fetch.mock.calls[0]![1]!.body))).toMatchObject({ voice: "verse", tts: "openai" });
  });
});
