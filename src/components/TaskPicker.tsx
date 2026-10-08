// Separate task contexts for an agent or a channel.
//
// One endless thread per bot means every job contaminates the next, and
// the only clean slate is a second bot. A task is a real boundary — its
// own transcript and its own provider session — so sensitive work, a
// long job and a quick question can sit side by side under one agent.
import { Fragment, useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, BellOff, Check, ChevronLeft, Clock, FolderInput, Link2, Loader2, MessagesSquare, MoreHorizontal, Pencil, Pin, PinOff, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { api, currentTaskBot, useStore, type Bot, type BotProject, type Group, type Task } from "@/state/store";
import { approvalModeFor } from "../../shared/approval-mode";
import { llmThreadTitlesEnabled } from "@/lib/feature-flags";
import { moveFolder } from "@/lib/folder-order";
import { folderUnreadThreadIds, markFolderRead } from "@/lib/folder-read";
import { threadRefUrl } from "@/lib/thread-refs";
import { FullAccessWarning } from "./FullAccessWarning";
import { LocalComputerAutoWarning } from "./LocalComputerAutoWarning";
import { cn } from "@/lib/cn";
import { CIRCLE_BUTTON } from "@/lib/circle-button";
import { useMenuMotion } from "./MenuMotion";
import { t } from "@/lib/i18n";
import { formatTaskTokens, headlineTokens, usageDetail } from "@/lib/usage";
import { nextRename } from "@/lib/rename";
import { BotProjectDialog, FolderActions, FolderIcon, NewThreadButton } from "./BotProjects";
import { useShowThreads } from "@/lib/thread-preferences";
import { threadsOffReturnTarget } from "./thread-home";
import { threadsWhenTreeHidden } from "./SidebarBotActivity";
import { formatUpdatedAt, isArchived, isSnoozed, nextSixPm, orderedThreadList, threadByline, threadRecency, threadUpdatedLabel, tomorrowNineAm, useRelativeNow, useSnoozeExpiry } from "./SidebarThreadRow";

/** Click-to-switch used to close this menu immediately, which unmounted the
 * row before a double-click (or right-click) could start a rename. Linger
 * just long enough for the second click to land; rename cancels the close. */
export const TASK_PICKER_DISMISS_MS = 500;


/** Decide what a pointer event on a task row should do. The click that
 * accompanies a dblclick (detail >= 2) must not switch/close — that is
 * what used to eat the advertised rename. */
export function taskPickerPointerIntent(
  type: string,
  detail = 1,
): "select" | "rename" | "ignore" {
  if (type === "dblclick" || type === "contextmenu") return "rename";
  if (type === "click" && detail >= 2) return "ignore";
  if (type === "click") return "select";
  return "ignore";
}

/** Filter the task switcher. Prefix matches float first so a few letters
 * still find the right row in a long list; within a tier the caller's
 * order (newest first) is preserved. */
export function filterTasks<T extends { title: string }>(tasks: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...tasks];
  const prefix: T[] = [];
  const substring: T[] = [];
  for (const task of tasks) {
    const title = task.title.toLowerCase();
    if (title.startsWith(needle)) prefix.push(task);
    else if (title.includes(needle)) substring.push(task);
  }
  return [...prefix, ...substring];
}

/** The picker row's stamp, sharing the sidebar row's contract: relative
 * label in the flow, the exact date one hover away, ISO for machines. */
function TaskUpdatedTime({ task, now }: { task: { updatedAt?: number; createdAt?: number }; now: number }) {
  const stamp = threadRecency(task);
  if (!Number.isFinite(stamp) || stamp <= 0) return null;
  return <time dateTime={new Date(stamp).toISOString()} title={formatUpdatedAt(stamp)}>{threadUpdatedLabel(stamp, now)}</time>;
}

/** Quiet per-task token tally; the hover title explains the cached share. */
function TaskUsage({ usage }: { usage: Task["usage"] }) {
  if (!usage) return null;
  const label = formatTaskTokens(headlineTokens(usage));
  if (!label) return null;
  return (
    <span
      title={usageDetail(usage)}
    >
      {" · "}
      {label}
    </span>
  );
}

