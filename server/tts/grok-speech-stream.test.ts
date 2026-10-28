import { afterEach, describe, expect, it, vi } from "vitest";

import { grokVoiceFailure, handshakeStatus, openSpeechStream, openTranscriptionStream, SPEECH_PING_MS, type HeaderWebSocket } from "./grok.ts";

class FakeSocket {
  static last: FakeSocket | null = null;
  sent: Record<string, unknown>[] = [];
  pings = 0;
  readyState = 1;
  binaryType = "arraybuffer";
  private listeners: Record<string, Array<() => void>> = {};
  readonly url: string;
  readonly init: { headers: Record<string, string> };
  constructor(url: string, init: { headers: Record<string, string> }) {
    this.url = url;
    this.init = init;
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

/** xAI refuses the socket's handshake with this status (`ws` reports it as
 * an error event "Unexpected server response: <status>"), or the network
 * fails (status null). */
function refusingSocket(status: number | null) {
  return class {
    readyState = 0;
    binaryType = "arraybuffer";
    addEventListener(type: string, cb: (event: unknown) => void) {
      if (type !== "error") return;
      queueMicrotask(() => cb({ type: "error", message: status === null ? "getaddrinfo ENOTFOUND api.x.ai" : `Unexpected server response: ${status}` }));
    }
    send() {}
    close() {}
  } as unknown as HeaderWebSocket;
}

describe("a refused xAI socket says why", () => {
  it("reads the handshake status, not a vague network error", async () => {
    expect(handshakeStatus({ message: "Unexpected server response: 401" })).toBe(401);
    expect(handshakeStatus({ error: { message: "Unexpected server response: 429" } })).toBe(429);
    expect(handshakeStatus({ message: "read ECONNRESET" })).toBeNull();
    const cases: Array<[number | null, string]> = [[401, "key"], [403, "key"], [402, "quota"], [429, "busy"], [503, "down"], [null, "down"]];
    for (const [status, kind] of cases) {
      const errors: string[] = [];
      openTranscriptionStream("fixture-voice-key", {}, { onTranscript() {}, onError: (message) => errors.push(message), onClose() {} }, refusingSocket(status));
      openSpeechStream("fixture-voice-key", {}, { onAudio() {}, onDone() {}, onCleared() {}, onError: (message) => errors.push(message), onClose() {} }, refusingSocket(status));
      await Promise.resolve();
      await Promise.resolve();
      expect(errors).toHaveLength(2);
      for (const message of errors) {
        expect(grokVoiceFailure(message)).toBe(kind);
        expect(message).not.toContain("fixture-voice-key");
      }
    }
  });
});

afterEach(() => vi.useRealTimers());
