// When a phone gets a push. The desktop's rule (src/lib/attention.ts
// messageAttention, #222) is "notify unless the person is looking at that
// very conversation in a focused window". A server does not know which
// conversation a window shows, but it hears the proof: a focused window
// that shows a conversation marks it read (POST /api/threads/:id/read, the
// read receipt, or /api/groups/:id/read and /api/bots/:id/read). So:
//
//   nudge        always, at once (priority 10)
//   achievement  only when no client of the person is connected, and only
//                when they asked for system notifications of achievements
//   message, approval, routine
//                at once when no client of the person is connected; else
//                after a short grace, unless a client of theirs marked that
//                conversation read in the meantime ("somebody saw it")

import type { PushKind } from "./payload.ts";

/** How long an open client gets to show the conversation before the phone rings. */
export const PUSH_SEEN_GRACE_MS = 8_000;

export function shouldPush(input: { kind: PushKind; connected: boolean; seen: boolean }): boolean {
  if (input.kind === "nudge") return true;
  if (input.kind === "achievement") return !input.connected;
  return !input.seen;
}

/** Whether the push waits the grace before the decision. */
export function waitsForGrace(input: { kind: PushKind; connected: boolean }): boolean {
  if (input.kind === "nudge" || input.kind === "achievement") return false;
  return input.connected;
}

/** At most `max` pushes per person in any `windowMs`. In memory only. */
export class PushRateLimiter {
  private readonly sent = new Map<string, number[]>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max = 20, windowMs = 5 * 60_000) {
    this.max = max;
    this.windowMs = windowMs;
  }

  tryTake(person: string, now: number): boolean {
    const recent = (this.sent.get(person) ?? []).filter((at) => now - at < this.windowMs);
    if (recent.length >= this.max) {
      this.sent.set(person, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(person, recent);
    if (this.sent.size > 4000) {
      for (const [key, times] of this.sent) if (!times.some((at) => now - at < this.windowMs)) this.sent.delete(key);
    }
    return true;
  }
}
