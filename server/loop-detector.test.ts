import { describe, expect, it, vi } from "vitest";
import type { RuntimeEvent } from "../shared/runtime-events.ts";
import {
  DEFAULT_LOOP_THRESHOLDS, LoopDetector, canonicalJson, loopDetectorConfigSchema, loopThresholds, makeLoopStopSubscriber,
  type LoopDetectorConfig, type ToolCallObservation,
} from "./loop-detector.ts";

const detector = (config?: LoopDetectorConfig) => new LoopDetector(loopThresholds(config)!);
const feed = (d: LoopDetector, calls: ToolCallObservation[]) => calls.map((call) => d.observe(call));

describe("LoopDetector", () => {
  it("trips on the same call at the threshold, not before", () => {
    const d = detector();
    const calls = Array.from({ length: DEFAULT_LOOP_THRESHOLDS.identicalCall },
      (_, i) => ({ tool: "Bash", input: { command: "make" }, result: `run ${i}` }));
    const verdicts = feed(d, calls);
    expect(verdicts.slice(0, -1).every((v) => v === null)).toBe(true);
    expect(verdicts.at(-1)).toMatchObject({ stuck: true, kind: "identical-call", count: 5 });
    expect(verdicts.at(-1)!.reason).toBe("the same Bash call with the same input ran 5 times in a row");
  });

  it("does not trip when inputs vary", () => {
    const d = detector();
    const verdicts = feed(d, Array.from({ length: 30 }, (_, i) => ({ tool: "Read", input: { path: `f${i}` }, result: "same" })));
    expect(verdicts.every((v) => v === null)).toBe(true);
  });

  it("treats key-order differences as the same input", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
    const d = detector();
    const verdicts = feed(d, [
      { tool: "Grep", input: { pattern: "x", path: "src" }, result: "r" },
      { tool: "Grep", input: '{"path":"src","pattern":"x"}', result: "r" },
      { tool: "Grep", input: { path: "src", pattern: "x" }, result: "r" },
    ]);
    expect(verdicts.at(-1)).toMatchObject({ kind: "identical-result", count: 3 });
    expect(verdicts.at(-1)!.reason).toBe("Grep returned the same result 3 times in a row for the same input");
  });

  it("trips on the same error repeated, even with varying inputs", () => {
    const d = detector();
    const verdicts = feed(d, [1, 2, 3].map((i) => ({ tool: "Fetch", input: { url: `u${i}` }, result: "403 Forbidden", error: true })));
    expect(verdicts.slice(0, 2)).toEqual([null, null]);
    expect(verdicts[2]).toMatchObject({ kind: "same-error", count: 3, reason: "Fetch failed with the same error 3 times in a row" });
  });

  it("trips on an A/B ping-pong with unchanged results", () => {
    const d = detector();
    const round = [
      { tool: "Read", input: { path: "a" }, result: "A" },
      { tool: "Edit", input: { path: "a", text: "x" }, result: "ok" },
    ];
    const verdicts = feed(d, Array.from({ length: 6 }, () => round).flat());
    expect(verdicts.slice(0, -1).every((v) => v === null)).toBe(true);
    expect(verdicts.at(-1)).toMatchObject({ kind: "cycle", count: 6 });
    expect(verdicts.at(-1)!.reason).toBe("the calls Read → Edit repeated 6 times with no change in their results");
  });

  it("does not trip on a ping-pong whose results change", () => {
    const d = detector();
    const verdicts = feed(d, Array.from({ length: 20 }, (_, i) => [
      { tool: "Read", input: { path: "a" }, result: `content ${i}` },
      { tool: "Edit", input: { path: "a", text: "x" }, result: "ok" },
    ]).flat());
    expect(verdicts.every((v) => v === null)).toBe(true);
  });

  it("respects custom thresholds", () => {
    const d = detector({ identicalResult: 5 });
    const verdicts = feed(d, Array.from({ length: 5 }, () => ({ tool: "Bash", input: "ls", result: "x" })));
    expect(verdicts.slice(0, 4).every((v) => v === null)).toBe(true);
    expect(verdicts[4]).toMatchObject({ kind: "identical-result", count: 5 });
  });

  it("is off when disabled", () => {
    expect(loopThresholds({ enabled: false })).toBeNull();
  });

  it("answers once per run", () => {
    const d = detector();
    feed(d, Array.from({ length: 3 }, () => ({ tool: "Bash", input: "ls", result: "x" })));
    expect(d.stuck).not.toBeNull();
    expect(d.observe({ tool: "Bash", input: "ls", result: "x" })).toBeNull();
  });

  it("validates the config block", () => {
    expect(loopDetectorConfigSchema.safeParse({ enabled: false, cycles: 4 }).success).toBe(true);
    expect(loopDetectorConfigSchema.safeParse({ identicalCall: 1 }).success).toBe(false);
    expect(loopDetectorConfigSchema.safeParse({ unknown: 1 }).success).toBe(false);
  });
});

describe("makeLoopStopSubscriber", () => {
  const base = { eventId: "e", provider: "fake", threadId: "t1", createdAt: "" } as const;
  const start = (itemId: string, input?: string, title = "Bash") =>
    ({ ...base, itemId, type: "item.started", itemType: "tool", title, input }) as unknown as RuntimeEvent;
  const done = (itemId: string, output: string, ok = true) =>
    ({ ...base, itemId, type: "item.completed", itemType: "tool", ok, output }) as unknown as RuntimeEvent;

  it("stops the run with a stuck-loop reason, once", () => {
    const stop = vi.fn();
    const sub = makeLoopStopSubscriber({ config: () => undefined, stop });
    for (let i = 0; i < 4; i++) {
      sub(start(`i${i}`, '{"command":"ls"}'));
      sub(done(`i${i}`, "same"));
    }
    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop.mock.calls[0]![0]).toBe("t1");
    expect(stop.mock.calls[0]![1]).toBe("stuck-loop: Bash returned the same result 3 times in a row for the same input");
  });

  it("never stops when disabled, and does not count bare tool names", () => {
    const stop = vi.fn();
    const off = makeLoopStopSubscriber({ config: () => ({ enabled: false }), stop });
    const on = makeLoopStopSubscriber({ config: () => undefined, stop });
    for (let i = 0; i < 10; i++) {
      off(start(`a${i}`, "ls"));
      off(done(`a${i}`, "same"));
      on(start(`b${i}`));
      on(done(`b${i}`, "same"));
    }
    expect(stop).not.toHaveBeenCalled();
  });

  it("starts over on each turn", () => {
    const stop = vi.fn();
    const sub = makeLoopStopSubscriber({ config: () => undefined, stop });
    for (let i = 0; i < 2; i++) { sub(start(`x${i}`, "ls")); sub(done(`x${i}`, "same")); }
    sub({ ...base, type: "turn.completed", ok: true } as unknown as RuntimeEvent);
    for (let i = 0; i < 2; i++) { sub(start(`y${i}`, "ls")); sub(done(`y${i}`, "same")); }
    expect(stop).not.toHaveBeenCalled();
  });
});
