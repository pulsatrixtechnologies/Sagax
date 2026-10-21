// Exact or flexible start times for a repeating routine.
//
// Exact (or no timing at all) starts at the scheduled slot. Flexible starts
// somewhere in [slot - early, slot + late]. The choice is a pure hash of the
// routine id and that slot, so a restart picks the same instant. The next
// slot is still computed from the nominal time, not from the shifted start.
// Stored early and late minutes are kept as written. The half-gap cap is
// applied only when a start is placed.

import { nextCronRuns } from "./routine-schedule.ts";

export const FLEXIBLE_DEFAULT_EARLY_MINUTES = 15;
export const FLEXIBLE_DEFAULT_LATE_MINUTES = 15;

/** A window wider than this is rejected. The cap against the gap is smaller. */
const MAX_WINDOW_MINUTES = 366 * 24 * 60;

/** Low 48 bits of the hash, matching the width of the old digest. */
const ROLL_MASK = (1n << 48n) - 1n;
const ROLL_SPACE = 2 ** 48;

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export interface RoutineWindowTiming {
  /** Absent or "exact": start at the scheduled time. "flexible": start inside the window. */
  timing?: "exact" | "flexible";
  /** Minutes before the scheduled time. Only stored for flexible timing. */
  windowEarlyMinutes?: number;
  /** Minutes after the scheduled time. 0 means ready by the scheduled time. */
  windowLateMinutes?: number;
}

export interface TimingRequest {
  timing?: unknown;
  windowEarlyMinutes?: unknown;
  windowLateMinutes?: unknown;
}

interface GapSchedule {
  type: string;
  everyMinutes?: number;
  weekdays?: number[];
  expression?: string;
  timeZone?: string;
  windowEarlyMinutes?: number;
  windowLateMinutes?: number;
}

export function timingRequestOf(value: unknown): TimingRequest | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (raw.timing == null && raw.windowEarlyMinutes == null && raw.windowLateMinutes == null) return undefined;
  return {
    timing: raw.timing,
    windowEarlyMinutes: raw.windowEarlyMinutes,
    windowLateMinutes: raw.windowLateMinutes,
  };
}

export function hasTimingInput(value: unknown): boolean {
  return timingRequestOf(value) !== undefined;
}

/** Minutes the two sides may share: half the gap, rounded down. */
export function windowCapMinutes(gapMs: number): number {
  if (!Number.isFinite(gapMs) || gapMs <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.floor(gapMs / 2 / 60_000));
}

/**
 * Shrink a window so early + late is at most `cap`. A zero side stays zero.
 * Leftover minutes go to the side with the larger fractional share; a tie
 * keeps the early side.
 */
export function clampTimingWindow(early: number, late: number, cap: number): { early: number; late: number } {
  if (cap <= 0) return { early: 0, late: 0 };
  if (early + late <= cap) return { early, late };
  if (early === 0) return { early: 0, late: Math.min(late, cap) };
  if (late === 0) return { early: Math.min(early, cap), late: 0 };
  const scale = cap / (early + late);
  let nextEarly = Math.floor(early * scale);
  let nextLate = Math.floor(late * scale);
  const leftover = cap - nextEarly - nextLate;
  if (leftover > 0) {
    const earlyFrac = early * scale - nextEarly;
    const lateFrac = late * scale - nextLate;
    if (earlyFrac >= lateFrac) nextEarly += leftover;
    else nextLate += leftover;
  }
  return { early: nextEarly, late: nextLate };
}