type PickerTask = Pick<Task, "threadId" | "title" | "createdAt" | "updatedAt" | "pinned" | "busy" | "activity" | "unread" | "projectId" | "openedBy" | "closedBy" | "archivedAt" | "snoozedUntil" | "waitingForTeammates"> & { usage?: Task["usage"] };

/** The full picker searches both thread titles and their project names.
 * Legacy/orphaned project IDs remain visible under Ungrouped. */
export function groupThreadTasks(tasks: PickerTask[], projects: BotProject[], query: string) {
  const needle = query.trim().toLowerCase();
  return [...projects, { id: "", name: t("folder.none") } as BotProject].map((project) => {
    const members = tasks.filter((task) => project.id ? task.projectId === project.id : !projects.some((item) => item.id === task.projectId));
    return { project, tasks: project.name.toLowerCase().includes(needle) ? members : filterTasks(members, query) };
  }).filter((group) => group.tasks.length > 0);
}

export type PickerThreadActions = {
  onCopyLink?: (threadId: string) => void;
  /** Present only where generated titles are on. Calls back once settled. */
  onRegenerateTitle?: (threadId: string, onSettled: (ok: boolean) => void) => void;
  onArchive?: (threadId: string, archivedAt: number | null) => void;
  onSnooze?: (threadId: string, snoozedUntil: number | null) => void;
  onRefreshPermissions?: (threadId: string) => void;
};

export type PickerFolderActions = {
  saving: boolean;
  canMove: (projectId: string, direction: -1 | 1) => boolean;
  canMarkRead: (projectId: string) => boolean;
  onEdit: (projectId: string) => void;
  onMove: (projectId: string, direction: -1 | 1, onSaved: () => void) => void;
  onMarkRead: (projectId: string, onSaved: () => void) => void;
};

const PANEL_ITEM = "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-[12px] text-ink hover:bg-raised disabled:opacity-40";

/** The extra actions of one picker row, unfolded under it: what the sidebar
 * thread row's menu offered (JC, 2026-10-08: the header button is the only
 * way to reach a bot's threads). Rename, pin, move and delete stay on the row. */
export function ThreadActionsPanel({ task, actions, regenerating, onRegenerate, onDone }: {
  task: PickerTask;
  actions: PickerThreadActions;
  regenerating: boolean;
  onRegenerate: () => void;
  onDone: () => void;
}) {
  const working = Boolean(task.busy) || task.activity === "working";
  const archived = isArchived(task);
  const snoozed = isSnoozed(task);
  return (
    <div role="group" aria-label={t("task.actions", { title: task.title })} data-picker-thread-actions={task.threadId} className="mx-2.5 mb-1.5 rounded-lg border border-hairline/40 bg-inset/60 p-1">
      {actions.onCopyLink && <button type="button" onClick={() => { actions.onCopyLink?.(task.threadId); onDone(); }} className={PANEL_ITEM}><Link2 size={12} />{t("task.copyLink")}</button>}
      {actions.onRegenerateTitle && <button type="button" disabled={regenerating} aria-busy={regenerating} onClick={onRegenerate} className={PANEL_ITEM}>{regenerating ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}{regenerating ? t("task.regeneratingTitle") : t("task.regenerateTitle")}</button>}
      {actions.onArchive && <button type="button" disabled={working} onClick={() => { actions.onArchive?.(task.threadId, archived ? null : Date.now()); onDone(); }} className={PANEL_ITEM}>{archived ? <ArchiveRestore size={12} /> : <Archive size={12} />}{archived ? t("task.unarchive") : t("task.archive")}</button>}
      {actions.onSnooze && <div className="px-2.5 pt-1">
        <span className="flex items-center gap-2 text-[11px] text-ink-secondary"><Clock size={12} />{t("task.snooze")}</span>
        <div className="mt-0.5">
          {[{ label: t("task.snoozeUntilActivity"), at: 0 }, { label: t("task.snoozeTonight"), at: nextSixPm() }, { label: t("task.snoozeTomorrow"), at: tomorrowNineAm() }].map((preset) => (
            <button key={preset.label} type="button" disabled={working} onClick={() => { actions.onSnooze?.(task.threadId, preset.at); onDone(); }} className={PANEL_ITEM}>{preset.label}</button>
          ))}
        </div>
      </div>}
      {actions.onSnooze && snoozed && <button type="button" onClick={() => { actions.onSnooze?.(task.threadId, null); onDone(); }} className={PANEL_ITEM}><BellOff size={12} />{t("task.stopSnoozing")}</button>}
      {actions.onRefreshPermissions && <button type="button" disabled={working} title={t("task.refreshPermissionsHint")} onClick={() => { actions.onRefreshPermissions?.(task.threadId); onDone(); }} className={PANEL_ITEM}><RefreshCw size={12} />{t("task.refreshPermissions")}</button>}
    </div>
  );
}

