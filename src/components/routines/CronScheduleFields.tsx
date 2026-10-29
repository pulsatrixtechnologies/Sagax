// The next runs of a repeating schedule, in its own zone named by its city
// ("Next runs · Toronto"). The schedule itself is edited in words by
// HumanScheduleFields; the expression is never shown (2026-10-29).
import { useMemo } from "react";
import { nextCronRuns, type RoutineCronSchedule } from "../../../shared/routine-schedule";
import { timeZoneCity } from "../../../shared/schedule-model";

import { activeLocale, t } from "@/lib/i18n";

export function CronRunDates({ runs, timeZone, paused = false }: { runs: number[]; timeZone: string; paused?: boolean }) {
  if (!runs.length) return null;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat(activeLocale(), { timeZone, weekday: "short", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } catch {
    return null;
  }
  return <div className="space-y-1 text-[11px] leading-relaxed text-ink-secondary" aria-label={paused ? t("cronPreview.pausedAria") : t("cronPreview.nextAria")}>
    <div className="font-medium">{paused ? t("cronPreview.paused") : t("cronPreview.next")} · {timeZoneCity(timeZone)}</div>
    {runs.map((at) => <div key={at}><time dateTime={new Date(at).toISOString()}>{format.format(at)}</time></div>)}
    <div className="pt-1">{t("cronPreview.clock")}</div>
  </div>;
}

export function CronSchedulePreview({ schedule, paused = false }: { schedule: RoutineCronSchedule; paused?: boolean }) {
  const runs = useMemo(() => {
    try { return nextCronRuns(schedule, Date.now(), 3); } catch { return []; }
  }, [schedule]);
  return <CronRunDates runs={runs} timeZone={schedule.timeZone} paused={paused} />;
}
