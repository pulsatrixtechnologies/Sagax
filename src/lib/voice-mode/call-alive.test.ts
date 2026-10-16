import { afterEach, describe, expect, it, vi } from "vitest";

import { CALL_ALIVE_MS, callTimers, keepCallAlive } from "./call-alive";

afterEach(() => {
  vi.useRealTimers();
});

describe("keepCallAlive", () => {
  it("beats every five minutes, and at once when the page is visible or online again", () => {
    vi.useFakeTimers();
    const window = new EventTarget();
    const document = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    const alive = vi.fn();
    const stop = keepCallAlive(alive, { window, document });
    vi.advanceTimersByTime(CALL_ALIVE_MS);
    expect(alive).toHaveBeenCalledTimes(1);
    // hidden: no beat for that change
    document.dispatchEvent(new Event("visibilitychange"));
    expect(alive).toHaveBeenCalledTimes(1);
    // back from a sleep longer than the server's 20 minute expiry
    document.visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(alive).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("online"));
    expect(alive).toHaveBeenCalledTimes(3);
    stop();
    window.dispatchEvent(new Event("online"));
    vi.advanceTimersByTime(CALL_ALIVE_MS * 2);
    expect(alive).toHaveBeenCalledTimes(3);
  });
});

describe("callTimers", () => {
  it("a retry armed by the call never fires after the call ended", () => {
    vi.useFakeTimers();
    const timers = callTimers();
    const send = vi.fn();
    timers.later(send, 800);
    expect(timers.size).toBe(1);
    timers.clear();
    vi.advanceTimersByTime(1_000);
    expect(send).not.toHaveBeenCalled();
    timers.later(send, 800);
    vi.advanceTimersByTime(800);
    expect(send).toHaveBeenCalledTimes(1);
    expect(timers.size).toBe(0);
  });
});