function ConversationTaskPicker({
  threadId,
  tasks,
  busy,
  bot,
  onNew,
  onSwitch,
  onRename,
  onDelete,
  onMove,
  onPin,
  threadActions,
  folderActions,
  initialOpen = false,
}: {
  threadId: string;
  tasks: PickerTask[];
  busy: boolean;
  bot?: Bot;
  onNew: () => void;
  onSwitch: (threadId: string) => void;
  onRename: (threadId: string, title: string) => void;
  onDelete: (threadId: string) => void;
  onMove?: (threadId: string, projectId: string | null) => void;
  onPin?: (threadId: string, pinned: boolean) => void;
  /** The thread actions the sidebar rows used to carry, behind a row's "...". */
  threadActions?: PickerThreadActions;
  /** Folder header actions: edit (name and icon), mark read, move up/down. */
  folderActions?: PickerFolderActions;
  /** Opens on mount (tests render the open popover this way). */
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const motion = useMenuMotion(open);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [folderMenu, setFolderMenu] = useState<{ projectId: string; left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finishingRename = useRef(false);
  const now = useRelativeNow();
  // a timed snooze ends on the clock: re-render then so "Snoozed" lifts
  useSnoozeExpiry(tasks);

  const current = tasks.find((t) => t.threadId === threadId);

  const clearDismiss = () => {
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
      dismissTimer.current = null;
    }
  };

  const closeMenu = () => {
    clearDismiss();
    setActionsFor(null);
    setFolderMenu(null);
    setRenaming(null);
    setQuery("");
    setOpen(false);
  };

  const queueDismiss = () => {
    clearDismiss();
    dismissTimer.current = setTimeout(() => {
      dismissTimer.current = null;
      setRenaming(null);
      setOpen(false);
    }, TASK_PICKER_DISMISS_MS);
  };

  const startRename = (task: PickerTask) => {
    clearDismiss();
    finishingRename.current = false;
    setDraft(task.title);
    setRenaming(task.threadId);
  };

  useEffect(() => () => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
  }, []);

  useEffect(() => {
    if (!open) {
      setActionsFor(null);
      setFolderMenu(null);
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setRenaming(null);
      setQuery("");
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (e.target instanceof Element && e.target.closest("[data-thread-overlay]")) return;
      // SAFETY: a mousedown target inside a document is always a DOM Node
      if (!ref.current?.contains(e.target as Node)) {
        if (dismissTimer.current) {
          clearTimeout(dismissTimer.current);
          dismissTimer.current = null;
        }
        setRenaming(null);
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (e.target instanceof Element && e.target.closest("[data-thread-overlay]")) return;
      if (renaming) return;
      if (dismissTimer.current) {
        clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      setRenaming(null);
      setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, renaming]);

  const commitRename = (threadId: string, save: boolean) => {
    // Escape unmounts the input, which fires blur. Without this guard the
    // blur would save the draft the user just cancelled.
    if (finishingRename.current) return;
    finishingRename.current = true;
    const currentTitle = tasks.find((task) => task.threadId === threadId)?.title ?? "";
    const title = save ? nextRename(currentTitle, draft) : null;
    setRenaming(null);
    if (title) onRename(threadId, title);
  };

  // the picker button stays as-is — a token count next to a truncated title
  // and count would crowd it; the open task's tally rides the hover title
  const u = current?.usage;
  const currentLabel = u ? formatTaskTokens(headlineTokens(u)) : null;
  const switchTitle =
    u && currentLabel
      ? t("task.switchWithUsageDetail", {
          label: currentLabel,
          detail: usageDetail(u),
        })
      : t("task.switch");
  const grouped = bot ? groupThreadTasks(tasks, bot.projects ?? [], query) : null;
  // Only this conversation's own threads: no other bot's or room's thread
  // ever rides in here (JC, 2026-10-08). The sidebar's Active Threads panel
  // is the cross-bot view.
  const visible = grouped ? grouped.flatMap((group) => group.tasks) : filterTasks(tasks, query);
  const looking = query.trim();

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          if (open) closeMenu();
          else setOpen(true);
        }}
        title={switchTitle}
        aria-label={t("task.switch")}
        aria-expanded={open}
        className={cn(CIRCLE_BUTTON, "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", open && "bg-elevated-hover")}
      >
        <MessagesSquare size={18} strokeWidth={1.75} aria-hidden="true" />
      </button>

      {motion.shown && (
        <div className={cn("absolute right-0 top-full z-40 mt-1 w-[300px] overflow-hidden rounded-xl border border-hairline/50 bg-card py-1 shadow-2xl shadow-black/50", motion.className)} {...motion.exitProps}>
          <div className="px-2 pb-1 pt-1.5">
            <div className="flex items-center gap-2 rounded-lg border border-hairline/40 bg-inset px-2.5 py-1.5 focus-within:border-focus">
              <Search size={13} className="shrink-0 text-ink-secondary" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    if (looking) setQuery("");
                    else closeMenu();
                    return;
                  }
                  if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    const first = visible[0];
                    if (!first) return;
                    if (first.threadId !== threadId) onSwitch(first.threadId);
                    closeMenu();
                  }
                }}
                placeholder={t("task.search")}
                aria-label={t("task.search")}
                className="w-full bg-transparent text-[12.5px] text-ink placeholder:text-ink-secondary focus:outline-none"
              />
            </div>
          </div>
          <div className="max-h-[320px] overflow-y-auto" role="group" aria-label={looking ? t("task.matching", { count: visible.length }) : t("task.list")}>
            {visible.length === 0 ? (
              <div className="px-3 py-6 text-center text-[13px] text-ink-secondary">
                {t("task.noMatch", { query: looking })}
              </div>
            ) : visible.map((task, index) => {
              const active = task.threadId === threadId;
              const opener = threadByline(task);
              const heading = grouped?.find((group) => group.tasks[0]?.threadId === task.threadId)?.project;
              return (
                <Fragment key={task.threadId}>
                {bot?.projects?.length && heading ? <div data-picker-folder={heading.id || undefined} className={cn("group/folder flex items-center gap-1.5 px-3 pb-1 pt-2 text-[11px] font-medium text-ink-secondary", index > 0 && "border-t border-hairline/30")}>{heading.id && <FolderIcon emoji={heading.emoji} size={12} />}<span className="min-w-0 flex-1 truncate">{heading.name}</span>
                  {heading.id && folderActions && <FolderActions project={heading} canMoveUp={folderActions.canMove(heading.id, -1)} canMoveDown={folderActions.canMove(heading.id, 1)}
                    canMarkRead={folderActions.canMarkRead(heading.id)} saving={folderActions.saving}
                    menu={folderMenu?.projectId === heading.id ? folderMenu : null}
                    onMenuChange={(menu) => { clearDismiss(); setFolderMenu(menu ? { ...menu, projectId: heading.id } : null); }}
                    onEdit={() => folderActions.onEdit(heading.id)} onMove={(direction, onSaved) => folderActions.onMove(heading.id, direction, onSaved)}
                    onMarkRead={(onSaved) => folderActions.onMarkRead(heading.id, onSaved)} />}
                </div> : null}
                <div
                  className={cn("group flex items-center gap-2 px-2.5 py-2", active ? "bg-raised/60" : "hover:bg-raised/40")}
                >
                  <Check size={13} className={cn("shrink-0", active ? "text-accent" : "opacity-0")} />
                  {renaming === task.threadId ? (
                    <input
                      autoFocus
                      value={draft}
                      maxLength={80}
                      aria-label={t("task.renameAria")}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setDraft(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onMouseDown={(e) => e.stopPropagation()}
                      onBlur={() => commitRename(task.threadId, true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                          e.preventDefault();
                          e.stopPropagation();
                          commitRename(task.threadId, true);
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          commitRename(task.threadId, false);
                        }
                      }}
                      className="min-w-0 flex-1 rounded bg-inset px-1.5 py-0.5 text-[13px] text-ink focus:outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => {
                        if (taskPickerPointerIntent("click", e.detail) !== "select") return;
                        if (!active) onSwitch(task.threadId);
                        queueDismiss();
                      }}
                      onDoubleClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(task);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        startRename(task);
                      }}
                      className="min-w-0 flex-1 text-left"
                      title={t("task.renameHint")}
                    >
                      <div className="truncate text-[13px] text-ink">{task.title}</div>
                      <div className="text-[11px] text-ink-secondary">
                        {task.activity === "waiting-on-you" ? `${t("task.waiting")} · ` : task.waitingForTeammates ? `${t("task.waitingOnTeammate")} · ` : task.busy ? `${t("chat.activity.working")} · ` : task.unread ? `${t("task.unread")} · ` : ""}
                        <TaskUpdatedTime task={task} now={now} />
                        <TaskUsage usage={task.usage} />
                        {opener && ` · ${opener}`}
                      </div>
                    </button>
                  )}
                  {onPin && renaming !== task.threadId && (
                    <button
                      type="button"
                      onClick={() => onPin(task.threadId, task.pinned !== true)}
                      aria-label={task.pinned === true ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")}
                      title={task.pinned === true ? t("sidebar.bot.unpin") : t("sidebar.bot.pin")}
                      className="rounded p-1 text-ink-secondary opacity-0 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-70"
                    >
                      {task.pinned === true ? <PinOff size={13} /> : <Pin size={13} />}
                    </button>
                  )}
                  {renaming !== task.threadId && (
                    <button
                      type="button"
                      onClick={() => startRename(task)}
                      aria-label={t("task.renameNamed", { title: task.title })}
                      title={t("task.renameTitle")}
                      className="rounded p-1 text-ink-secondary opacity-0 hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-70"
                    >
                      <Pencil size={13} />
                    </button>
                  )}
                  {bot && onMove && (bot.projects?.length ?? 0) > 0 && <label title={t("folder.move")} className="relative rounded p-1 text-ink-secondary opacity-0 hover:bg-raised hover:text-ink focus-within:opacity-100 group-hover:opacity-100 touch:opacity-70">
                    <FolderInput size={13} />
                    <select aria-label={t("folder.moveNamed", { title: task.title })} value={bot.projects?.some((project) => project.id === task.projectId) ? task.projectId : ""}
                      onFocus={clearDismiss} onChange={(event) => { clearDismiss(); onMove(task.threadId, event.target.value || null); }}
                      className="absolute inset-0 w-full cursor-pointer opacity-0">
                      <option value="">{t("folder.none")}</option>
                      {bot.projects?.map((project) => <option key={project.id} value={project.id}>{project.emoji ? `${project.emoji} ` : ""}{project.name}</option>)}
                    </select>
                  </label>}
                  {threadActions && renaming !== task.threadId && (
                    <button
                      type="button"
                      onClick={() => { clearDismiss(); setActionsFor((current) => current === task.threadId ? null : task.threadId); }}
                      aria-label={t("task.actions", { title: task.title })}
                      title={t("task.actions", { title: task.title })}
                      aria-expanded={actionsFor === task.threadId}
                      className={cn("rounded p-1 text-ink-secondary hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-70", actionsFor === task.threadId ? "opacity-100" : "opacity-0")}
                    >
                      <MoreHorizontal size={13} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(task.threadId)}
                    disabled={Boolean(task.busy) || busy && active}
                    aria-label={t("task.deleteAria")}
                    title={t("task.deleteTitle")}
                    className="rounded p-1 text-ink-secondary opacity-0 hover:bg-raised hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-20 touch:opacity-70 touch:disabled:opacity-20"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                {threadActions && actionsFor === task.threadId && <ThreadActionsPanel task={task} actions={threadActions}
                  regenerating={regenerating === task.threadId}
                  onRegenerate={() => {
                    if (!threadActions.onRegenerateTitle || regenerating) return;
                    setRegenerating(task.threadId);
                    threadActions.onRegenerateTitle(task.threadId, (ok) => { setRegenerating(null); if (ok) setActionsFor(null); });
                  }}
                  onDone={() => setActionsFor(null)} />}
                </Fragment>
              );
            })}
          </div>
          {bot ? <NewThreadButton bot={bot} onCreated={closeMenu} className="mt-1 w-full rounded-none border-t border-hairline/40" /> : <button
            type="button"
            onClick={() => {
              onNew();
              closeMenu();
            }}
            disabled={busy}
            className="mt-1 flex w-full items-center gap-2 border-t border-hairline/40 px-3 py-2 text-left text-[13px] text-ink hover:bg-raised/50 disabled:opacity-40"
          >
            <Plus size={13} className="text-ink-secondary" /> {t("task.newShort")}
          </button>}
        </div>
      )}
    </div>
  );
}

