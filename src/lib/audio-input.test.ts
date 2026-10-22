import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MicrophonePromptUnanswered, AUDIO_INPUT_KEY, audioInputsFrom, getUserMediaWithFallback, onPreferredAudioInputChange, openPreferredMicrophone, preferredAudioInputId, setPreferredAudioInputId, withPreferredInput } from "./audio-input";

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

const stream = {} as MediaStream;
const failure = (name: string) => Object.assign(new Error(name), { name });

describe("microphone choice", () => {
  it("saves the choice on this computer and tells listeners", () => {
    const heard = vi.fn();
    const off = onPreferredAudioInputChange(heard);
    expect(preferredAudioInputId()).toBeUndefined();
    setPreferredAudioInputId("usb-mic");
    expect(store.get(AUDIO_INPUT_KEY)).toBe("usb-mic");
    expect(preferredAudioInputId()).toBe("usb-mic");
    setPreferredAudioInputId("default");
    expect(preferredAudioInputId()).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(2);
    off();
  });

  it("adds the saved device to the constraints, exact, unless one is named", () => {
    expect(withPreferredInput({ echoCancellation: true }, "usb-mic")).toEqual({ echoCancellation: true, deviceId: { exact: "usb-mic" } });
    expect(withPreferredInput({ echoCancellation: true }, undefined)).toEqual({ echoCancellation: true });
    expect(withPreferredInput({ deviceId: { exact: "other" } }, "usb-mic")).toEqual({ deviceId: { exact: "other" } });
  });

  it("falls back to the default when the saved microphone is gone, never on a refusal", async () => {
    const calls: MediaStreamConstraints[] = [];
    const gone = async (constraints: MediaStreamConstraints) => {
      calls.push(constraints);
      if ((constraints.audio as MediaTrackConstraints).deviceId) throw failure("OverconstrainedError");
      return stream;
    };
    await expect(getUserMediaWithFallback({ audio: { deviceId: { exact: "usb-mic" }, echoCancellation: true } }, gone)).resolves.toBe(stream);
    expect(calls[1]).toEqual({ audio: { echoCancellation: true } });

    const refused = vi.fn(async () => { throw failure("NotAllowedError"); });
    await expect(getUserMediaWithFallback({ audio: { deviceId: { exact: "usb-mic" } } }, refused)).rejects.toThrow("NotAllowedError");
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("opens the saved microphone for dictation, voice notes and calls", async () => {
    setPreferredAudioInputId("usb-mic");
    const opened = vi.fn(async () => stream);
    await openPreferredMicrophone({ noiseSuppression: true }, opened);
    expect(opened).toHaveBeenCalledWith({ audio: { noiseSuppression: true, deviceId: { exact: "usb-mic" } }, video: false });
  });

  it("lists audio inputs once each, without the browser's aliases", () => {
    const inputs = audioInputsFrom([
      { deviceId: "default", kind: "audioinput", label: "Default - MacBook Microphone" },
      { deviceId: "communications", kind: "audioinput", label: "Communications" },
      { deviceId: "built-in", kind: "audioinput", label: "MacBook Microphone " },
      { deviceId: "usb-mic", kind: "audioinput", label: "" },
      { deviceId: "usb-mic", kind: "audioinput", label: "" },
      { deviceId: "speakers", kind: "audiooutput", label: "Speakers" },
    ]);
    expect(inputs).toEqual([{ id: "built-in", label: "MacBook Microphone" }, { id: "usb-mic", label: "" }]);
  });
});

describe("a permission prompt nobody answers", () => {
  it("calls the microphone unavailable after the wait and releases a stream that comes late", async () => {
    vi.useFakeTimers();
    try {
      const stop = vi.fn();
      let grant: (value: MediaStream) => void = () => undefined;
      const pending = new Promise<MediaStream>((resolve) => { grant = resolve; });
      const opened = getUserMediaWithFallback({ audio: true }, () => pending, 1_000);
      const outcome = opened.then(() => "opened", (error) => error);
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await outcome;
      expect(error).toBeInstanceOf(MicrophonePromptUnanswered);
      expect(error.message).toMatch(/permission request|autorisation/i);
      grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
      await Promise.resolve();
      expect(stop).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not interfere with a prompt answered in time or a refusal", async () => {
    await expect(getUserMediaWithFallback({ audio: true }, async () => stream, 1_000)).resolves.toBe(stream);
    await expect(getUserMediaWithFallback({ audio: true }, async () => { throw failure("NotAllowedError"); }, 1_000)).rejects.toThrow("NotAllowedError");
  });
});
