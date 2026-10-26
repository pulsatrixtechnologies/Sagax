// Auto on This computer: the warning is a notice the person reads once on
// this computer, not a card on every bot and every conversation
// (2026-10-26, JC: what happens on the person's own machine is theirs).
// After the first OK the warning confirms itself; the server still gets
// acknowledgeLocalAuto: true, and destructive and sensitive actions still
// stop there. A renderer preference of this computer; nothing new goes to
// the server. Private or blocked storage keeps the answer for the session.

export const LOCAL_AUTO_ACK_KEY = "sagax-local-auto-acknowledged";

let sessionAck = false;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Whether the person already confirmed Auto on this computer once. */
export function localAutoAcknowledged(store: Storage | null = storage()): boolean {
  if (sessionAck) return true;
  try {
    return store?.getItem(LOCAL_AUTO_ACK_KEY) === "1";
  } catch {
    return false;
  }
}

/** Remember the first confirmation. */
export function rememberLocalAutoAck(store: Storage | null = storage()): void {
  sessionAck = true;
  try {
    store?.setItem(LOCAL_AUTO_ACK_KEY, "1");
  } catch {
    /* blocked storage: the session keeps it */
  }
}

/** Tests only. */
export function resetLocalAutoAck(): void {
  sessionAck = false;
}