/** The sibling-activity dropdown shown only while the sidebar thread tree is
 * hidden, ordered exactly like the sidebar so both surfaces agree. */
export function BotActivityPicker({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  if (showThreads) return null;
  const activity = threadsWhenTreeHidden(bot, state.pendingQueued).filter((task) => task.threadId !== bot.threadId);
  // A display preference must not strand a sibling approval or queued job,
  // including on narrow screens where the sidebar is closed. This is an
  // activity switcher only: idle histories and creation remain hidden.
  if (!activity.length) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 px-5 py-2" data-background-activity>
      <select
        aria-label={t("task.otherActivity", { count: activity.length })}
        value=""
        onChange={(event) => dispatch({ type: "switchTask", botId: bot.id, threadId: event.target.value })}
        className="max-w-[180px] shrink-0 truncate rounded-full border border-hairline/40 bg-panel px-2.5 py-1 text-[12.5px] text-ink-secondary"
      >
        <option value="" disabled>{t("task.otherActivity", { count: activity.length })}</option>
        {activity.map((task) => <option key={task.threadId} value={task.threadId}>
          {task.title} · {task.activity === "waiting-on-you" ? t("task.waiting") : task.waitingForTeammates ? t("task.waitingOnTeammate") : task.busy || task.activity === "working" ? t("chat.activity.working") : task.queued ? t("task.queued") : t("task.unread")}
        </option>)}
      </select>
      <span className="truncate text-[12px] text-ink-secondary">{bot.tasks?.find((task) => task.threadId === bot.threadId)?.title}</span>
    </div>
  );
}

