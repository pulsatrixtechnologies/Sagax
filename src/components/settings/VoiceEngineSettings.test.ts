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
  // 2026-10-14: no key field here. The engine uses its key from the one list
  // of keys above it; Grok voice uses the xAI key.
  // 2026-10-14: the ElevenLabs and Fish Audio keys are managed here only,
  // not in the key list as well.
  it("picks the installation engine and manages its voice key here, never a key field", () => {
    fixture.config = { tts: { configured: false, provider: "elevenlabs" } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain('aria-label="Voice engine"');
    expect(html).toContain('data-voice-key="elevenlabs"');
    expect(html).toContain("No ElevenLabs key yet.");
    expect(html).not.toContain("list above");
    expect(html).toContain("Add a key");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("data-voice-picker");
    expect(html).not.toContain("Read replies aloud");
  });

  it("runs Grok voice on the xAI key of the list, with no separate Grok key", () => {
    fixture.config = { tts: { configured: true, provider: "xai" }, xai: { configured: true } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain('data-voice-key="xai"');
    expect(html).toContain('data-voice-key-saved="true"');
    expect(html).toContain("Uses the xAI key from the list above.");
    expect(html).toContain("Replace or remove");
    expect(html).not.toContain("Grok key");
    expect(html).not.toContain("Bots keep their own xAI key");
    expect(html).not.toContain('type="password"');
  });

  it("reads a voice key saved for an engine that is not selected", () => {
    fixture.config = { tts: { configured: false, provider: "fish", keys: { elevenlabs: true, fish: true } } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain('data-voice-key="fishAudio"');
    expect(html).toContain('data-voice-key-saved="true"');
  });

  it("asks for the Chatterbox server instead of a cloud key", () => {
    fixture.config = { tts: { configured: false, provider: "chatterbox", baseUrl: "", model: "" } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain('aria-label="Chatterbox server address"');
    expect(html).toContain('aria-label="Chatterbox model"');
    expect(html).not.toContain("ElevenLabs key");
  });
});
