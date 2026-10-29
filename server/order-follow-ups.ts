// Order follow-ups (2026-10-29, shared/order-tracking.ts): the routine that
// record_purchase starts. Each order the bot recorded is checked again at its
// due time: Sagax wakes the bot in the conversation of the purchase, the bot
// reads the tracking page or the shop's email and answers with
// update_order_tracking, which sets the next due time. Delivered, or 30 days
// after the order, it stops. One small file (order-follow-ups.json, 0600)
// holds who and when only; where the parcel is lives on the purchase itself,
// in the person's vault.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ORDER_FOLLOW_MAX_MS } from "../shared/order-tracking.ts";
import { writeFileAtomic } from "./atomic.ts";

export interface OrderFollowUp {
  principalId: string;
  purchaseId: string;
  botId: string;
  threadId: string;
  /** When the bot is asked to check (ms). */
  dueAt: number;
  /** When the order was recorded: following stops 30 days after it. */
  orderedAt: number;
}

const FILE = "order-follow-ups.json";
/** Wakes per sweep at most: a backlog after a long sleep drains over a few sweeps. */
const PER_SWEEP = 20;

export class OrderFollowUps {
  private rows: OrderFollowUp[];
  private readonly path: string;
  private readonly now: () => number;

  constructor(dataDir: string, now: () => number = Date.now) {
    this.now = now;
    this.path = join(dataDir, FILE);
    this.rows = this.read();
  }

  private read(): OrderFollowUp[] {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as { rows?: unknown };
      return Array.isArray(parsed.rows) ? parsed.rows.filter(isFollowUp) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    writeFileAtomic(this.path, `${JSON.stringify({ version: 1, rows: this.rows }, null, 2)}\n`, { mode: 0o600 });
  }

  /** Check this order again in `hours`; 0 stops following it. */
  schedule(row: Omit<OrderFollowUp, "dueAt" | "orderedAt"> & { orderedAt?: number }, hours: number): void {
    const now = this.now();
    const before = this.rows.find((candidate) => candidate.principalId === row.principalId && candidate.purchaseId === row.purchaseId);
    this.rows = this.rows.filter((candidate) => candidate !== before);
    const orderedAt = before?.orderedAt ?? row.orderedAt ?? now;
    const dueAt = now + hours * 3_600_000;
    if (hours > 0 && dueAt < orderedAt + ORDER_FOLLOW_MAX_MS) {
      this.rows.push({ principalId: row.principalId, purchaseId: row.purchaseId, botId: row.botId, threadId: row.threadId, dueAt, orderedAt });
    }
    this.save();
  }

  /** The follow-ups due now, taken off the list: each one is asked once,
   * and the bot's update_order_tracking schedules the next. One the bot
   * never answers is asked again a day later, until the 30 days run out. */
  takeDue(): OrderFollowUp[] {
    const now = this.now();
    const due = this.rows.filter((row) => row.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt).slice(0, PER_SWEEP);
    if (!due.length) return [];
    this.rows = this.rows.filter((row) => !due.includes(row));
    for (const row of due) {
      const retry = now + 24 * 3_600_000;
      if (retry < row.orderedAt + ORDER_FOLLOW_MAX_MS) this.rows.push({ ...row, dueAt: retry });
    }
    this.save();
    return due;
  }

  list(): readonly OrderFollowUp[] {
    return this.rows;
  }
}

function isFollowUp(value: unknown): value is OrderFollowUp {
  const row = value as Partial<OrderFollowUp> | null;
  return Boolean(row) && typeof row!.principalId === "string" && typeof row!.purchaseId === "string" && typeof row!.botId === "string"
    && typeof row!.threadId === "string" && typeof row!.dueAt === "number" && typeof row!.orderedAt === "number";
}

/** What the bot is told when a follow-up is due. */
export function followUpNote(order: { merchant: string; orderRef?: string; tracking?: { carrier?: string; number?: string; url?: string } }): string {
  const where = [order.tracking?.carrier, order.tracking?.number].filter(Boolean).join(" ");
  return `Sagax order follow-up: check where the order ${order.orderRef ? `${order.orderRef} ` : ""}from ${order.merchant} is now${where ? ` (${where}${order.tracking?.url ? `, ${order.tracking.url}` : ""})` : order.tracking?.url ? ` (${order.tracking.url})` : ""}: the carrier's tracking page or the shop's email. Then call update_order_tracking${order.orderRef ? ` with order_ref "${order.orderRef}"` : ""} and the step you found. Tell the person only if the step changed or there is a problem.`;
}