/** The conversation a thread chip left behind. Shown in the chat column,
 * threads on or off, until that conversation is on screen again. */
export function ThreadReturnLink({ ownerId, threadId }: { ownerId: string; threadId: string }) {
  const { state, dispatch } = useStore();
  const back = state.threadReturn;
  if (!back || (back.ownerId === ownerId && back.threadId === threadId)) return null;
  const bot = state.bots.find((candidate) => candidate.id === back.ownerId);
  const group = state.groups?.find((candidate) => candidate.id === back.ownerId);
  const title = (bot ?? group)?.tasks?.find((task) => task.threadId === back.threadId)?.title;
  return (
    <div className="flex shrink-0 items-center px-5 py-1" data-thread-return>
      <button
        type="button"
        title={title}
        onClick={() => {
          if (back.ownerId !== ownerId) dispatch({ type: "select", id: back.ownerId });
          if (group) {
            if (group.threadId !== back.threadId) dispatch({ type: "switchGroupTask", groupId: group.id, threadId: back.threadId });
            return;
          }
          if (!bot || bot.threadId !== back.threadId) dispatch({ type: "switchTask", botId: back.ownerId, threadId: back.threadId });
        }}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-hairline/40 bg-panel px-3 py-1 text-[12.5px] text-ink hover:bg-raised"
      >
        <ChevronLeft size={13} aria-hidden="true" />
        <span className="truncate">{t("task.backToConversation")}</span>
      </button>
    </div>
  );
}

