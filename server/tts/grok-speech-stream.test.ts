import { afterEach, describe, expect, it, vi } from "vitest";

import { openSpeechStream, openTranscriptionStream, SPEECH_PING_MS, type HeaderWebSocket } from "./grok.ts";

class FakeSocket {
  static last: FakeSocket | null = null;
  sent: Record<string, unknown>[] = [];
  pings = 0;
  readyState = 1;
  binaryType = "arraybuffer";
  private listeners: Record<string, Array<() => void>> = {};
  constructor(readonly url: string, readonly init: { headers: Record<string, string> }) {
    FakeSocket.last = this;
  }
  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ??= []).push(cb);
    if (type === "open") queueMicrotask(() => { for (const fn of this.listeners.open ?? []) fn(); });
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  ping() {
    this.pings += 1;
  }
  close() {
    this.readyState = 3;
    for (const fn of this.listeners.close ?? []) fn();
  }
}

describe("openSpeechStream", () => {
  it("sends text.delta without text.done until done(), so a lead token can start audio", async () => {
    const handlers = { onAudio() {}, onDone() {}, onCleared() {}, onError() {}, onClose() {} };
    const stream = openSpeechStream("fixture-voice-key", { voice: "ara" }, handlers, FakeSocket as unknown as HeaderWebSocket);
    await stream.ready;
    expect(FakeSocket.last!.init.headers.authorization).toBe("Bearer fixture-voice-key");
    expect(FakeSocket.last!.url).toContain("optimize_streaming_latency=2");
    stream.delta("Four");
    expect(FakeSocket.last!.sent).toEqual([{ type: "text.delta", delta: "Four" }]);
    stream.delta(" is");
    stream.done();
    expect(FakeSocket.last!.sent).toEqual([
      { type: "text.delta", delta: "Four" },
      { type: "text.delta", delta: " is" },
      { type: "text.done" },
    ]);
    stream.speak("A finished clause.");
    expect(FakeSocket.last!.sent.at(-2)).toEqual({ type: "text.delta", delta: "A finished clause." });
    expect(FakeSocket.last!.sent.at(-1)).toEqual({ type: "text.done" });
  });

  it("pings while idle so the next clause does not pay reconnect", async () => {
    vi.useFakeTimers();
    const handlers = { onAudio() {}, onDone() {}, onCleared() {}, onError() {}, onClose() {} };
    const stream = openSpeechStream("fixture-voice-key", { voice: "ara" }, handlers, FakeSocket as unknown as HeaderWebSocket);
    await stream.ready;
    expect(FakeSocket.last!.pings).toBe(0);
    await vi.advanceTimersByTimeAsync(SPEECH_PING_MS);
    expect(FakeSocket.last!.pings).toBe(1);
    await vi.advanceTimersByTimeAsync(SPEECH_PING_MS);
    expect(FakeSocket.last!.pings).toBe(2);
    const socket = FakeSocket.last!;
    stream.speak("Warm.");
    expect(socket.sent.at(-1)).toEqual({ type: "text.done" });
    stream.close();
    await vi.advanceTimersByTimeAsync(SPEECH_PING_MS);
    expect(socket.pings).toBe(2);
  });
});

describe("openTranscriptionStream", () => {
  it("pings while the call is up so a quiet stretch does not drop speech to text", async () => {
    vi.useFakeTimers();
    const handlers = { onTranscript() {}, onError() {}, onClose() {} };
    const stream = openTranscriptionStream("fixture-voice-key", { language: "fr" }, handlers, FakeSocket as unknown as HeaderWebSocket);
    await vi.advanceTimersByTimeAsync(0);
    expect(FakeSocket.last!.url).toContain("/stt?");
    expect(FakeSocket.last!.pings).toBe(0);
    await vi.advanceTimersByTimeAsync(SPEECH_PING_MS);
    expect(FakeSocket.last!.pings).toBe(1);
    const socket = FakeSocket.last!;
    stream.close();
    await vi.advanceTimersByTimeAsync(SPEECH_PING_MS);
    expect(socket.pings).toBe(1);
  });
});

afterEach(() => vi.useRealTimers());