/** Shortest gap between the selected weekdays, as a whole number of days. */
export function dailyGapMs(weekdays: readonly number[]): number {
  const days = [...new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  if (days.length <= 1) return 7 * DAY_MS;
  let minDays = 7;
  for (let index = 0; index < days.length; index++) {
    const current = days[index]!;
    const next = days[(index + 1) % days.length]!;
    const gap = (next - current + 7) % 7;
    if (gap > 0 && gap < minDays) minDays = gap;
  }
  return minDays * DAY_MS;
}

/** One cron field (star, a number, a range, a step, or a comma list) as sorted values. */
function parseCronField(field: string, min: number, max: number): number[] | null {
  if (/[^0-9*,/-]/.test(field)) return null;
  const values = new Set<number>();
  for (const piece of field.split(",")) {
    if (!piece) return null;
    const stepSplit = piece.split("/");
    if (stepSplit.length > 2) return null;
    const step = stepSplit.length === 2 ? Number(stepSplit[1]) : 1;
    if (!Number.isInteger(step) || step <= 0) return null;
    const range = stepSplit[0]!;
    let start: number;
    let end: number;
    if (range === "*") {
      start = min;
      end = max;
    } else if (range.includes("-")) {
      const [rawStart, rawEnd] = range.split("-");
      if (rawEnd === undefined || range.split("-").length !== 2) return null;
      start = Number(rawStart);
      end = Number(rawEnd);
    } else {
      start = Number(range);
      end = stepSplit.length === 2 ? max : start;
    }
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) return null;
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values.size === 0 ? null : [...values].sort((a, b) => a - b);
}

/**
 * Shortest gap of a five-field cron whose day, month and weekday are all
 * unrestricted. The minute/hour grid repeats every day, so the wrap from the
 * last minute of an hour to the next hour is included (a step of 7 minutes
 * is 4 minutes at the hour boundary, not 7).
 */
function analyticalCronGapMs(expression: string): number | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minuteField, hourField, dayField, monthField, weekdayField] = fields;
  if (dayField !== "*" || monthField !== "*" || (weekdayField !== "*" && weekdayField !== "?")) return null;
  const minutes = parseCronField(minuteField!, 0, 59);
  const hours = parseCronField(hourField!, 0, 23);
  if (!minutes || !hours) return null;
  const slots: number[] = [];
  for (const hour of hours) {
    for (const minute of minutes) slots.push(hour * 60 + minute);
  }
  slots.sort((a, b) => a - b);
  if (slots.length === 0) return null;
  let min = 24 * 60;
  for (let index = 1; index < slots.length; index++) min = Math.min(min, slots[index]! - slots[index - 1]!);
  min = Math.min(min, 24 * 60 - slots[slots.length - 1]! + slots[0]!);
  return min * 60_000;
}

/** Shortest gap across a full cycle, for expressions the grid above does not cover. */
function walkedCronGapMs(expression: string, timeZone: string, after: number): number {
  const schedule = { type: "cron" as const, expression, timeZone };
  let cursor = after;
  let previous: number | undefined;
  let min = Number.POSITIVE_INFINITY;
  const deadline = after + 8 * 366 * DAY_MS;
  for (let step = 0; step < 2500; step++) {
    const next = nextCronRuns(schedule, cursor, 1)[0];
    if (next == null || next > deadline) break;
    if (previous != null) {
      min = Math.min(min, next - previous);
      const covered = next - after;
      if (min < 12 * HOUR_MS && covered >= 36 * HOUR_MS) break;
      if (covered >= 366 * DAY_MS) break;
    }
    previous = next;
    cursor = next;
  }
  return min;
}

/** Gap used to cap a window. Cron is the real shortest gap, not a short sample. */
export function nominalGapMs(schedule: GapSchedule, after: number): number {
  if (schedule.type === "interval" && typeof schedule.everyMinutes === "number") return schedule.everyMinutes * 60_000;
  if (schedule.type === "daily") return dailyGapMs(schedule.weekdays ?? []);
  if (schedule.type === "cron" && schedule.expression && schedule.timeZone) {
    return analyticalCronGapMs(schedule.expression) ?? walkedCronGapMs(schedule.expression, schedule.timeZone, after);
  }
  return Number.POSITIVE_INFINITY;
}

function wholeMinutes(value: unknown, fallback: number, label: string): number {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_WINDOW_MINUTES) {
    throw new Error(`${label} must be a whole number of minutes`);
  }
  return value;
}

/** Null means exact. Flexible minutes are stored as given; the cap is applied later. */
export function resolveTiming(request: TimingRequest | undefined): { early: number; late: number } | null {
  if (!request) return null;
  const { timing } = request;
  if (timing == null) {
    if (request.windowEarlyMinutes != null || request.windowLateMinutes != null) {
      throw new Error("Exact timing does not take a window");
    }
    return null;
  }
  if (timing === "exact") {
    if (request.windowEarlyMinutes != null || request.windowLateMinutes != null) {
      throw new Error("Exact timing does not take a window");
    }
    return null;
  }
  if (timing !== "flexible") throw new Error("Choose exact or flexible timing");
  return {
    early: wholeMinutes(request.windowEarlyMinutes, FLEXIBLE_DEFAULT_EARLY_MINUTES, "The early window"),
    late: wholeMinutes(request.windowLateMinutes, FLEXIBLE_DEFAULT_LATE_MINUTES, "The late window"),
  };
}

/** The window a start is actually placed in: stored minutes, narrowed to the cap. */
export function cappedWindow(schedule: GapSchedule, at: number): { early: number; late: number } {
  const early = schedule.windowEarlyMinutes ?? FLEXIBLE_DEFAULT_EARLY_MINUTES;
  const late = schedule.windowLateMinutes ?? FLEXIBLE_DEFAULT_LATE_MINUTES;
  return clampTimingWindow(early, late, windowCapMinutes(nominalGapMs(schedule, at)));
}

