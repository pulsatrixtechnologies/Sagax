// The composer's one lock (2026-10-29): while a thread's page is on its way
// after a switch (Bot.awaitingThreadSnapshot), and only for a bounded time.
// The person can always write: a page that never lands (a server restart,
// a dropped fetch, a frame that changed the thread without its messages)
// used to keep the box disabled until the next successful switch. A send
// after the bound goes to the thread as usual; the server appends it and
// the stream brings it back with the rest.
import { useEffect, useState } from "react";

/** How long a page may be awaited with the box disabled. */
export const SNAPSHOT_LOCK_MAX_MS = 8_000;

/** Whether the box is locked now: awaited, and not for longer than the bound. */
export function lockedNow(awaiting: boolean, awaitedSince: number | null, now: number, maxMs = SNAPSHOT_LOCK_MAX_MS): boolean {
  if (!awaiting || awaitedSince === null) return false;
  return now - awaitedSince < maxMs;
}

/** `awaiting`, cut off after `maxMs`; a new wait starts the bound over. */
export function useBoundedLock(awaiting: boolean, maxMs = SNAPSHOT_LOCK_MAX_MS): boolean {
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!awaiting) {
      setExpired(false);
      return;
    }
    const timer = setTimeout(() => setExpired(true), maxMs);
    return () => clearTimeout(timer);
  }, [awaiting, maxMs]);
  return awaiting && !expired;
}
