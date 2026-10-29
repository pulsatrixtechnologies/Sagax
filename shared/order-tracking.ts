// Order tracking (2026-10-29): after record_purchase, the purchase card
// follows the parcel: ordered, shipped, out for delivery, delivered, with the
// carrier, the tracking number and link, and the expected day. The bot reads
// the carrier's page or the shop's email and says what it found with
// update_order_tracking; Sagax wakes it again to check until the parcel is
// delivered (server/order-follow-ups.ts). Nothing here is read by Sagax from
// a page: it is what the bot declared, and the card says so.

export const ORDER_STEPS = ["ordered", "shipped", "in_transit", "out_for_delivery", "delivered", "exception"] as const;
export type OrderStep = (typeof ORDER_STEPS)[number];

/** The four steps a card draws; in transit is still shipped. */
export const ORDER_STEPPER: readonly OrderStep[] = ["ordered", "shipped", "out_for_delivery", "delivered"];

export interface OrderTracking {
  step: OrderStep;
  carrier?: string;
  number?: string;
  /** The carrier's or the shop's tracking page, http(s). */
  url?: string;
  /** The day the parcel is expected, YYYY-MM-DD. */
  eta?: string;
  /** One short line: "Held at the depot", "Left at the front door". */
  note?: string;
  updatedAt: number;
}

export const ORDER_TRACKING_LIMITS = { carrier: 60, number: 64, url: 1_000, note: 160 } as const;

/** Hours before Sagax asks the bot to check again, and the bounds a bot may pick. */
export const ORDER_CHECK_HOURS = { default: 24, min: 1, max: 168 } as const;
/** A parcel is followed for at most this long after the order. */
export const ORDER_FOLLOW_MAX_MS = 30 * 24 * 60 * 60_000;

export function isOrderStep(value: unknown): value is OrderStep {
  return typeof value === "string" && (ORDER_STEPS as readonly string[]).includes(value);
}

/** Where a step sits on the four-step bar (in transit is shipped; a problem is -1). */
export function orderStepIndex(step: OrderStep): number {
  if (step === "in_transit") return 1;
  return ORDER_STEPPER.indexOf(step);
}

export function orderStepLabel(step: OrderStep): string {
  switch (step) {
    case "ordered": return "Ordered";
    case "shipped": return "Shipped";
    case "in_transit": return "In transit";
    case "out_for_delivery": return "Out for delivery";
    case "delivered": return "Delivered";
    default: return "Delivery problem";
  }
}

const INVISIBLE = /[​-‏‪-‮⁠-⁩﻿]/g;

function plain(value: unknown, max: number): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  let text = "";
  for (const char of String(value).replace(INVISIBLE, "")) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) text += char;
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? "" : text;
}

function webUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > ORDER_TRACKING_LIMITS.url) return "";
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function realDate(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && year >= 2000 && year <= 2100;
}

export type TrackingInput = Omit<OrderTracking, "updatedAt">;

/** A `tracking` object from a tool call. Undefined when absent; a string is the refusal. */
export function parseTracking(raw: unknown, fallbackStep?: OrderStep): TrackingInput | string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return "tracking: must be an object {step, carrier?, number?, url?, eta?, note?}.";
  const row = raw as Record<string, unknown>;
  const step = row.step === undefined ? fallbackStep : row.step;
  if (!isOrderStep(step)) return `tracking.step: one of ${ORDER_STEPS.join(", ")}.`;
  const carrier = plain(row.carrier, ORDER_TRACKING_LIMITS.carrier);
  const number = plain(row.number ?? row.tracking_number, ORDER_TRACKING_LIMITS.number).replace(/\s/g, "");
  const url = row.url === undefined ? "" : webUrl(row.url);
  if (row.url !== undefined && !url) return "tracking.url: the tracking page, an http or https address.";
  const eta = typeof row.eta === "string" ? row.eta.trim() : "";
  if (eta && !realDate(eta)) return "tracking.eta: the expected day, YYYY-MM-DD.";
  const note = plain(row.note, ORDER_TRACKING_LIMITS.note);
  return { step, ...(carrier ? { carrier } : {}), ...(number ? { number } : {}), ...(url ? { url } : {}), ...(eta ? { eta } : {}), ...(note ? { note } : {}) };
}