/** Keep an explicit "exact" choice on a proposal so a later save can clear flexible. */
export function presentTiming<T extends { type: string }>(schedule: T, source: unknown): T {
  if (schedule.type === "once") {
    if (hasTimingInput(source)) throw new Error("A one-time routine starts at its chosen time");
    return schedule;
  }
  const request = timingRequestOf(source);
  if (!request) return schedule;
  if (request.timing === "exact") {
    if (request.windowEarlyMinutes != null || request.windowLateMinutes != null) {
      throw new Error("Exact timing does not take a window");
    }
    return { ...schedule, timing: "exact" as const };
  }
  const resolved = resolveTiming(request);
  if (!resolved) return schedule;
  return {
    ...schedule,
    timing: "flexible" as const,
    windowEarlyMinutes: resolved.early,
    windowLateMinutes: resolved.late,
  };
}

/** Persistence form. Exact and absent timing omit the keys entirely. */
export function applyTiming<T extends { type: string }>(schedule: T, source: unknown): T {
  const presented = presentTiming(schedule, source);
  if ((presented as { timing?: string }).timing === "exact") return schedule;
  return presented;
}

export function storedTiming(schedule: {
  type: string;
  timing?: "exact" | "flexible";
  windowEarlyMinutes?: number;
  windowLateMinutes?: number;
}): RoutineWindowTiming {
  if (schedule.type === "once" || schedule.timing !== "flexible") return {};
  return {
    timing: "flexible",
    windowEarlyMinutes: schedule.windowEarlyMinutes,
    windowLateMinutes: schedule.windowLateMinutes,
  };
}

export function isFlexibleSchedule<T extends { type: string; timing?: string }>(
  schedule: T,
): schedule is T & { timing: "flexible"; windowEarlyMinutes?: number; windowLateMinutes?: number } {
  return schedule.type !== "once" && schedule.timing === "flexible";
}

/** FNV-1a over the UTF-16 code units, low 48 bits. No platform crypto. */
function fnv1a48(text: string): number {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let index = 0; index < text.length; index++) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return Number(hash & ROLL_MASK);
}

/** Inclusive instant in [nominal - early, nominal + late]. Span 0 is the nominal. */
export function flexibleStartAt(routineId: string, nominalAt: number, earlyMinutes: number, lateMinutes: number): number {
  const earlyMs = earlyMinutes * 60_000;
  const lateMs = lateMinutes * 60_000;
  const span = earlyMs + lateMs;
  if (span <= 0) return nominalAt;
  const roll = fnv1a48(`${routineId}\0${nominalAt}`);
  const offset = Math.min(span, Math.floor((roll / ROLL_SPACE) * (span + 1)));
  return nominalAt - earlyMs + offset;
}

/**
 * The hashed start, moved forward to `notBefore` while the window is still
 * open. Null when even the late edge is already past.
 */
export function placedStart(picked: number, nominalAt: number, lateMinutes: number, notBefore: number): number | null {
  const latest = nominalAt + lateMinutes * 60_000;
  if (latest < notBefore) return null;
  return picked >= notBefore ? picked : notBefore;
}

/**
 * First nominal strictly after `afterNominal` whose window is still open at
 * `notBefore`, and strictly after `lastFiredNominalAt` when one is set.
 * One step: interval math and cron's next-after-now already jump, so a long
 * outage does not walk slot by slot. The start is never before `notBefore`.
 */
export function planFlexibleStart(input: {
  routineId: string;
  schedule: GapSchedule;
  afterNominal: number;
  notBefore: number;
  lastFiredNominalAt?: number;
  nextNominal: (after: number) => number | null;
}): { start: number; nominal: number } | null {
  const window = cappedWindow(input.schedule, input.notBefore);
  const lateMs = window.late * 60_000;
  let cursor = Math.max(input.afterNominal, input.notBefore - lateMs - 1);
  const fired = input.lastFiredNominalAt;
  if (fired != null && fired > cursor) cursor = fired;
  const nominal = input.nextNominal(cursor);
  if (nominal == null || !(nominal > cursor)) return null;
  if (fired != null && nominal <= fired) return null;
  const picked = flexibleStartAt(input.routineId, nominal, window.early, window.late);
  const placed = placedStart(picked, nominal, window.late, input.notBefore);
  return placed == null ? null : { start: placed, nominal };
}
