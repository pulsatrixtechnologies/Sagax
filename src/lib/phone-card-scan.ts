// "Scanner avec l'iPhone" (audit row 84): the New card form asks the
// person's paired iPhone to read a card (server/routes/phone-tools.ts). The
// answer is the number, the expiry and the name; never the security code.
import { api } from "@/state/store";

export type ScannedCard = { number: string; expMonth?: number; expYear?: number; holder?: string };
export type CardScanOutcome =
  | { status: "done"; card: ScannedCard }
  | { status: "pending"; requestId: string }
  | { status: "denied" }
  | { status: "failed"; error: string }
  | { status: "expired" };

const BASE = "/api/me/phone-tools/card-scan";

export const cardScanAvailable = () => api<{ available: boolean }>(BASE).then((row) => row.available === true).catch(() => false);
export const startCardScan = () => api<{ requestId: string; expiresAt: number }>(BASE, { method: "POST", body: "{}" });
export const waitCardScan = (id: string, signal?: AbortSignal) =>
  api<CardScanOutcome>(`${BASE}/${encodeURIComponent(id)}/wait`, { method: "POST", body: "{}", signal });
export const cancelCardScan = (id: string) => api<{ ok: true; cancelled: boolean }>(`${BASE}/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => undefined);

/** Waits until the phone answered, the scan expired or `signal` aborted. */
export async function runCardScan(signal: AbortSignal, deps = { start: startCardScan, wait: waitCardScan, cancel: cancelCardScan }): Promise<Exclude<CardScanOutcome, { status: "pending" }> | { status: "cancelled" }> {
  const { requestId } = await deps.start();
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      const outcome = await deps.wait(requestId, signal);
      if (outcome.status !== "pending") return outcome;
    }
  } catch (error) {
    if (signal.aborted) {
      await deps.cancel(requestId);
      return { status: "cancelled" };
    }
    throw error;
  }
}
