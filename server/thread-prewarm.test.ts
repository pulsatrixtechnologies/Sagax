import { afterEach, describe, expect, it, vi } from "vitest";
import { prewarmWindowMs, ThreadPrewarm } from "./thread-prewarm.ts";

afterEach(() => vi.useRealTimers());

describe("ThreadPrewarm", () => {
  it("aborts the warm when nothing is sent within the window, and a refresh pushes it back", async () => {
    vi.useFakeTimers();
    const warm = new ThreadPrewarm({ windowMs: 1_000 });
    let signal: AbortSignal | null = null;
    expect(warm.begin("t1", "p", async (s) => { signal = s; })).toBe("started");
    await warm.join("t1");
    vi.advanceTimersByTime(800);
    expect(warm.begin("t1", "p", async () => { throw new Error("never runs twice"); })).toBe("extended");
    vi.advanceTimersByTime(800);
    expect(signal!.aborted).toBe(false);
    vi.advanceTimersByTime(300);
    expect(signal!.aborted).toBe(true);
    expect(warm.has("t1")).toBe(false);
  });

  it("a real turn claims the warm without aborting it", async () => {
    vi.useFakeTimers();
    const warm = new ThreadPrewarm({ windowMs: 1_000 });
    let signal: AbortSignal | null = null;
    warm.begin("t1", "p", async (s) => { signal = s; });
    await warm.join("t1");
    warm.claim("t1");
    vi.advanceTimersByTime(5_000);
    expect(signal!.aborted).toBe(false);
    expect(warm.has("t1")).toBe(false);
  });

  it("limits new warms per person per minute; refreshes are free", () => {
    let now = 0;
    const warm = new ThreadPrewarm({ windowMs: 1_000, perPersonPerMinute: 2, now: () => now });
    expect(warm.begin("a", "p", async () => {})).toBe("started");
    expect(warm.begin("b", "p", async () => {})).toBe("started");
    expect(warm.begin("c", "p", async () => {})).toBe("limited");
    expect(warm.begin("a", "p", async () => {})).toBe("extended");
    expect(warm.begin("c", "q", async () => {})).toBe("started");
    now = 61_000;
    expect(warm.begin("d", "p", async () => {})).toBe("started");
    for (const id of ["a", "b", "c", "d"]) warm.cancel(id);
  });

  it("keeps at most maxWaiting warms: a new one closes the oldest", () => {
    const warm = new ThreadPrewarm({ windowMs: 60_000, maxWaiting: 2 });
    const signals: Record<string, AbortSignal> = {};
    for (const id of ["a", "b", "c"]) warm.begin(id, "p", async (s) => { signals[id] = s; });
    expect(signals.a!.aborted).toBe(true);
    expect(signals.b!.aborted).toBe(false);
    expect(warm.size()).toBe(2);
    for (const id of ["b", "c"]) warm.cancel(id);
  });

  it("join waits for the setup of the warm in flight", async () => {
    const warm = new ThreadPrewarm({ windowMs: 60_000 });
    let release!: () => void;
    warm.begin("t1", "p", () => new Promise<void>((resolve) => { release = resolve; }));
    let joined = false;
    const waiting = warm.join("t1").then(() => { joined = true; });
    await Promise.resolve();
    expect(joined).toBe(false);
    release();
    await waiting;
    expect(joined).toBe(true);
    warm.cancel("t1");
  });

  it("reads the window from SAGAX_PREWARM_WINDOW_MS, bounded", () => {
    expect(prewarmWindowMs({})).toBe(90_000);
    expect(prewarmWindowMs({ SAGAX_PREWARM_WINDOW_MS: "5000" })).toBe(5_000);
    expect(prewarmWindowMs({ SAGAX_PREWARM_WINDOW_MS: "99999999" })).toBe(600_000);
    expect(prewarmWindowMs({ SAGAX_PREWARM_WINDOW_MS: "nope" })).toBe(90_000);
  });
});
