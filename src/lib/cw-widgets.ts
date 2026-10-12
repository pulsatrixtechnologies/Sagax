// Display helpers for ConnectWise widgets, and the one request a widget
// makes: an approval card. The widget never calls ConnectWise.

import type { CwAction } from "../../shared/cw-widgets/actions.ts";
import type { CwWidget } from "../../shared/cw-widgets/types.ts";

export type CwPoster = (path: string, body: unknown) => Promise<unknown>;

/** POST /api/threads/:id/cw-actions. `poster` is the app's `api` in the
 * product and a stand-in in tests, so a test never reaches ConnectWise. */
export async function postCwWidgetAction(
  threadId: string,
  action: CwAction,
  botId: string | undefined,
  poster: CwPoster,
): Promise<unknown> {
  return poster(`/api/threads/${encodeURIComponent(threadId)}/cw-actions`, {
    action,
    ...(botId ? { botId } : {}),
  });
}

export async function postCwWidgetActionViaApi(threadId: string, action: CwAction, botId?: string): Promise<unknown> {
  const { api } = await import("@/state/store");
  return postCwWidgetAction(threadId, action, botId, (path, body) => api(path, { method: "POST", body: JSON.stringify(body) }));
}

export type CwTone = "ok" | "warn" | "bad" | "idle";

export function cwStatusTone(status: string | undefined, settled?: boolean): CwTone {
  if (settled) return "ok";
  const text = (status ?? "").toLowerCase();
  if (/crit|urgent|bloqu|overdue|expir|cancel|annul/.test(text)) return "bad";
  if (/attente|wait|high|élev|eleve|confirm|nouveau|new|ouvert|open/.test(text)) return "warn";
  if (/ferm|clos|résolu|resolv|done|fait|active|billable/.test(text)) return "ok";
  return "idle";
}

export function formatCwHours(hours: number | undefined): string {
  if (hours === undefined || !Number.isFinite(hours)) return "";
  const rounded = Math.round(hours * 100) / 100;
  return `${rounded} h`;
}

export function formatCwAmount(amount: number | undefined): string {
  if (amount === undefined || !Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("fr-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
}

export function formatCwWhen(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-CA", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

export function formatCwDay(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("fr-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

export function cwFamilyLabelKey(family: CwWidget["family"]): "cw.tickets" | "cw.time" | "cw.schedule" | "cw.agreements" | "cw.companies" {
  switch (family) {
    case "ticket": return "cw.tickets";
    case "time": return "cw.time";
    case "schedule": return "cw.schedule";
    case "agreement": return "cw.agreements";
    case "company": return "cw.companies";
  }
}
