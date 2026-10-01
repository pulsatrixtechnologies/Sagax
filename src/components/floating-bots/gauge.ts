// The energy bar under a floating mascot: how much of the model's context
// window its bot's current thread has left, from the same figures as the
// chat header's ring (src/lib/usage.ts contextShare). Full bar = plenty of
// context left; it drains as the thread fills the window.

export interface FloatingContext {
  /** Share of the window used, 0..100; absent when the window size is unknown. */
  percent?: number;
  tokens: number;
  window?: number;
  /** The header's own detail, already translated: "Context 142k (52% of 272k)". */
  detail: string;
  /** The short label: "Context 24%". */
  label: string;
}

export type GaugeLevel = "ok" | "warn" | "danger" | "unknown";

export interface Gauge {
  /** Energy left, 0..100: 100 - used. */
  remaining: number;
  level: GaugeLevel;
  /** Nearly full context: the bar pulses. */
  pulse: boolean;
}

/** Same thresholds as the header ring: amber from half full, red from 80 %. */
export function gaugeFor(context: FloatingContext | null | undefined): Gauge | null {
  if (!context) return null;
  if (context.percent === undefined || !Number.isFinite(context.percent)) return { remaining: 100, level: "unknown", pulse: false };
  const used = Math.min(100, Math.max(0, Math.round(context.percent)));
  const level: GaugeLevel = used >= 80 ? "danger" : used >= 50 ? "warn" : "ok";
  return { remaining: 100 - used, level, pulse: used > 85 };
}

/** The bar's segments lit for an amount left (10 segments). */
export const GAUGE_SEGMENTS = 10;
export function litSegments(remaining: number): number {
  return Math.max(0, Math.min(GAUGE_SEGMENTS, Math.ceil((remaining / 100) * GAUGE_SEGMENTS)));
}

/** The bar shows this long after the last interaction, or after a threshold is crossed. */
export const GAUGE_LINGER_MS = 3000;
/** Context use (%) the person is told about once it is crossed. */
export const GAUGE_THRESHOLDS = [50, 80, 85] as const;

/** Whether going from `before` to `after` percent crosses one of the thresholds upward. */
export function crossedThreshold(before: number | undefined, after: number | undefined): boolean {
  if (before === undefined || after === undefined) return false;
  return GAUGE_THRESHOLDS.some((mark) => before < mark && after >= mark);
}

/** The bar shows only while the person deals with the mascot, and a moment after. */
export function gaugeShown(state: { interacting: boolean; lingerUntil: number }, now: number): boolean {
  return state.interacting || now < state.lingerUntil;
}