/** Threads off: one quiet link back to the person's conversation when the
 * open thread is not their latest one (an untouched extra thread, or an
 * older sibling opened from the activity picker). Never creates a thread. */
export function ThreadsOffReturnLink({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  if (showThreads) return null;
  const target = threadsOffReturnTarget(bot);
  if (!target) return null;
  const title = bot.tasks?.find((task) => task.threadId === target)?.title;
  return (
    <div className="flex shrink-0 items-center px-5 py-1" data-threads-off-return>
      <button
        type="button"
        onClick={() => dispatch({ type: "switchTask", botId: bot.id, threadId: target })}
        title={title}
        className="rounded px-1.5 py-0.5 text-[12.5px] text-accent hover:bg-raised"
      >
        {t("task.backToConversation")}
      </button>
    </div>
  );
}

/** The threads the header picker lists for a bot: that bot's own threads
 * (`bot.tasks`, which the server builds from this bot's record only and, on
 * an organization server with private threads, narrows to the viewer's own),
 * minus routine runs, newest first. "opened by <peer>" on a row is a thread
 * a teammate bot opened on this bot, still this bot's thread. */
export function botPickerThreads(bot: Pick<Bot, "tasks">): Task[] {
  return orderedThreadList((bot.tasks ?? []).filter((task) => !task.routineRunId));
}

export function TaskPicker({ bot, initialOpen = false }: { bot: Bot; initialOpen?: boolean }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const [permissionRefresh, setPermissionRefresh] = useState<{ threadId: string; kind: "full" | "local-auto" } | null>(null);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [folderSaving, setFolderSaving] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  if (!showThreads) return null;
  const projects = bot.projects ?? [];
  const projectIds = projects.map((project) => project.id);
  const threadActions: PickerThreadActions = {
    onCopyLink: (threadId) => {
      navigator.clipboard?.writeText(threadRefUrl({ botId: bot.id, threadId })).catch(() => {
        // clipboard write rejected: the link stays available to copy again
      });
    },
    onRegenerateTitle: llmThreadTitlesEnabled(state.config)
      ? (threadId, onSettled) => dispatch({ type: "regenerateTaskTitle", botId: bot.id, threadId, onSettled })
      : undefined,
    onArchive: (threadId, archivedAt) => dispatch({ type: "updateTask", botId: bot.id, threadId, patch: { archivedAt } }),
    onSnooze: (threadId, snoozedUntil) => dispatch({ type: "updateTask", botId: bot.id, threadId, patch: { snoozedUntil } }),
    // the same checks as the sidebar row had: a wider approval level asks first
    onRefreshPermissions: (threadId) => {
      const mode = approvalModeFor(bot);
      const threadMode = approvalModeFor(currentTaskBot(bot, threadId));
      if (mode === "full" && threadMode !== "full") { setPermissionRefresh({ threadId, kind: "full" }); return; }
      if (mode === "auto" && bot.computer === "local" && threadMode !== "auto") { setPermissionRefresh({ threadId, kind: "local-auto" }); return; }
      dispatch({ type: "refreshTaskPermissions", botId: bot.id, threadId });
    },
  };
  const folderActions: PickerFolderActions = {
    saving: folderSaving,
    canMove: (projectId, direction) => {
      const index = projectIds.indexOf(projectId);
      return index >= 0 && index + direction >= 0 && index + direction < projectIds.length;
    },
    canMarkRead: (projectId) => folderUnreadThreadIds(bot, projectId).length > 0,
    onEdit: (projectId) => setEditingProject(projectId),
    onMove: (projectId, direction, onSaved) => {
      const ids = moveFolder(projectIds, projectId, direction);
      if (folderSaving || ids.every((id, index) => id === projectIds[index])) return;
      setFolderSaving(true); setFolderError(null);
      dispatch({ type: "reorderProjects", botId: bot.id, projectIds: ids,
        onSaved: () => { setFolderSaving(false); onSaved(); },
        onError: (message) => { setFolderSaving(false); setFolderError(message); } });
    },
    onMarkRead: (projectId, onSaved) => {
      if (folderSaving) return;
      setFolderSaving(true); setFolderError(null);
      markFolderRead(bot, projectId, api, (updated) => dispatch({ type: "botPatched", bot: updated }))
        .then(() => onSaved())
        .catch((error: unknown) => setFolderError(error instanceof Error ? error.message : String(error)))
        .finally(() => setFolderSaving(false));
    },
  };
  const projectToEdit = projects.find((project) => project.id === editingProject);
  return (
    <>
    <ConversationTaskPicker
      threadId={bot.threadId}
      tasks={botPickerThreads(bot)}
      busy={false}
      bot={bot}
      onNew={() => dispatch({ type: "newTask", botId: bot.id })}
      onSwitch={(threadId) => dispatch({ type: "switchTask", botId: bot.id, threadId })}
      onRename={(threadId, title) => dispatch({ type: "renameTask", botId: bot.id, threadId, title })}
      onDelete={(threadId) => dispatch({ type: "deleteTask", botId: bot.id, threadId })}
      onMove={(threadId, projectId) => dispatch({ type: "updateTask", botId: bot.id, threadId, patch: { projectId } })}
      onPin={(threadId, pinned) => dispatch({ type: "updateTask", botId: bot.id, threadId, patch: { pinned } })}
      threadActions={threadActions}
      folderActions={projects.length ? folderActions : undefined}
      initialOpen={initialOpen}
    />
    {folderError && <p role="alert" data-thread-overlay className="fixed bottom-4 right-4 z-50 max-w-[320px] rounded-lg border border-hairline/50 bg-card px-3 py-2 text-[12px] text-danger shadow-xl" onClick={() => setFolderError(null)}>{folderError}</p>}
    <FullAccessWarning
      open={permissionRefresh?.kind === "full"}
      scope="thread"
      onCancel={() => setPermissionRefresh(null)}
      onConfirm={() => {
        const threadId = permissionRefresh?.threadId;
        setPermissionRefresh(null);
        if (threadId) dispatch({ type: "refreshTaskPermissions", botId: bot.id, threadId });
      }}
    />
    <LocalComputerAutoWarning
      open={permissionRefresh?.kind === "local-auto"}
      onCancel={() => setPermissionRefresh(null)}
      onConfirm={() => {
        const threadId = permissionRefresh?.threadId;
        setPermissionRefresh(null);
        if (threadId) dispatch({ type: "refreshTaskPermissions", botId: bot.id, threadId, acknowledgeLocalAuto: true });
      }}
    />
    {projectToEdit && <BotProjectDialog bot={bot} project={projectToEdit} onClose={() => setEditingProject(null)} />}
    </>
  );
}

/** The same task affordance in a channel. DMs never render it because their
 * transcript is the private bot-to-bot exchange rather than user work. Like
 * the bot's, it shows only while threads are on (Settings > Appearance). */
export function GroupTaskPicker({ group }: { group: Group }) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  if (!showThreads) return null;
  return (
    <ConversationTaskPicker
      threadId={group.threadId}
      tasks={orderedThreadList(group.tasks ?? [])}
      busy={Boolean(group.working || group.busyBotId)}
      onNew={() => dispatch({ type: "newGroupTask", groupId: group.id })}
      onSwitch={(threadId) => dispatch({ type: "switchGroupTask", groupId: group.id, threadId })}
      onRename={(threadId, title) => dispatch({ type: "renameGroupTask", groupId: group.id, threadId, title })}
      onDelete={(threadId) => dispatch({ type: "deleteGroupTask", groupId: group.id, threadId })}
      onPin={(threadId, pinned) => {
        const title = group.tasks?.find((task) => task.threadId === threadId)?.title ?? "";
        dispatch({ type: "pinGroupTask", groupId: group.id, threadId, pinned, title });
      }}
    />
  );
}
