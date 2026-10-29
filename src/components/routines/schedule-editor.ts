// The routine editor's schedule in human terms (2026-10-29): what the
// Repeat picker and HumanScheduleFields hold, and the cron schedule they
// save. Cron stays under the hood (shared/schedule-model.ts); the person
// reads a sentence, the times, the days and the zone by its city.
import { t } from "@/lib/i18n";
import { cronLocale } from "@/lib/schedule-label";
import { cronScheduleWords } from "../../../shared/cron-label";
import { normalizeCronSchedule, nextCronRuns, type RoutineCronSchedule } from "../../../shared/routine-schedule";
import {
  cronToScheduleModel,
  defaultScheduleModel,
  scheduleModelToCron,
  timeZoneCity,
  WORK_WEEK,
  type ScheduleFrequency,
  type ScheduleModel,
} from "../../../shared/schedule-model";
import type { RoutineSchedule } from "@/lib/routines";

export type ScheduleDraft = { model: ScheduleModel; timeZone: string };

/** The frequencies the Repeat picker lists, in its order (Every N minutes or
 * hours is the interval's own fields). */
export const PICKER_FREQUENCIES: ScheduleFrequency[] = ["hourly", "daily", "weekdays", "days", "monthly", "yearly"];

export function personTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function wallClock(at: number, timeZone: string): { time: string; day: number; month: number; weekday: number } {
  let parts: Intl.DateTimeFormatPart[];
  const options: Intl.DateTimeFormatOptions = { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" };
  try {
    parts = new Intl.DateTimeFormat("en-US", { ...options, timeZone }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).formatToParts(at);
  }
  const part = (name: string) => parts.find((value) => value.type === name)?.value ?? "0";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(part("weekday"));
  return { time: `${part("hour")}:${part("minute")}`, day: Number(part("day")), month: Number(part("month")), weekday: Math.max(0, weekday) };
}

/** The draft an editor opens on: the saved schedule's own model when it has
 * one, else a model at the start time. `fits` is false for a cron no model
 * describes (the editor keeps it under Advanced). */
export function scheduleDraftFor(schedule: RoutineSchedule | { type: string } | undefined, at: number): { draft: ScheduleDraft; fits: boolean } {
  if (schedule?.type === "cron") {
    const cron = schedule as RoutineCronSchedule;
    const model = cronToScheduleModel(cron.expression);
    const clock = wallClock(at, cron.timeZone);
    const fallback = defaultScheduleModel({ times: [clock.time], monthDay: clock.day, month: clock.month });
    return { draft: { model: model ?? fallback, timeZone: cron.timeZone }, fits: Boolean(model) };
  }
  const timeZone = personTimeZone();
  const clock = wallClock(at, timeZone);
  if (schedule?.type === "daily") {
    const daily = schedule as Extract<RoutineSchedule, { type: "daily" }>;
    const days = [...new Set(daily.weekdays)].sort((a, b) => a - b);
    const frequency: ScheduleFrequency = days.length === 7 ? "daily" : days.join(",") === WORK_WEEK.join(",") ? "weekdays" : "days";
    return { draft: { model: defaultScheduleModel({ frequency, times: [daily.time], weekdays: days, monthDay: clock.day, month: clock.month }), timeZone }, fits: true };
  }
  return { draft: { model: defaultScheduleModel({ times: [clock.time], weekdays: [clock.weekday], monthDay: clock.day, month: clock.month }), timeZone }, fits: true };
}

/** "(Toronto time)" / "(heure de Toronto)". */
export function zonePhrase(timeZone: string): string {
  return t("scheduleEditor.zone", { city: timeZoneCity(timeZone) });
}

/** The live sentence: the list's own wording, then the zone in words. */
export function scheduleSentenceFor(schedule: Pick<RoutineCronSchedule, "expression" | "timeZone">): string {
  return `${cronScheduleWords(schedule, cronLocale())} ${zonePhrase(schedule.timeZone)}`;
}

const PROBLEM_KEYS = {
  noTime: "scheduleEditor.problem.noTime",
  noDays: "scheduleEditor.problem.noDays",
  badTime: "scheduleEditor.problem.badTime",
} as const;

export type ScheduleEditorValue = { schedule: RoutineCronSchedule | null; runs: number[]; sentence: string; error: string };

/** The cron schedule a draft saves, its next three runs and its sentence,
 * or the reason it cannot be saved, in words. */
export function scheduleEditorValue(draft: ScheduleDraft, after: number): ScheduleEditorValue {
  const built = scheduleModelToCron(draft.model);
  if ("problem" in built) return { schedule: null, runs: [], sentence: "", error: t(PROBLEM_KEYS[built.problem]) };
  let schedule: RoutineCronSchedule;
  try {
    schedule = normalizeCronSchedule({ type: "cron", expression: built.expression, timeZone: draft.timeZone }, after);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { schedule: null, runs: [], sentence: "", error: /timezone/i.test(message) ? t("scheduleEditor.problem.zone") : t("scheduleEditor.problem.noRuns") };
  }
  return { schedule, runs: nextCronRuns(schedule, after, 3), sentence: scheduleSentenceFor(schedule), error: "" };
}

/** A saved cron kept as it is (Advanced): its sentence and next runs. */
export function keptScheduleValue(schedule: RoutineCronSchedule, after: number): ScheduleEditorValue {
  try {
    return { schedule, runs: nextCronRuns(schedule, after, 3), sentence: scheduleSentenceFor(schedule), error: "" };
  } catch {
    return { schedule, runs: [], sentence: scheduleSentenceFor(schedule), error: "" };
  }
}

/** Every N minutes or hours from a cron `*\/N` the interval fields open on. */
export function everyMinutesOf(model: ScheduleModel): number | null {
  return model.frequency === "every" ? model.every * (model.unit === "hours" ? 60 : 1) : null;
}

/** What a pattern saves: a single time on chosen days in the person's own
 * zone stays a plain daily schedule (the calendar can still move it); any
 * other pattern is its cron schedule. */
export function savedPatternSchedule(schedule: RoutineCronSchedule, draft: ScheduleDraft): RoutineCronSchedule | { type: "daily"; time: string; weekdays: number[] } {
  const { model } = draft;
  const days = model.frequency === "daily" ? [0, 1, 2, 3, 4, 5, 6] : model.frequency === "weekdays" ? [...WORK_WEEK] : model.frequency === "days" ? [...new Set(model.weekdays)].sort((a, b) => a - b) : null;
  const times = model.times;
  if (days && days.length && times.length === 1 && draft.timeZone === personTimeZone()) return { type: "daily", time: times[0]!, weekdays: days };
  return schedule;
}
