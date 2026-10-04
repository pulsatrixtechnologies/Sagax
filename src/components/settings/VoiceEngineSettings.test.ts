import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  config: { tts: { configured: false, provider: "elevenlabs" } } as Record<string, unknown> | null,
}));

vi.mock("@/state/store", async (importOriginal) => {
  const store = await importOriginal<typeof import("@/state/store")>();
  return {
    ...store,
    useStore: () => ({
      state: { ...store.initialState, config: fixture.config },
      dispatch: vi.fn(),
    }),
  };
});

const { VoiceEngineSettings } = await import("./VoiceEngineSettings");

describe("VoiceEngineSettings", () => {
  it("edits the installation engine and key, not a bot's voice", () => {
    fixture.config = { tts: { configured: false, provider: "elevenlabs" } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain('aria-label="Voice engine"');
    expect(html).toContain('aria-label="ElevenLabs key"');
    expect(html).toContain("Get a key from ElevenLabs");
    expect(html).not.toContain("data-voice-picker");
    expect(html).not.toContain("Read replies aloud");
  });

  it("asks for the Chatterbox server instead of a cloud key", () => {
    fixture.config = { tts: { configured: false, provider: "chatterbox", baseUrl: "", model: "" } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain('aria-label="Chatterbox server address"');
    expect(html).toContain('aria-label="Chatterbox model"');
    expect(html).not.toContain("ElevenLabs key");
  });
});
