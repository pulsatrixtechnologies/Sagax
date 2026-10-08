// Shared by bot settings and the bot's side panel.
import { CalendarClock, ChevronLeft, FileText, PanelRight, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useStore, type Bot } from "@/state/store";
import type { Routine, RoutineRun, RoutineRunOn } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { useCaptionChrome, useMacInsetChrome } from "../DesktopCapabilities";
import { RoutineEditor } from "../RoutinesPage";
import { RoutineList } from "../routines/RoutineList";
import { RunNowButton } from "../routines/RunNowButton";

// The routine page covers the whole panel, so it draws its own top bar the way
// the panel's does (BotSettingsDialog): a .content-topbar row, whose buttons
// the stylesheet makes no-drag (they were dead under the panel's drag strip
// before), the shared round CIRCLE_BUTTON back control on the left, the panel
// close control on the right, and the name centered.
export function RoutineDetailHeader({ name, onBack, onClose }: { name: string; onBack: () => void; onClose: () => void }) {
  const { padClass } = useCaptionChrome();
  const { macInset, browser } = useMacInsetChrome();
  return <>
    {(macInset || browser) && <div className="content-topbar-strip" />}
    <div data-routine-detail-header className={cn("content-topbar relative flex h-12 shrink-0 items-center justify-between px-3", padClass)}>
      <button type="button" aria-label={t("botPanel.routines.back")} onClick={onBack} className={CIRCLE_BUTTON}><ChevronLeft size={18} strokeWidth={1.75} /></button>
      <span className="pointer-events-none absolute inset-x-14 truncate text-center text-[14px] font-semibold text-ink">{name}</span>
      <button type="button" aria-label={t("botPanel.routines.close")} title={t("botPanel.routines.close")} onClick={onClose} className={CIRCLE_BUTTON}><PanelRight size={18} strokeWidth={1.75} /></button>
    </div>
  </>;
}

export function RoutinesSection({ bot, routines, runs, defaultRunOn, grouped = false }: { bot: Bot; routines: Routine[]; runs: RoutineRun[]; defaultRunOn?: RoutineRunOn; grouped?: boolean }) {
  const { state, dispatch } = useStore();
  const [editing, setEditing] = useState<Routine | "new" | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = routines.find((routine) => routine.id === detailId) ?? null;
  const toggle = (routine: Routine) => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } });

  if (detail) {
    return <div className="absolute inset-0 z-20 flex flex-col bg-panel">
      <RoutineDetailHeader
        name={detail.name}
        onBack={() => setDetailId(null)}
        onClose={() => { dispatch({ type: "toggleSettings", open: false }); dispatch({ type: "toggleComputer", open: false }); }}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="text-[13px] font-medium text-ink">{t("botPanel.routines.instruction")}</div>
        <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{detail.prompt}</p>
      </div>
      <div className="flex items-center gap-2 border-t border-hairline/40 px-3 py-3">
        <RunNowButton routine={detail} bot={bot} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-hairline/50 bg-panel py-2.5 text-[13px] font-medium text-ink hover:bg-raised disabled:opacity-50" />
        <button type="button" onClick={() => toggle(detail)} className="flex-1 rounded-lg border border-hairline/50 bg-panel py-2.5 text-[13px] font-medium text-ink hover:bg-raised">{detail.enabled ? t("botPanel.routines.pause") : t("botPanel.routines.resume")}</button>
        <button type="button" onClick={() => setEditing(detail)} className="flex-1 rounded-lg border border-hairline/50 bg-panel py-2.5 text-[13px] font-medium text-ink hover:bg-raised">{t("botPanel.routines.edit")}</button>
        <button type="button" aria-label={t("common.delete")} onClick={() => { dispatch({ type: "deleteRoutine", routineId: detail.id }); setDetailId(null); }} className="flex size-10 items-center justify-center rounded-lg border border-hairline/50 text-ink-secondary hover:bg-raised hover:text-danger"><Trash2 size={16} /></button>
      </div>
      {editing && editing !== "new" && <RoutineEditor key={detail.id} routine={detail} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} onClose={() => setEditing(null)} />}
    </div>;
  }

  return <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <CalendarClock size={16} className="text-ink-secondary" />
      <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("computer.tab.routines")}</h2>
      <button type="button" onClick={() => setEditing("new")} aria-label={t("computer.routines.create")} title={t("computer.routines.create")} className="ui-icon-button"><Plus size={15} /></button>
      <button type="button" onClick={() => dispatch({ type: "showRoutines", section: "logs", botId: bot.id })} aria-label={t("routines.logs")} title={t("routines.logs")} className="ui-icon-button"><FileText size={14} /></button>
    </div>
    <RoutineList routines={routines} runs={runs} loading={state.routinesLoadState === "loading" && routines.length === 0} error={state.routinesLoadState === "error"} onOpen={(routine) => setDetailId(routine.id)} onToggle={toggle} grouped={grouped} />
    {editing === "new" && <RoutineEditor key={`${bot.id}-new`} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} onClose={() => setEditing(null)} />}
  </div>;
}
