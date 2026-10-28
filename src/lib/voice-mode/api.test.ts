// A clause spoken over POST /voice/stream never hangs the call: no answer,
// or no next chunk, for SPEECH_STALL_MS errors the request (and aborts it).
import { afterEach, describe, expect, it, vi } from "vitest";

import { SPEECH_RETRY_MS, SPEECH_STALL_MS, streamVoiceModeSpeech, TRANSCRIBE_TIMEOUT_MS, transcribeVoiceMode, VoiceModeRefused, VoiceProviderError, voiceFailureKind } from "./api";

const voice = { voice: "ara", speed: 1, language: "fr" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("streamVoiceModeSpeech stalls", () => {
  it("a POST with no answer for 8 s is aborted, tried once more, then errors", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    });
    vi.stubGlobal("fetch", fetch);
    const pending = streamVoiceModeSpeech("b-1", "Bonjour.", voice);
    const caught = pending.catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(SPEECH_STALL_MS - 100);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(signal!.aborted).toBe(true);
    // a stall is transient: one more try after SPEECH_RETRY_MS
    await vi.advanceTimersByTimeAsync(SPEECH_RETRY_MS + SPEECH_STALL_MS + 10);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(((await caught) as Error).message).toMatch(/stalled/);
  });

  it("a body that stops between two chunks errors after 8 s; one that keeps coming does not", async () => {
    vi.useFakeTimers();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let cancelled = false;
    const upstream = new ReadableStream<Uint8Array>({ start(c) { controller = c; }, cancel() { cancelled = true; } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(upstream, { status: 200, headers: { "x-voice-sample-rate": "24000" } })));
    const spoken = await streamVoiceModeSpeech("b-1", "Bonjour.", voice);
    const reader = spoken!.body.getReader();
    controller.enqueue(new Uint8Array(4));
    expect((await reader.read()).value?.byteLength).toBe(4);
    // chunks every 5 s are fine
    const second = reader.read();
    await vi.advanceTimersByTimeAsync(5_000);
    controller.enqueue(new Uint8Array(2));
    expect((await second).value?.byteLength).toBe(2);
    // then nothing
    const third = reader.read().catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(SPEECH_STALL_MS + 10);
    expect(((await third) as Error).message).toMatch(/stalled/);
    expect(cancelled).toBe(true);
  });

  it("the caller's abort still aborts the request", async () => {
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }));
    const caller = new AbortController();
    const pending = streamVoiceModeSpeech("b-1", "Bonjour.", voice, undefined, caller.signal).catch((error: Error) => error);
    caller.abort();
    expect(((await pending) as DOMException).name).toBe("AbortError");
  });
});

describe("transcribeVoiceMode", () => {
  it("an upload with no answer is aborted after its timeout", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(signal!.reason)));
    }));
    const pending = transcribeVoiceMode("b-1", new Blob([new Uint8Array(4)], { type: "audio/wav" }), "fr").catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(TRANSCRIBE_TIMEOUT_MS + 10);
    expect(signal!.aborted).toBe(true);
    expect(((await pending) as Error).message).toMatch(/did not answer/);
  });
});

describe("a voice the provider failed", () => {
  const failing = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const audio = () => new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(2)); c.close(); } }), { status: 200, headers: { "x-voice-sample-rate": "24000" } });

  it("a busy xAI is tried once more and the sentence is spoken, without a try again", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(failing(502, { error: "xAI is rate-limiting speech. Wait a moment and try again.", code: "voice_provider", failure: "busy" }))
      .mockResolvedValueOnce(audio());
    vi.stubGlobal("fetch", fetch);
    const spoken = await streamVoiceModeSpeech("b-1", "Bonjour.", voice, undefined, undefined, SPEECH_STALL_MS, 1);
    expect(spoken?.sampleRate).toBe(24_000);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("a rejected key is said plainly and never retried", async () => {
    const fetch = vi.fn(async () => failing(502, { error: "xAI rejected the key or its TTS permissions. Check the xAI key in Settings.", code: "voice_provider", failure: "key" }));
    vi.stubGlobal("fetch", fetch);
    const error = await streamVoiceModeSpeech("b-1", "Bonjour.", voice, undefined, undefined, SPEECH_STALL_MS, 1).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(VoiceProviderError);
    expect(voiceFailureKind(error)).toBe("key");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sorts this server's own limits and refusals", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => failing(429, { error: "Too many voice requests. Wait a moment." })));
    expect(voiceFailureKind(await transcribeVoiceMode("b-1", new Blob([new Uint8Array(4)]), "fr").catch((e: unknown) => e))).toBe("busy");
    vi.stubGlobal("fetch", vi.fn(async () => failing(409, { error: "Spend limit reached.", code: "spend_cap" })));
    expect(voiceFailureKind(await transcribeVoiceMode("b-1", new Blob([new Uint8Array(4)]), "fr").catch((e: unknown) => e))).toBe("quota");
    vi.stubGlobal("fetch", vi.fn(async () => failing(403, { error: "no", code: "voice_no_access", cause: "no_credentials" })));
    const refused = await transcribeVoiceMode("b-1", new Blob([new Uint8Array(4)]), "fr").catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(VoiceModeRefused);
    expect(voiceFailureKind(refused)).toBeNull();
  });
});
