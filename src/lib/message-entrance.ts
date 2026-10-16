// Which person bubbles play their entrance (animate-msg-in). Only a message
// that is genuinely new: just sent from here (still optimistic) or written
// moments ago. Opening a thread, switching back to one, "Show earlier", or a
// window that mounts again draws its rows still. The server's copy of a line
// sent from here replaces the optimistic one with a new id but the same
// sendId, so the entrance plays once per send, not twice.

/** A message written this recently (ms) still enters. */
export const ENTRANCE_WINDOW_MS = 1500;
const MAX_REMEMBERED = 200;

const entered = new Set<string>();

/** Whether this mount of `message` plays its entrance. Called once per
 * mount (a useState initializer); claims the message so a later mount of
 * the same send does not play it again. */
export function claimMessageEntrance(message: { id: string; at: number; sendId?: string }, now = Date.now()): boolean {
  const key = message.sendId ?? message.id;
  if (entered.has(key)) return false;
  const fresh = message.id.startsWith("optimistic-") || (Number.isFinite(message.at) && Math.abs(now - message.at) < ENTRANCE_WINDOW_MS);
  if (!fresh) return false;
  entered.add(key);
  if (entered.size > MAX_REMEMBERED) {
    const oldest = entered.values().next().value;
    if (oldest !== undefined) entered.delete(oldest);
  }
  return true;
}

/** Tests only: forget every claimed entrance. */
export function resetMessageEntrances(): void {
  entered.clear();
}
