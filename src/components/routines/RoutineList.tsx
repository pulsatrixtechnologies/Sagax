import { useEffect, useState } from "react";
import { Loader2, Repeat2 } from "lucide-react";
import { t } from "@/lib/i18n";
import { loadRoutineDelegation, startRoutineDelegation } from "@/lib/routine-delegation";
import type { Routine, RoutineRun } from "@/lib/routines";
import type { RoutineSuspendReason } from "../../../shared/routines";
import { routineWhenLabel } from "@/lib/routine-display";
import type { Bot } from "@/state/store";
import { Switch } from "../SettingsPrimitives";

const SUSPEND_REASON_KEYS = {
  delegation_missing: "routines.suspendReason.delegation_missing",
  delegation_ended: "routines.suspendReason.delegation_ended",
  delegation_revoked: "routines.suspendReason.delegation_revoked",
  person_out: "routines.suspendReason.person_out",
  no_right: "routines.suspendReason.no_right",
} as const;

/** Slice 6: "Paused: <why>" for a routine the server paused. */
export function routineSuspendedText(reason: RoutineSuspendReason): string {
  return t("routines.suspended", { reason: t(SUSPEND_REASON_KEYS[reason]) });
}

/** Slice 6: the viewer runs routines here but has not allowed them to act
 * in their name (organization server). */
export function RoutineDelegationBanner({ routines, viewerPrincipalId, initial }: {
  routines: Routine[];
  viewerPrincipalId: string | null | undefined;
  initial?: "active" | "none";
}) {
  const mine = Boolean(viewerPrincipalId) && routines.some((routine) => routine.enabled && routine.runAs?.principalId === viewerPrincipalId);
  const [state, setState] = useState<"active" | "none" | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!mine || initial) return;
    let live = true;
    void loadRoutineDelegation().then((status) => { if (live) setState(status.state); }, () => {});
    return () => { live = false; };
  }, [mine, initial]);
  if (!mine || state !== "none") return null;
  return (
    <div role="status" data-routine-delegation-banner className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-[12px] text-ink">
      <span className="min-w-0 flex-1 break-words">{t("routines.delegationBanner")}</span>
      <button
        type="button"
        className="ui-button min-h-[44px] md:min-h-0"
        disabled={busy}
        onClick={() => { setBusy(true); void startRoutineDelegation().catch(() => setBusy(false)); }}
      >
        {t("org.routineDelegation.allow")}
      </button>
    </div>
  );
}

export function RoutineList({ routines, loading, error, onOpen, onToggle, viewerPrincipalId, grouped = false }: {
  routines: Routine[];
  /** Slice 6: the signed-in person on an organization server. */
  viewerPrincipalId?: string | null;
  runs: RoutineRun[];
  bots?: Bot[];
  loading?: boolean;
  error?: boolean;
  onOpen: (routine: Routine) => void;
  onLogs?: (routine: Routine) => void;
  onToggle?: (routine: Routine) => void;
  /** The bot panel: one rounded card, rows split by hairlines. */
  grouped?: boolean;
}) {
  const sorted = [...routines].sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity) || a.name.localeCompare(b.name));
  return <div aria-label={t("routines.list")}>
    <RoutineDelegationBanner routines={routines} viewerPrincipalId={viewerPrincipalId} />
    {error && <div role="alert" className="rounded-lg bg-danger/10 p-3 text-[12px] text-danger">{t("routines.loadError")}</div>}
    {loading && <p role="status" className="flex items-center gap-2 p-3 text-[12px] text-ink-secondary"><Loader2 size={14} className="animate-spin" />{t("routines.loading")}</p>}
    {!loading && !error && sorted.length === 0 && <div className="rounded-xl border border-dashed border-hairline/50 p-5 text-center text-[13px] text-ink-secondary"><Repeat2 size={20} className="mx-auto mb-2 opacity-60" />{t("routines.empty")}</div>}
    {sorted.length > 0 && (
      <div className={grouped ? "flex flex-col overflow-hidden rounded-xl border border-hairline-weak bg-card" : "flex flex-col gap-0.5"}>
        {sorted.map((routine) => {
          const when = routineWhenLabel(routine);
          return (
            <div key={routine.id} data-routine-row className={grouped ? "flex items-center gap-2.5 border-b border-hairline-weak px-3 py-2.5 last:border-b-0 hover:bg-hover" : "flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover"}>
              <button type="button" onClick={() => onOpen(routine)} className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] leading-[18px] text-ink">{routine.name}</span>
                <span data-routine-when={when} title={when} className="line-clamp-2 text-[13px] leading-[18px] text-ink-secondary">{when}</span>
                {(routine.runAs || routine.suspended) && (
                  <span className="mt-0.5 flex flex-wrap gap-1.5">
                    {routine.runAs && <span data-routine-run-as className="truncate rounded-md bg-inset px-1.5 text-[11.5px] leading-[18px] text-ink-secondary">{t("routines.runAs", { name: routine.runAs.name || routine.runAs.principalId })}</span>}
                    {routine.suspended && <span data-routine-suspended={routine.suspended.reason} className="truncate rounded-md bg-warning/10 px-1.5 text-[11.5px] leading-[18px] text-warning">{routineSuspendedText(routine.suspended.reason)}</span>}
                  </span>
                )}
              </button>
              <Switch
                checked={routine.enabled}
                aria-label={routine.enabled ? t("botPanel.routines.pause") : t("botPanel.routines.resume")}
                onClick={() => onToggle?.(routine)}
              />
            </div>
          );
        })}
      </div>
    )}
  </div>;
}
