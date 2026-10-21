// Exact or flexible start times for a repeating routine.
//
// Exact (or no timing at all) starts at the scheduled slot. Flexible starts
// somewhere in [slot - early, slot + late]. The choice is a hash of the
// routine id and that slot, so a restart picks the same instant. The next
// slot is still computed from the nominal time, not from the shifted start.

import { createHash } from "node:crypto";

import { nextCronRuns } from "./routine-schedule.ts";

export const FLEXIBLE_DEFAULT_EARLY_MINUTES = 15;
export const FLEXIBLE_DEFAULT_LATE_MINUTES = 15;

/** A window wider than this is rejected. The cap against the gap is smaller. */
const MAX_WINDOW_MINUTES = 366 * 24 * 60;

/** How many later slots to try when the hashed start is already in the past. */
const MAX_SLOT_WALK = 512;

const ROLL_SPACE = 2 ** 48;

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
  const dayMs = 24 * 60 * 60_000;
  const days = [...new Set(weekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  if (days.length <= 1) return 7 * dayMs;
  let minDays = 7;
  for (let index = 0; index < days.length; index++) {
    const current = days[index]!;
    const next = days[(index + 1) % days.length]!;
    const gap = (next - current + 7) % 7;
    if (gap > 0 && gap < minDays) minDays = gap;
  }
  return minDays * dayMs;
}

/** Gap used to cap a window. Cron uses the smallest of the next few slots. */
export function nominalGapMs(
  schedule: { type: string; everyMinutes?: number; weekdays?: number[]; expression?: string; timeZone?: string },
  after: number,
): number {
  if (schedule.type === "interval" && typeof schedule.everyMinutes === "number") return schedule.everyMinutes * 60_000;
  if (schedule.type === "daily") return dailyGapMs(schedule.weekdays ?? []);
  if (schedule.type === "cron" && schedule.expression && schedule.timeZone) {
    const runs = nextCronRuns({ type: "cron", expression: schedule.expression, timeZone: schedule.timeZone }, after, 8);
    let min = Number.POSITIVE_INFINITY;
    for (let index = 1; index < runs.length; index++) min = Math.min(min, runs[index]! - runs[index - 1]!);
    return min;
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

/** Null means exact: store no timing fields. Flexible minutes are already capped. */
export function resolveTiming(request: TimingRequest | undefined, gapMs: number): { early: number; late: number } | null {
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
  const early = wholeMinutes(request.windowEarlyMinutes, FLEXIBLE_DEFAULT_EARLY_MINUTES, "The early window");
  const late = wholeMinutes(request.windowLateMinutes, FLEXIBLE_DEFAULT_LATE_MINUTES, "The late window");
  return clampTimingWindow(early, late, windowCapMinutes(gapMs));
}

/** Keep an explicit "exact" choice on a proposal so a later save can clear flexible. */
export function presentTiming<T extends { type: string }>(schedule: T, source: unknown, gapMs: number): T {
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
  const resolved = resolveTiming(request, gapMs);
  if (!resolved) return schedule;
  return {
    ...schedule,
    timing: "flexible" as const,
    windowEarlyMinutes: resolved.early,
    windowLateMinutes: resolved.late,
  };
}

/** Persistence form. Exact and absent timing omit the keys entirely. */
export function applyTiming<T extends { type: string }>(schedule: T, source: unknown, gapMs: number): T {
  const presented = presentTiming(schedule, source, gapMs);
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

/** Inclusive instant in [nominal - early, nominal + late]. Span 0 is the nominal. */
export function flexibleStartAt(routineId: string, nominalAt: number, earlyMinutes: number, lateMinutes: number): number {
  const earlyMs = earlyMinutes * 60_000;
  const lateMs = lateMinutes * 60_000;
  const span = earlyMs + lateMs;
  if (span <= 0) return nominalAt;
  const roll = createHash("sha256").update(`${routineId}\0${nominalAt}`).digest().readUIntBE(0, 6);
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
 * First slot strictly after `afterNominal` whose window is still open at
 * `notBefore`. The start is never before `notBefore`.
 */
export function planFlexibleStart(input: {
  routineId: string;
  schedule: { windowEarlyMinutes?: number; windowLateMinutes?: number };
  afterNominal: number;
  notBefore: number;
  nextNominal: (after: number) => number | null;
}): { start: number; nominal: number } | null {
  const early = input.schedule.windowEarlyMinutes ?? FLEXIBLE_DEFAULT_EARLY_MINUTES;
  const late = input.schedule.windowLateMinutes ?? FLEXIBLE_DEFAULT_LATE_MINUTES;
  let cursor = input.afterNominal;
  for (let step = 0; step < MAX_SLOT_WALK; step++) {
    const nominal = input.nextNominal(cursor);
    if (nominal == null || !(nominal > cursor)) return null;
    const picked = flexibleStartAt(input.routineId, nominal, early, late);
    const placed = placedStart(picked, nominal, late, input.notBefore);
    if (placed != null) return { start: placed, nominal };
    cursor = nominal;
  }
  return null;
}