/** The hours a bot asked for before the next check, bounded. */
export function checkAgainHours(raw: unknown): number {
  const value = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value)) return ORDER_CHECK_HOURS.default;
  return Math.min(ORDER_CHECK_HOURS.max, Math.max(ORDER_CHECK_HOURS.min, Math.round(value)));
}

/** "Shipped, Canada Post, expected 2026-11-02": the card's line and the text fallback. */
export function trackingLine(tracking: OrderTracking): string {
  return [
    orderStepLabel(tracking.step),
    [tracking.carrier, tracking.number].filter(Boolean).join(" "),
    tracking.eta && tracking.step !== "delivered" ? `expected ${tracking.eta}` : "",
    tracking.note,
  ].filter(Boolean).join(", ");
}

export interface UpdateTrackingCall {
  orderRef?: string;
  tracking: TrackingInput;
  checkAgainHours: number;
}

/** update_order_tracking arguments. A string is the refusal. */
export function parseUpdateTrackingCall(params: unknown): UpdateTrackingCall | string {
  const args = (params as { arguments?: unknown } | null)?.arguments;
  const row = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : {};
  if (row.step === undefined || row.step === null || row.step === "") return "update_order_tracking needs step.";
  const tracking = parseTracking(row);
  if (tracking === undefined) return "update_order_tracking needs step.";
  if (typeof tracking === "string") return tracking.replace(/^tracking\./, "");
  const orderRef = plain(row.order_ref, 64);
  return { ...(orderRef ? { orderRef } : {}), tracking, checkAgainHours: checkAgainHours(row.check_again_hours) };
}

export const UPDATE_ORDER_TRACKING_TOOL = "update_order_tracking";

const TRACKING_PROPERTIES = {
  step: { type: "string", enum: [...ORDER_STEPS], description: "Where the parcel is: ordered, shipped, in_transit, out_for_delivery, delivered, or exception (a delay, a return, a lost parcel)." },
  carrier: { type: "string", description: "The carrier, such as Canada Post or UPS." },
  number: { type: "string", description: "The tracking number." },
  url: { type: "string", description: "The tracking page (the carrier's or the shop's)." },
  eta: { type: "string", description: "The expected delivery day, YYYY-MM-DD." },
  note: { type: "string", description: "One short line the person should know, such as Held at the depot." },
} as const;

export const ORDER_TRACKING_SCHEMA = {
  type: "object",
  description: "Shipping, when the confirmation page shows it: the step (usually ordered), the carrier, the tracking number and page, the expected day.",
  properties: TRACKING_PROPERTIES,
  additionalProperties: false,
} as const;

export const UPDATE_ORDER_TRACKING_TOOL_SPEC = {
  name: UPDATE_ORDER_TRACKING_TOOL,
  description:
    "Say where an order you placed (with record_purchase) is now, after reading the carrier's tracking page or the shop's email: the step, the carrier, the tracking number and page, the expected day. The purchase card in the conversation shows it. order_ref is the order number you recorded; without it, the latest order of this conversation. Sagax asks you to check again after check_again_hours (24 by default) until the parcel is delivered; tell the person when the step changes, not on every check.",
  inputSchema: {
    type: "object",
    properties: {
      order_ref: { type: "string", description: "The order number you recorded with record_purchase." },
      ...TRACKING_PROPERTIES,
      check_again_hours: { type: "integer", minimum: ORDER_CHECK_HOURS.min, maximum: ORDER_CHECK_HOURS.max, description: "Hours before Sagax asks you to check again (24 by default). Ignored once delivered." },
    },
    required: ["step"],
    additionalProperties: false,
  },
} as const;
