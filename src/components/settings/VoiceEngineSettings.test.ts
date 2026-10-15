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
  // 2026-10-15: the voice section only chooses the engine. Every key, the
  // ElevenLabs and Fish Audio ones too, is managed in the Keys list; a
  // missing key shows a short state and a link to its row there.
  it("picks the installation engine and links a missing key to Keys, with no form of its own", () => {
    fixture.config = { tts: { configured: false, provider: "elevenlabs" } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain('aria-label="Voice engine"');
    expect(html).toContain('data-voice-key="elevenlabs"');
    expect(html).toContain('data-voice-key-saved="false"');
    expect(html).toContain("ElevenLabs key missing");
    expect(html).toContain('data-add-in-keys="elevenlabs"');
    expect(html).toContain("Add in Keys");
    // no second way to add a key: no "Add a key" button, no field, no dialog
    expect(html).not.toContain("Add a key");
    expect(html).not.toContain("Replace or remove");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("data-provider-key-dialog");
    expect(html).not.toContain("data-voice-picker");
    expect(html).not.toContain("Read replies aloud");
  });

  it("says xAI key missing for Grok voice and links to the xAI row", () => {
    fixture.config = { tts: { configured: false, provider: "xai" }, xai: { configured: false } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain("xAI key missing");
    expect(html).toContain('data-add-in-keys="xai"');
    expect(html).not.toContain("Add a key");
  });

  it("runs Grok voice on the xAI key of the list, with no separate Grok key", () => {
    fixture.config = { tts: { configured: true, provider: "xai" }, xai: { configured: true } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain('data-voice-key="xai"');
    expect(html).toContain('data-voice-key-saved="true"');
    expect(html).toContain("Uses the xAI key from Keys.");
    expect(html).not.toContain("data-add-in-keys");
    expect(html).not.toContain("Replace or remove");
    expect(html).not.toContain("Grok key");
    expect(html).not.toContain('type="password"');
  });

  it("reads a voice key saved for an engine that is not selected", () => {
    fixture.config = { tts: { configured: false, provider: "fish", keys: { elevenlabs: true, fish: true } } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain('data-voice-key="fishAudio"');
    expect(html).toContain('data-voice-key-saved="true"');
    expect(html).toContain("Uses the Fish Audio key from Keys.");
  });

  it("counts ElevenLabs included with Cloud Pro as ready, with no link", () => {
    fixture.config = { tts: { configured: true, provider: "elevenlabs", included: true } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain('data-voice-key-saved="true"');
    expect(html).not.toContain("data-add-in-keys");
  });

  it("keeps the state without a link where the Keys list is not on the page", () => {
    fixture.config = { tts: { configured: false, provider: "fish" } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings, { keysLink: false }));
    expect(html).toContain("Fish Audio key missing");
    expect(html).not.toContain("data-add-in-keys");
  });

  it("asks for the Chatterbox server instead of a cloud key", () => {
    fixture.config = { tts: { configured: false, provider: "chatterbox", baseUrl: "", model: "" } };
    const html = renderToStaticMarkup(createElement(VoiceEngineSettings));
    expect(html).toContain('aria-label="Chatterbox server address"');
    expect(html).toContain('aria-label="Chatterbox model"');
    expect(html).not.toContain("data-voice-key");
  });
});
