// The thread page cache (least recently used out) and the sidebar prefetch:
// a hover reads after the pointer rests, leaving first reads nothing, focus
// reads at once, a fresh page or a read under way is not read again, and
// only the read it is given is ever called.
import { describe, expect, it, vi } from "vitest";
import { createThreadPrefetcher, ThreadPageCache, type ThreadPage } from "./thread-page-cache";
import type { Message } from "@/state/store";

const page = (id: string, at = 0): ThreadPage => ({ messages: [{ id, role: "user", text: id, at } as Message], at });

describe("ThreadPageCache", () => {
  it("drops the least recently used thread past its capacity", () => {
    const cache = new ThreadPageCache(3);
    cache.set("a", page("a"));
    cache.set("b", page("b"));
    cache.set("c", page("c"));
    // reading a makes it the most recent, so b goes first
    expect(cache.get("a")?.messages[0]?.id).toBe("a");
    cache.set("d", page("d"));
    expect(cache.keys()).toEqual(["c", "a", "d"]);
    expect(cache.peek("b")).toBeUndefined();
    // peek leaves the order alone
    cache.peek("c");
    cache.set("e", page("e"));
    expect(cache.keys()).toEqual(["a", "d", "e"]);
  });

  it("replaces a thread's page and moves it to the end", () => {
    const cache = new ThreadPageCache(2);
    cache.set("a", page("a", 1));
    cache.set("b", page("b", 1));
    cache.set("a", page("a2", 2));
    expect(cache.keys()).toEqual(["b", "a"]);
    expect(cache.peek("a")?.messages[0]?.id).toBe("a2");
    cache.delete("b");
    expect(cache.size).toBe(1);
  });
});

function harness(options: { freshMs?: number } = {}) {
  vi.useFakeTimers();
  let clock = 1_000;
  const cache = new ThreadPageCache(10);
  const resolvers = new Map<string, (value: Omit<ThreadPage, "at">) => void>();
  const fetchPage = vi.fn((threadId: string, _signal: AbortSignal) =>
    new Promise<Omit<ThreadPage, "at">>((resolve) => { resolvers.set(threadId, resolve); }));
  const prefetcher = createThreadPrefetcher({ cache, fetchPage, now: () => clock, ...options });
  const answer = async (threadId: string) => {
    resolvers.get(threadId)?.({ messages: page(threadId).messages, hasMore: true });
    await vi.runAllTimersAsync();
  };
  return { cache, fetchPage, prefetcher, answer, tick: (ms: number) => { clock += ms; vi.advanceTimersByTime(ms); } };
}

describe("createThreadPrefetcher", () => {
  it("reads a hovered thread after 80 ms of rest, once", async () => {
    const { cache, fetchPage, prefetcher, answer, tick } = harness();
    prefetcher.hover("t1");
    tick(79);
    expect(fetchPage).not.toHaveBeenCalled();
    tick(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage.mock.calls[0]![0]).toBe("t1");
    // hovering again while the read is out does not read again
    prefetcher.hover("t1");
    tick(100);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await answer("t1");
    expect(cache.peek("t1")).toMatchObject({ hasMore: true, at: 1_180 });
    vi.useRealTimers();
  });

  it("reads nothing when the pointer leaves before it rests", () => {
    const { fetchPage, prefetcher, tick } = harness();
    prefetcher.hover("t1");
    tick(50);
    prefetcher.leave("t1");
    tick(200);
    expect(fetchPage).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reads a focused thread at once and skips a fresh page", async () => {
    const { cache, fetchPage, prefetcher, answer, tick } = harness({ freshMs: 10_000 });
    prefetcher.focus("t2");
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await answer("t2");
    tick(5_000);
    prefetcher.focus("t2");
    expect(fetchPage).toHaveBeenCalledTimes(1);
    tick(5_000);
    prefetcher.focus("t2");
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(cache.size).toBe(1);
    vi.useRealTimers();
  });

  it("keeps a page a switch stored while the read was out", async () => {
    const { cache, prefetcher, answer, tick } = harness();
    prefetcher.focus("t3");
    tick(10);
    cache.set("t3", { messages: [], hasMore: false, at: 1_010 });
    await answer("t3");
    expect(cache.peek("t3")).toEqual({ messages: [], hasMore: false, at: 1_010 });
    vi.useRealTimers();
  });

  it("stops timers and aborts reads when disposed", () => {
    const { cache, fetchPage, prefetcher, tick } = harness();
    prefetcher.focus("t4");
    const signal = fetchPage.mock.calls[0]![1];
    prefetcher.hover("t5");
    prefetcher.dispose();
    tick(500);
    expect(signal.aborted).toBe(true);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(0);
    vi.useRealTimers();
  });
});
