// A clause spoken over POST /voice/stream never hangs the call: no answer,
// or no next chunk, for SPEECH_STALL_MS errors the request (and aborts it).
import { afterEach, describe, expect, it, vi } from "vitest";

import { SPEECH_STALL_MS, streamVoiceModeSpeech, TRANSCRIBE_TIMEOUT_MS, transcribeVoiceMode } from "./api";

const voice = { voice: "ara", speed: 1, language: "fr" };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("streamVoiceModeSpeech stalls", () => {
  it("a POST with no answer for 8 s is aborted with an error", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }));
    const pending = streamVoiceModeSpeech("b-1", "Bonjour.", voice);
    const caught = pending.catch((error: Error) => error);
    await vi.advanceTimersByTimeAsync(SPEECH_STALL_MS - 100);
    expect(signal!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(signal!.aborted).toBe(true);
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
