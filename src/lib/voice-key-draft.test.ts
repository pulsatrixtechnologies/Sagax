import { describe, expect, it, vi } from "vitest";

import { saveCloudVoiceKey, voiceKeyDraftValue } from "./voice-key-draft";

const connected = { tts: { configured: true, provider: "xai" as const } };
const disconnected = { tts: { configured: false, provider: "xai" as const } };
const electronRefusal = "Error invoking remote method 'credential:set': Error: credential:set is only available while using the local server";

describe("voice credential drafts", () => {
  it("hides an unsaved key when another client changes providers", () => {
    const draft = { provider: "elevenlabs" as const, value: "eleven-secret" };

    expect(voiceKeyDraftValue(draft, "elevenlabs")).toBe("eleven-secret");
    expect(voiceKeyDraftValue(draft, "fish")).toBe("");
    expect(voiceKeyDraftValue(draft, "xai")).toBe("");
  });
});

describe("saveCloudVoiceKey", () => {
  const input = { credential: "xaiVoiceKey" as const, configField: "xaiKey", key: " voice-secret " };

  it("stores a Grok voice key through the page API and only clears once it is connected", async () => {
    const putConfig = vi.fn(async () => connected);
    const saved = await saveCloudVoiceKey(input, { putConfig });
    expect(saved).toEqual({ ok: true, status: connected });
    expect(putConfig).toHaveBeenCalledWith({ tts: { xaiKey: "voice-secret" } });
  });

  it("uses the page API when the desktop credential channel is refused", async () => {
    const setCredential = vi.fn(async () => {
      throw new Error(electronRefusal);
    });
    const putConfig = vi.fn(async () => connected);
    const saved = await saveCloudVoiceKey(input, { setCredential, putConfig });
    expect(saved).toEqual({ ok: true, status: connected });
    expect(setCredential).toHaveBeenCalledWith("xaiVoiceKey", "voice-secret");
    expect(putConfig).toHaveBeenCalledWith({ tts: { xaiKey: "voice-secret" } });
  });

  it("tries the page API when the desktop channel answers without connecting the key", async () => {
    const setCredential = vi.fn(async () => disconnected);
    const putConfig = vi.fn(async () => connected);
    const saved = await saveCloudVoiceKey(input, { setCredential, putConfig });
    expect(saved).toEqual({ ok: true, status: connected });
    expect(putConfig).toHaveBeenCalledOnce();
  });

  it("keeps the draft when the server accepts the request but the key is still not connected", async () => {
    const putConfig = vi.fn(async () => disconnected);
    const saved = await saveCloudVoiceKey(input, { putConfig });
    expect(saved).toEqual({ ok: false, reason: "not-saved" });
  });

  it("shows the server refusal and does not pretend the key was saved", async () => {
    const putConfig = vi.fn(async () => {
      throw new Error("provider settings are already being updated");
    });
    const saved = await saveCloudVoiceKey(input, { putConfig });
    expect(saved).toEqual({ ok: false, reason: "rejected", message: "provider settings are already being updated" });
  });

  it("does not fall back to the API for a desktop error other than the local-server refusal", async () => {
    const setCredential = vi.fn(async () => {
      throw new Error("The operating-system credential store is unavailable");
    });
    const putConfig = vi.fn();
    const saved = await saveCloudVoiceKey(input, { setCredential, putConfig });
    expect(saved).toEqual({ ok: false, reason: "rejected", message: "The operating-system credential store is unavailable" });
    expect(putConfig).not.toHaveBeenCalled();
  });

  it("never sends the voice key as the bot xAI key", async () => {
    const putConfig = vi.fn(async () => connected);
    await saveCloudVoiceKey(input, { putConfig });
    expect(putConfig).toHaveBeenCalledWith({ tts: { xaiKey: "voice-secret" } });
  });
});
