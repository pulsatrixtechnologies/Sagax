// Clear-on-reconnect / clear-on-stream-reset for live replies (#1749).
// The live map lives outside the reducer; a non-resumable hydrate and a
// turn.started must empty it (and any pending rAF deltas) so a truncated
// answer cannot sit under the settled transcript or prepend onto the next
// turn.
import { afterEach, describe, expect, it, vi } from "vitest";

import { createStreamDeltaBuffer } from "./store";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createStreamDeltaBuffer reset (clear-on-reconnect)", () => {
  it("drops pending deltas so a hydrate cannot flush stale text after emptying the live map", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const flushed: Array<[string, { text: string; reasoning: string }]> = [];
    const buffer = createStreamDeltaBuffer((entries) => {
      flushed.push(...entries);
    });
    buffer.push("thread-a", "assistant_text", "truncated partial ");
    buffer.push("thread-a", "reasoning_text", "thinking");
    buffer.push("thread-b", "assistant_text", "other");
    buffer.reset();
    buffer.flush();
    expect(flushed).toEqual([]);
    buffer.dispose();
  });

  it("accepts new deltas after reset so the next turn starts empty", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queueMicrotask(() => cb(0));
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const live: Record<string, string> = { "thread-a": "stale partial" };
    const buffer = createStreamDeltaBuffer((entries) => {
      for (const [threadId, delta] of entries) {
        if (delta.text) live[threadId] = (live[threadId] ?? "") + delta.text;
      }
    });
    buffer.push("thread-a", "assistant_text", "still pending");
    // hydrate / resetStreams: empty the map and the buffer together
    buffer.reset();
    for (const key of Object.keys(live)) delete live[key];
    buffer.push("thread-a", "assistant_text", "fresh answer");
    buffer.flush();
    expect(live["thread-a"]).toBe("fresh answer");
    buffer.dispose();
  });
});

describe("clear-on-stream-reset (turn.started)", () => {
  it("clearing a thread before new deltas prevents prepend onto a stale partial", () => {
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const live: Record<string, string> = {
      "thread-a": "stale partial from a cut stream",
      "thread-b": "still fine",
    };
    const buffer = createStreamDeltaBuffer((entries) => {
      for (const [threadId, delta] of entries) {
        if (delta.text) live[threadId] = (live[threadId] ?? "") + delta.text;
      }
    });
    // turn.started → clearStream(threadId): drop pending + map entry
    buffer.clear("thread-a");
    delete live["thread-a"];
    buffer.push("thread-a", "assistant_text", "new turn");
    buffer.flush();
    expect(live["thread-a"]).toBe("new turn");
    expect(live["thread-b"]).toBe("still fine");
    buffer.dispose();
  });
});
