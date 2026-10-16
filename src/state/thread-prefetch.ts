// The sidebar's thread prefetch (src/lib/thread-page-cache.ts), handed down
// by StoreProvider. Absent outside it (a test rendering a row alone), where
// rows simply do not prefetch.
import { createContext, useContext } from "react";
import type { ThreadPrefetcher } from "@/lib/thread-page-cache";

export const ThreadPrefetchContext = createContext<ThreadPrefetcher | null>(null);

export function useThreadPrefetch(): ThreadPrefetcher | null {
  return useContext(ThreadPrefetchContext);
}

/** What a thread row reports: the pointer rests on it, leaves it, or the
 * keyboard reaches it. */
export type ThreadPrefetchIntent = "hover" | "leave" | "focus";
