import { Loader2, Repeat2 } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import { routineScheduleState } from "@/lib/routine-display";
import type { Bot } from "@/state/store";
import { Switch } from "../SettingsPrimitives";

export function RoutineList({ routines, loading, error, onOpen, onToggle }: {
  routines: Routine[];
  runs: RoutineRun[];
  bots?: Bot[];
  loading?: boolean;
  error?: boolean;
  onOpen: (routine: Routine) => void;
  onLogs?: (routine: Routine) => void;
  onToggle?: (routine: Routine) => void;
}) {
  const sorted = [...routines].sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name));
  return <div aria-label={t("routines.list")}>
    {error && <div role="alert" className="rounded-lg bg-danger/10 p-3 text-[12px] text-danger">{t("routines.loadError")}</div>}
    {loading && <p role="status" className="flex items-center gap-2 p-3 text-[12px] text-ink-secondary"><Loader2 size={14} className="animate-spin" />{t("routines.loading")}</p>}
    {!loading && !error && sorted.length === 0 && <div className="rounded-xl border border-dashed border-hairline/50 p-5 text-center text-[13px] text-ink-secondary"><Repeat2 size={20} className="mx-auto mb-2 opacity-60" />{t("routines.empty")}</div>}
    {sorted.length > 0 && (
      <div className="flex flex-col gap-0.5">
        {sorted.map((routine) => (
          <div key={routine.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover">
            <button type="button" onClick={() => onOpen(routine)} className="min-w-0 flex-1 text-left">
              <span className="block truncate text-[13px] leading-[18px] text-ink">{routine.name}</span>
              <span className="block truncate text-[13px] leading-[18px] text-ink-secondary">{routineScheduleState(routine)}</span>
            </button>
            <Switch
              checked={routine.enabled}
              aria-label={routine.enabled ? "Pause" : "Resume"}
              onClick={() => onToggle?.(routine)}
            />
          </div>
        ))}
      </div>
    )}
  </div>;
}
