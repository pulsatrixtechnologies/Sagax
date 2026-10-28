import { afterEach, describe, expect, it, vi } from "vitest";

import { clearTurnCounters, noteFirstResponse, noteTurnQueued, turnCounters, turnTrace } from "./turn-trace.ts";

describe("turn trace (SAGAX_TURN_TRACE)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SAGAX_TURN_TRACE;
    clearTurnCounters();
  });

  it("writes nothing unless switched on", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    turnTrace("0123456789abcdef", "start", true);
    expect(spy).not.toHaveBeenCalled();
  });

  it("prints the thread's first 8 characters, the step, the time and the elapsed ms", () => {
    process.env.SAGAX_TURN_TRACE = "1";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    turnTrace("0123456789abcdef", "start", true);
    turnTrace("0123456789abcdef", "send");
    expect(spy).toHaveBeenCalledTimes(2);
    expect(String(spy.mock.calls[1]![0])).toMatch(/^\[turn-trace\] 01234567 send \d{13} \+\d+$/);
    expect(String(spy.mock.calls[1]![0])).not.toContain("hello");
  });

  it("counts queue wait and time to first answer with the trace off, and stores no words", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    let now = 5_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const thread = "abcdef0123456789";
    noteTurnQueued(thread, 5_000);
    now = 5_040;
    turnTrace(thread, "start", true);
    now = 5_090;
    turnTrace(thread, "send");
    now = 5_250;
    noteFirstResponse(thread);
    noteFirstResponse(thread);
    expect(turnCounters(thread)).toEqual({ queueMs: 90, firstResponseMs: 160 });
    expect(spy).not.toHaveBeenCalled();
  });
});
