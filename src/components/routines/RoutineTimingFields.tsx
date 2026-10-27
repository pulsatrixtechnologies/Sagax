import { t } from "@/lib/i18n";

const DEFAULT_EARLY_MINUTES = 15;
const DEFAULT_LATE_MINUTES = 15;

export function readTiming(schedule: {
  type: string;
  timing?: string;
  windowEarlyMinutes?: number;
  windowLateMinutes?: number;
}): { mode: "exact" | "flexible"; early: number; late: number } {
  const raw = schedule as { type: string; timing?: string; windowEarlyMinutes?: number; windowLateMinutes?: number };
  if (raw.type !== "once" && raw.timing === "flexible") {
    return {
      mode: "flexible",
      early: raw.windowEarlyMinutes ?? DEFAULT_EARLY_MINUTES,
      late: raw.windowLateMinutes ?? DEFAULT_LATE_MINUTES,
    };
  }
  return { mode: "exact", early: DEFAULT_EARLY_MINUTES, late: DEFAULT_LATE_MINUTES };
}

/** Exact repeating saves name the choice so a flexible routine can be turned back. */
export function withRoutineTiming<T extends { type: string }>(
  schedule: T,
  repeats: boolean,
  mode: "exact" | "flexible",
  earlyMinutes: number,
  lateMinutes: number,
): T & { timing?: "exact" | "flexible"; windowEarlyMinutes?: number; windowLateMinutes?: number } {
  const { timing: _timing, windowEarlyMinutes: _early, windowLateMinutes: _late, ...rest } = schedule as T & {
    timing?: unknown;
    windowEarlyMinutes?: unknown;
    windowLateMinutes?: unknown;
  };
  if (!repeats || schedule.type === "once" || mode !== "flexible") {
    if (!repeats || schedule.type === "once") return rest as T;
    return { ...rest, timing: "exact" } as T & { timing: "exact" };
  }
  const early = Number.isInteger(earlyMinutes) && earlyMinutes >= 0 ? earlyMinutes : DEFAULT_EARLY_MINUTES;
  const late = Number.isInteger(lateMinutes) && lateMinutes >= 0 ? lateMinutes : DEFAULT_LATE_MINUTES;
  return { ...rest, timing: "flexible", windowEarlyMinutes: early, windowLateMinutes: late } as T & {
    timing: "flexible";
    windowEarlyMinutes: number;
    windowLateMinutes: number;
  };
}

function wholeMinutes(value: string): number {
  const minutes = Number(value);
  return Number.isInteger(minutes) && minutes >= 0 ? minutes : 0;
}

export function RoutineTimingFields({
  mode,
  earlyMinutes,
  lateMinutes,
  onMode,
  onEarly,
  onLate,
}: {
  mode: "exact" | "flexible";
  earlyMinutes: number;
  lateMinutes: number;
  onMode: (mode: "exact" | "flexible") => void;
  onEarly: (minutes: number) => void;
  onLate: (minutes: number) => void;
}) {
  const field = "w-20 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong";
  return (
    <div className="flex flex-wrap items-center gap-2" data-routine-timing={mode}>
      <label className="flex items-center gap-2 text-[13px] text-ink">
        <span className="text-ink-secondary">{t("routineTiming.label")}</span>
        <select
          aria-label={t("routineTiming.label")}
          value={mode}
          onChange={(event) => onMode(event.target.value === "flexible" ? "flexible" : "exact")}
          className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink outline-none focus:border-border-strong"
        >
          <option value="exact">{t("routineTiming.exact")}</option>
          <option value="flexible">{t("routineTiming.flexible")}</option>
        </select>
      </label>
      {mode === "flexible" && (
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-secondary">
          <label className="flex items-center gap-1">
            {t("routineTiming.early")}
            <input
              aria-label={t("routineTiming.earlyAria")}
              type="number"
              min={0}
              step={1}
              value={earlyMinutes}
              onChange={(event) => onEarly(wholeMinutes(event.target.value))}
              className={field}
            />
            {t("routineTiming.min")}
          </label>
          <label className="flex items-center gap-1">
            {t("routineTiming.late")}
            <input
              aria-label={t("routineTiming.lateAria")}
              type="number"
              min={0}
              step={1}
              value={lateMinutes}
              onChange={(event) => onLate(wholeMinutes(event.target.value))}
              className={field}
            />
            {t("routineTiming.min")}
          </label>
          <span>{t("routineTiming.lateHelp")}</span>
        </span>
      )}
    </div>
  );
}
