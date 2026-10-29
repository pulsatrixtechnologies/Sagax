// A routine's page (2026-10-29), the way the Automations page and the bot
// panel open it: who runs it and what state it is in (active, paused, paused
// by itself after failures, suspended, finished, running right now), when it
// runs next and how its week went; then its runs, newest first, each one
// click away; and Configuration, everything the editor holds, read-only.
// The actions: Run now, Pause or Resume, Edit, Duplicate, Delete, plus the
// run logs filtered on it and where it reports.
import { Copy, ExternalLink, Loader2, Pause, Pencil, Play, Trash2, UsersRound } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import type { Routine, RoutineRun } from "@/lib/routines";
import { isRoutineProblemRun } from "@/lib/routines";
import { routineDateTime, routineNextText, routineRunAgo, routineRunDuration, routineRunLabel, routineRunPreview, routineRunTime, routineRunTone, routineState, routineWeekRunsText, type RoutineStateTone } from "@/lib/routine-display";
import { scheduleLabel, scheduleRawCron } from "@/lib/schedule-label";
import { formatUsd } from "@/lib/usage";
import type { Bot, Group } from "@/state/store";
import { BotAvatar } from "../Avatar";
import { ActivityStatusIcon } from "../bot-settings/ActivityCard";
import { activityChip } from "../bot-settings/ActivityWindow";
import { PILL, PRIMARY_PILL } from "../SettingsPrimitives";
import { RoutineConfiguration } from "./RoutineConfiguration";
import { runActivityStatus } from "./RoutineRunDetail";

export const STATE_TONES: Record<RoutineStateTone, string> = {
  active: "bg-success/15 text-success",
  paused: "bg-inset text-ink-secondary",
  warning: "bg-warning/15 text-warning",
  info: "bg-accent/12 text-accent-text",
  neutral: "bg-inset text-ink-secondary",
};

export type RoutineView = "runs" | "configuration";

/** One run of the routine's history: its state, when, how long, what it
 * cost and its first line. */
export function RunHistoryRow({ run, now, onOpen }: { run: RoutineRun; now: number; onOpen: (run: RoutineRun) => void }) {
  const duration = routineRunDuration(run, now);
  const cost = run.cost != null && run.cost > 0 ? formatUsd(run.cost) : null;
  const preview = routineRunPreview(run);
  const unread = isRoutineProblemRun(run) && !run.seenAt && !run.redacted;
  return (
    <li>
      <button type="button" data-run-row={run.id} onClick={() => onOpen(run)} aria-label={t("routines.openRun", { name: run.routineName, status: routineRunLabel(run) }) + (unread ? ` · ${t("routines.unread")}` : "")} className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <span className="mt-0.5"><ActivityStatusIcon status={runActivityStatus(run)} size={15} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[12.5px]">
            <span data-run-row-label className={cn("font-medium", routineRunTone(run))}>{routineRunLabel(run)}</span>
            <time dateTime={new Date(run.scheduledFor).toISOString()} title={routineDateTime(run.scheduledFor)} className="text-ink-secondary">{routineRunAgo(routineRunTime(run), now)}</time>
            {duration && <span className="text-ink-secondary">· {duration}</span>}
            {cost && <span className="text-ink-secondary">· {cost}</span>}
            {run.manual && <span className="text-ink-secondary">· {t("routines.trigger.manual")}</span>}
            {unread && <span className="size-1.5 self-center rounded-full bg-danger" title={t("routines.unread")} />}
          </span>
          {preview && <span className={cn("mt-0.5 block truncate text-[12px]", run.error && run.status !== "waiting" ? "text-danger" : "text-ink-secondary")}>{preview}</span>}
        </span>
      </button>
    </li>
  );
}

