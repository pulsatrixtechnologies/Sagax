// Shared by bot settings and the bot's side panel. The list keeps one action
// (New schedule); a row opens the routine's page, which holds Run now, Pause
// or Resume, Edit, the run logs and Delete.
import { CalendarClock, ChevronLeft, FileText, MoreHorizontal, PanelRight, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useServerFeature } from "@/lib/server-features";
import { useStore, type Bot } from "@/state/store";
import type { Routine, RoutineRun, RoutineRunOn } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { useCaptionChrome, useMacInsetChrome } from "../DesktopCapabilities";
import { RoutineEditor } from "../RoutinesPage";
import { canSortRoutinesByPrefix, RoutineFolderList, type RoutineFolderControl } from "../routines/RoutineFolders";
import { ACTION_LABEL, ActionBar, ActionButton, actionButtonClass } from "../ActionBar";
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
  // 2026-10-28: a folder's + makes the new routine in that folder.
  const [newFolder, setNewFolder] = useState<string | undefined>(undefined);
  const [detailId, setDetailId] = useState<string | null>(null);
  const folderControl = useRef<RoutineFolderControl | null>(null);
  const sectionMenuLabel = t("routineFolders.sectionMenu");
  const foldersServed = useServerFeature("routineFolders") !== "no";
  const detail = routines.find((routine) => routine.id === detailId) ?? null;
  const toggle = (routine: Routine) => dispatch({ type: "updateRoutine", routineId: routine.id, patch: { enabled: !routine.enabled } });
  // A routine line in the conversation asked for this routine's page.
  const focus = state.routineFocus;
  useEffect(() => {
    if (!focus || focus.botId !== bot.id || !routines.some((routine) => routine.id === focus.routineId)) return;
    setDetailId(focus.routineId);
    dispatch({ type: "routineFocused" });
  }, [focus, bot.id, routines, dispatch]);

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
      <ActionBar data-routine-detail-actions="">
        <RunNowButton routine={detail} bot={bot} className={actionButtonClass("primary")} labelClassName={ACTION_LABEL} />
        <ActionButton icon={detail.enabled ? <Pause size={15} /> : <Play size={15} />} label={detail.enabled ? t("botPanel.routines.pause") : t("botPanel.routines.resume")} onClick={() => toggle(detail)} data-routine-toggle="" />
        <ActionButton icon={<Pencil size={15} />} label={t("botPanel.routines.edit")} onClick={() => setEditing(detail)} data-routine-edit="" />
        <ActionButton icon={<FileText size={15} />} label={t("routines.logs")} wide={false} onClick={() => dispatch({ type: "showRoutines", section: "logs", botId: bot.id })} data-routine-logs="" />
        <ActionButton icon={<Trash2 size={15} />} label={t("common.delete")} wide={false} danger onClick={() => { dispatch({ type: "deleteRoutine", routineId: detail.id }); setDetailId(null); }} data-routine-delete="" />
      </ActionBar>
      {editing && editing !== "new" && <RoutineEditor key={detail.id} routine={detail} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} onClose={() => setEditing(null)} />}
    </div>;
  }

  // No routine and nothing pending: no section, one quiet line. Asking the bot
  // in chat stays the way in, and "New routine" opens the same editor as the +.
  if (routines.length === 0 && state.routinesLoadState === "ready") {
    const [before, after] = t("botPanel.routines.hint", { ask: "\u0000" }).split("\u0000");
    return <div data-routines-hint className="px-2 text-center text-[12px] leading-[17px] text-ink-tertiary">
      <p>
        {before}
        <button type="button" data-routines-ask onClick={() => { dispatch({ type: "toggleSettings", open: false }); dispatch({ type: "toggleComputer", open: false }); }} className="rounded underline decoration-ink-tertiary/50 underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{t("botPanel.routines.hintAsk")}</button>
        {after}
      </p>
      <button type="button" data-routines-new onClick={() => setEditing("new")} className="mt-1 rounded px-1 text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">{t("botPanel.routines.hintNew")}</button>
      {editing === "new" && <RoutineEditor key={`${bot.id}-new`} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} onClose={() => setEditing(null)} />}
    </div>;
  }

  return <div className="flex flex-col gap-3">
    <div className="flex items-center gap-2">
      <CalendarClock size={16} className="text-ink-secondary" />
      <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("computer.tab.routines")}</h2>
      {canSortRoutinesByPrefix(routines, foldersServed) && <button type="button" data-routines-section-more="" aria-haspopup="menu" aria-label={sectionMenuLabel} title={sectionMenuLabel}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); folderControl.current?.openSectionMenu({ x: rect.left, y: rect.bottom + 4 }, event.currentTarget); }}
        className="ui-icon-button"><MoreHorizontal size={15} /></button>}
      <button type="button" onClick={() => { setNewFolder(undefined); setEditing("new"); }} aria-label={t("computer.routines.create")} title={t("computer.routines.create")} className="ui-icon-button"><Plus size={15} /></button>
    </div>
    <RoutineFolderList controlRef={folderControl} bot={bot} routines={routines} viewerPrincipalId={state.config?.viewer?.principalId ?? null} runs={runs} loading={state.routinesLoadState === "loading" && routines.length === 0} error={state.routinesLoadState === "error"} onOpen={(routine) => setDetailId(routine.id)} grouped={grouped}
      onCreateIn={(folder) => { setNewFolder(folder); setEditing("new"); }} />
    {editing === "new" && <RoutineEditor key={`${bot.id}-new-${newFolder ?? ""}`} bots={[bot]} lockedBotId={bot.id} defaultRunOn={defaultRunOn} folder={newFolder} onClose={() => { setEditing(null); setNewFolder(undefined); }} />}
  </div>;
}
