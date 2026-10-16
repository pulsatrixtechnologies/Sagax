// The last pages of recently seen threads, so opening one again (or one the
// pointer rested on in the sidebar) draws at once from memory while the
// switch asks the server for the real page. Only reads fill it: the page a
// switch answered, the transcript left on screen by a switch, and a prefetch
// (GET /api/threads/:id/messages, which changes nothing on the server).
import type { Message } from "@/state/store";

/** One thread's newest page, as the server last gave it. */
export interface ThreadPage {
  messages: Message[];
  hasMore?: boolean;
  activeLeafId?: string | null;
  /** When it was read (ms since the epoch). */
  at: number;
}

export const THREAD_PAGE_CACHE_SIZE = 10;

/** Least recently used first out, `capacity` threads at most. */
export class ThreadPageCache {
  private readonly pages = new Map<string, ThreadPage>();

  constructor(readonly capacity = THREAD_PAGE_CACHE_SIZE) {}

  /** The page, now the most recently used. */
  get(threadId: string): ThreadPage | undefined {
    const page = this.pages.get(threadId);
    if (!page) return undefined;
    this.pages.delete(threadId);
    this.pages.set(threadId, page);
    return page;
  }

  /** The page, leaving the order as it is. */
  peek(threadId: string): ThreadPage | undefined {
    return this.pages.get(threadId);
  }

  set(threadId: string, page: ThreadPage): void {
    this.pages.delete(threadId);
    this.pages.set(threadId, page);
    while (this.pages.size > this.capacity) {
      const oldest = this.pages.keys().next().value;
      if (oldest === undefined) break;
      this.pages.delete(oldest);
    }
  }

  delete(threadId: string): void {
    this.pages.delete(threadId);
  }

  clear(): void {
    this.pages.clear();
  }

  get size(): number {
    return this.pages.size;
  }

  /** Thread ids, least recently used first. */
  keys(): string[] {
    return [...this.pages.keys()];
  }
}

export interface ThreadPrefetcherOptions {
  cache: ThreadPageCache;
  /** A read of the thread's newest page. Never a call that moves the selection. */
  fetchPage: (threadId: string, signal: AbortSignal) => Promise<Omit<ThreadPage, "at">>;
  /** Pointer rest before a hover reads (ms). */
  hoverDelayMs?: number;
  /** A page younger than this is not read again (ms). */
  freshMs?: number;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface ThreadPrefetcher {
  /** The pointer entered a thread's row: read it once the pointer rests. */
  hover(threadId: string): void;
  /** The pointer left before the read started: forget it. */
  leave(threadId: string): void;
  /** Keyboard focus reached a thread's row: read it now. */
  focus(threadId: string): void;
  /** Whether a read of this thread is under way. */
  pending(threadId: string): boolean;
  /** Stop every timer and read (the provider unmounted). */
  dispose(): void;
}

export const PREFETCH_HOVER_DELAY_MS = 80;
export const PREFETCH_FRESH_MS = 15_000;

export function createThreadPrefetcher({
  cache,
  fetchPage,
  hoverDelayMs = PREFETCH_HOVER_DELAY_MS,
  freshMs = PREFETCH_FRESH_MS,
  now = Date.now,
  setTimer = (run, ms) => setTimeout(run, ms),
  clearTimer = (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
}: ThreadPrefetcherOptions): ThreadPrefetcher {
  const timers = new Map<string, unknown>();
  const inFlight = new Map<string, AbortController>();
  let disposed = false;

  const read = (threadId: string) => {
    timers.delete(threadId);
    if (disposed || inFlight.has(threadId)) return;
    const held = cache.peek(threadId);
    if (held && now() - held.at < freshMs) return;
    const controller = new AbortController();
    const startedAt = now();
    inFlight.set(threadId, controller);
    fetchPage(threadId, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        // a switch stored a page while this read was out: that one is newer
        const current = cache.peek(threadId);
        if (current && current.at >= startedAt) return;
        cache.set(threadId, { ...page, at: now() });
      })
      // a failed prefetch costs nothing: the switch reads the page anyway
      .catch(() => {})
      .finally(() => {
        if (inFlight.get(threadId) === controller) inFlight.delete(threadId);
      });
  };

  return {
    hover(threadId) {
      if (disposed || timers.has(threadId) || inFlight.has(threadId)) return;
      timers.set(threadId, setTimer(() => read(threadId), hoverDelayMs));
    },
    leave(threadId) {
      const timer = timers.get(threadId);
      if (timer === undefined) return;
      clearTimer(timer);
      timers.delete(threadId);
    },
    focus(threadId) {
      const timer = timers.get(threadId);
      if (timer !== undefined) clearTimer(timer);
      read(threadId);
    },
    pending: (threadId) => inFlight.has(threadId),
    dispose() {
      disposed = true;
      for (const timer of timers.values()) clearTimer(timer);
      timers.clear();
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
    },
  };
}