export function RoutineDetail({ routine, runs, bots, groups = [], viewerPrincipalId, now = Date.now(), compact = false, editable = true, canRun = false, inFlight = false, starting = false, working = false, canOpenResults = false, error, onOpenRun, onRunNow, onToggle, onEdit, onDuplicate, onDelete, onLogs, onOpenResults, onOpenGroup, actions = true, initialView = "runs" }: {
  routine: Routine;
  /** Every run kept for this routine, any order. */
  runs: RoutineRun[];
  bots: Bot[];
  groups?: Group[];
  viewerPrincipalId?: string | null;
  now?: number;
  /** The bot panel: one column, the panel's own action bar. */
  compact?: boolean;
  editable?: boolean;
  canRun?: boolean;
  inFlight?: boolean;
  starting?: boolean;
  working?: boolean;
  canOpenResults?: boolean;
  error?: string;
  onOpenRun: (run: RoutineRun) => void;
  onRunNow?: () => void;
  onToggle?: () => void;
  onEdit?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onLogs?: () => void;
  onOpenResults?: () => void;
  /** A team goal: its group. */
  onOpenGroup?: () => void;
  /** Draw the action row (the bot panel draws its own bar). */
  actions?: boolean;
  initialView?: RoutineView;
}) {
  const [view, setView] = useState<RoutineView>(initialView);
  const bot = bots.find((candidate) => candidate.id === routine.botId);
  const isRoomGoal = routine.target === "room-goal";
  const group = groups.find((candidate) => candidate.id === routine.groupId);
  const state = routineState(routine, runs);
  const history = [...runs].filter((run) => run.routineId === routine.id).sort((a, b) => routineRunTime(b) - routineRunTime(a));
  const rawCron = scheduleRawCron(routine.schedule);
  const skips = routine.awaySkips && !routine.awaySkips.reportedAt ? routine.awaySkips.count : 0;
  return (
    <div data-routine-detail className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <header className={cn("space-y-2.5 px-4 pt-4 sm:px-5", compact && "px-4")}>
          <div className="flex flex-wrap items-center gap-2">
            {bot
              ? <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline/50 bg-inset py-0.5 pl-0.5 pr-2 text-[11.5px] text-ink"><BotAvatar bot={bot} state={routine.enabled ? "idle" : "sleeping"} size={20} animated={false} />{bot.name}</span>
              : <span className="rounded-full border border-hairline/50 bg-inset px-2 py-0.5 text-[11.5px] text-ink">{routine.bot?.name ?? t("routines.unavailableBot")}</span>}
            {isRoomGoal && <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-secondary"><UsersRound size={13} aria-hidden="true" />{group?.name ?? t("routineCalendar.groupUnavailable")}</span>}
            <span data-routine-state={state.tone} className={cn("inline-flex items-center gap-1 rounded-md px-1.5 text-[11.5px] font-medium leading-[20px]", STATE_TONES[state.tone])}>
              {state.tone === "info" && <Loader2 size={11} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {state.label}
            </span>
            {routine.canEdit === false && <span className="text-[11.5px] text-ink-secondary">{t("routines.scope.readOnly")}</span>}
          </div>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[12.5px]">
            <dt className="text-ink-secondary">{t("routineDetail.trigger")}</dt>
            <dd data-routine-trigger className="flex min-w-0 items-start gap-1.5 text-ink"><span title={rawCron ?? undefined}>{scheduleLabel(routine.schedule)}</span>{routine.precheck?.kind === "watch" && <span className="shrink-0 rounded-md bg-inset px-1.5 text-[11px] leading-[18px] text-ink-secondary">{t("routineWatch.badge")}</span>}{routine.schedule.type === "cron" && <button type="button" data-copy-cron title={t("routines.copyCron")} aria-label={t("routines.copyCron")} onClick={() => { if (routine.schedule.type === "cron") void copyText(routine.schedule.expression); }} className="shrink-0 rounded-md p-0.5 text-ink-secondary hover:bg-raised hover:text-ink"><Copy size={12} /></button>}</dd>
            <dt className="text-ink-secondary">{t("routineDetail.nextRun")}</dt>
            <dd data-routine-next className="text-ink">{routineNextText(routine, now)}</dd>
            {routine.weekRuns && <><dt className="text-ink-secondary">{t("routineDetail.week")}</dt><dd data-routine-week-runs className="text-ink">{routineWeekRunsText(routine.weekRuns)}</dd></>}
            {(routine.skippedRuns ?? 0) > 0 && <><dt className="text-ink-secondary">{t("routineDetail.skipped")}</dt><dd className="text-ink">{routine.skippedRuns}{routine.lastSkippedAt ? ` · ${t("routines.lastSkipped", { date: routineDateTime(routine.lastSkippedAt) })}` : ""}</dd></>}
            {skips > 0 && <><dt className="text-ink-secondary">{t("routines.away.title")}</dt><dd className="text-ink">{t(skips === 1 ? "routines.away.skippedOne" : "routines.away.skippedMany", { count: skips, name: routine.name })}</dd></>}
          </dl>
          {routine.autoPaused && !routine.enabled && <p data-routine-auto-paused={routine.autoPaused.failures} className="text-[11.5px] text-warning">{t("routineDetail.autoPausedAt", { date: routineDateTime(routine.autoPaused.at) })}</p>}
          {error && <div role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-[11.5px] text-danger">{error}</div>}
          <div role="tablist" aria-label={t("activity.view.aria")} className="flex gap-1 pt-1">
            {(["runs", "configuration"] as const).map((id) => (
              <button key={id} type="button" role="tab" id={`routine-view-${id}`} aria-selected={view === id} aria-controls="routine-view-panel" data-routine-view={id} onClick={() => setView(id)} className={activityChip(view === id)}>
                {id === "runs" ? t("routineDetail.runs") : t("routineRun.configuration")}
                {id === "runs" && history.length > 0 && <span className="rounded-full bg-raised px-1.5 text-[10.5px] text-ink-secondary">{history.length}</span>}
              </button>
            ))}
          </div>
        </header>
        <div id="routine-view-panel" role="tabpanel" aria-labelledby={`routine-view-${view}`} className={cn("px-3 pb-4 pt-2 sm:px-4", compact && "px-2")}>
          {view === "runs" ? (
            history.length === 0
              ? <p className="rounded-xl border border-dashed border-hairline/50 p-5 text-center text-[12.5px] text-ink-secondary">{t("routines.drawer.noRuns")}</p>
              : <ol data-routine-history aria-label={t("routineDetail.runs")} className="flex flex-col gap-0.5">{history.map((run) => <RunHistoryRow key={run.id} run={run} now={now} onOpen={onOpenRun} />)}</ol>
          ) : <div className="px-1 pt-1"><RoutineConfiguration routine={routine} bots={bots} groups={groups} viewerPrincipalId={viewerPrincipalId} compact={compact} /></div>}
        </div>
      </div>
      {actions && (
        <div data-routine-actions className="flex flex-wrap items-center gap-2 border-t border-hairline/40 px-4 py-3">
          {canRun && onRunNow && <button type="button" data-run-now onClick={onRunNow} disabled={working || inFlight} title={inFlight ? t("routines.runNow.inFlight") : undefined} className={cn(PRIMARY_PILL, "gap-1.5")}>{starting ? <Loader2 size={13} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}{starting ? t("routines.runNow.starting") : t("routines.runNow")}</button>}
          {editable && onToggle && <button type="button" data-routine-toggle onClick={onToggle} disabled={working} className={cn(PILL, "gap-1.5")}>{routine.enabled ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}{routine.enabled ? t("routineCalendar.pauseRoutine") : t("routineCalendar.resumeRoutine")}</button>}
          {isRoomGoal && onOpenGroup && <button type="button" onClick={onOpenGroup} className={cn(PILL, "gap-1.5")}><ExternalLink size={13} aria-hidden="true" />{t("routineCalendar.openGroup")}</button>}
          {canOpenResults && onOpenResults && <button type="button" data-routine-open-results onClick={onOpenResults} className={cn(PILL, "gap-1.5")}><ExternalLink size={13} aria-hidden="true" />{t("routines.results.open")}</button>}
          <div className="ml-auto flex items-center gap-1">
            {onLogs && <button type="button" data-routine-logs onClick={onLogs} className="rounded-lg px-3 py-2 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink">{t("routines.logs")}</button>}
            {editable && onEdit && <button type="button" data-routine-edit onClick={onEdit} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink"><Pencil size={13} aria-hidden="true" />{t("routines.edit")}</button>}
            {onDuplicate && <button type="button" data-routine-duplicate onClick={onDuplicate} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] text-ink-secondary hover:bg-raised hover:text-ink"><Copy size={13} aria-hidden="true" />{t("routineDetail.duplicate")}</button>}
            {editable && onDelete && <button type="button" data-routine-delete onClick={onDelete} className="rounded-lg p-2 text-ink-secondary hover:bg-danger/10 hover:text-danger" title={t("common.delete")} aria-label={t("common.delete")}><Trash2 size={15} aria-hidden="true" /></button>}
          </div>
        </div>
      )}
    </div>
  );
}
