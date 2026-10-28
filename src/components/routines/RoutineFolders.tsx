// Routine folders in a bot's Routines list (2026-10-28, shared/routine-folders.ts).
//
// The routines in no folder come first, as the list always was (a section
// with no title); then each folder of the bot, in the person's order, as a
// folding header like the sidebar's sections: a chevron in the gutter, the
// name and a count, its menu (Rename, Move up or down, Pause or Resume all,
// Delete) and its + (a new routine in that folder). A row's menu (right
// click, its "…", Shift+F10) moves it: the folders, New folder… and Remove
// from folder. Rows can also be dragged onto a folder. When titles start
// with "[X]", one quiet line offers to sort them into folders; it is marked
// seen only when the sort worked or the person closed it with the x (a failed
// try or an older server leaves it). "Sort by prefix" also stays in the
// section's "..." menu and the folder menu while a [X] title remains. The
// change can be undone. Nothing is filed without that click.
//
// An older server has no folders (shared/server-features.ts): the row menu
// keeps "Move to folder" with its items disabled and the neutral "Available
// after the server update.", the prefix offer and dragging stay away, and a
// call that still meets "no route" says the same line, never a red error.
import { ArrowDown, ArrowUp, Check, ChevronRight, FolderInput, FolderMinus, FolderPlus, MoreHorizontal, Pause, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useImperativeHandle, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { api, useStore, type Bot } from "@/state/store";
import type { Routine, RoutineRun } from "@/lib/routines";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { flipRoutine } from "@/lib/routine-toggle";
import { useServerFeature } from "@/lib/server-features";
import { featureMissingOnServer } from "@/lib/server-route";
import {
  answerRoutinePrefixOffer,
  collapsedRoutineFolders,
  settleRoutinePrefixOffer,
  saveCollapsedRoutineFolders,
} from "@/lib/routine-folder-prefs";
import {
  groupRoutinesByFolder,
  ROUTINE_FOLDER_MAX,
  routineFolderKey,
  routinePrefixPlan,
  type RoutineFolderAction,
  type RoutineFolderUndo,
} from "../../../shared/routine-folders";
import { navigateThreadMenu } from "../BotProjects";
import { RoutineList, ROUTINE_DRAG_TYPE } from "./RoutineList";

interface FolderAnswer { folders: string[]; routines: Routine[]; undo?: RoutineFolderUndo }

type MenuState =
  | { kind: "row"; routine: Routine; x: number; y: number; trigger: HTMLElement; naming?: boolean }
  | { kind: "folder"; folder: string; x: number; y: number; trigger: HTMLElement }
  | { kind: "section"; x: number; y: number; trigger: HTMLElement };

/** What the Routines section's "…" asks of the list. */
export interface RoutineFolderControl {
  openSectionMenu: (at: { x: number; y: number }, trigger: HTMLElement) => void;
}

type Notice = { text: string; undo: RoutineFolderUndo };

const EMPTY: string[] = [];

/** Sort by prefix stays on offer while a title starts with [X] and the person
 * may change the routines; a server known to lack folders hides it. */
export function canSortRoutinesByPrefix(routines: Routine[], supported: boolean): boolean {
  const editable = routines.length === 0 || routines.some((routine) => routine.canEdit !== false);
  return editable && supported && routinePrefixPlan(routines).length > 0;
}

const MENU_ITEM = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:opacity-50";

export function RoutineFolderList({ bot, routines, runs, grouped, loading, error, viewerPrincipalId, onOpen, onCreateIn, controlRef }: {
  bot: Bot;
  routines: Routine[];
  runs: RoutineRun[];
  grouped: boolean;
  loading?: boolean;
  error?: boolean;
  viewerPrincipalId: string | null;
  onOpen: (routine: Routine) => void;
  /** The folder's +: a new routine in that folder. */
  onCreateIn: (folder: string) => void;
  controlRef?: RefObject<RoutineFolderControl | null>;
}) {
  const { state, dispatch } = useStore();
  const order = state.routineFolders?.[bot.id] ?? EMPTY;
  const groups = useMemo(() => groupRoutinesByFolder(routines, order), [routines, order]);
  const folders = groups.flatMap((group) => group.folder ? [group.folder] : []);
  const editable = routines.length === 0 || routines.some((routine) => routine.canEdit !== false);
  // "unknown" (a server from before the feature list, not yet seen) offers
  // folders; the first answer settles it.
  const supported = useServerFeature("routineFolders") !== "no";
  const [serverNote, setServerNote] = useState(false);
  const [collapsed, setCollapsed] = useState(() => collapsedRoutineFolders(bot.id));
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const prefixPlan = useMemo(() => routinePrefixPlan(routines), [routines]);
  const settle = () => settleRoutinePrefixOffer(bot.id, { loaded: routines.length > 0, hasPrefixTitles: prefixPlan.length > 0, hasFolders: order.length > 0 || routines.some((routine) => !!routine.folder) });
  const [offerAnswered, setOfferAnswered] = useState(settle);
  const [dragging, setDragging] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(new Set<string>());
  useEffect(() => { setCollapsed(collapsedRoutineFolders(bot.id)); setNotice(null); }, [bot.id]);
  // The bot changed, or its routines just loaded: the soft migration runs.
  useEffect(() => { setOfferAnswered(settle()); }, [bot.id, routines.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps
  useImperativeHandle(controlRef, () => ({ openSectionMenu: (at, trigger) => setMenu({ kind: "section", x: at.x, y: at.y, trigger }) }), []);
  const prefixFolders = new Set(prefixPlan.map((step) => routineFolderKey(step.folder))).size;
  const showSortAction = editable && supported && prefixPlan.length > 0;
  const showOffer = editable && supported && !offerAnswered && !notice && prefixPlan.length > 0;

  const act = async (body: RoutineFolderAction): Promise<FolderAnswer | null> => {
    setBusy(true);
    try {
      const answer = await api<FolderAnswer>("/api/routines/folders", { method: "POST", body: JSON.stringify(body) });
      for (const routine of answer.routines) dispatch({ type: "routinePatched", routine });
      dispatch({ type: "routineFoldersPatched", botId: bot.id, folders: answer.folders });
      return answer;
    } catch (failure) {
      if (featureMissingOnServer("routineFolders", failure)) { setServerNote(true); return null; }
      dispatch({ type: "error", message: failure instanceof Error && failure.message ? failure.message : t("routineFolders.failed") });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const toggleFolder = (folder: string) => {
    const key = routineFolderKey(folder);
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key); else next.add(key);
    setCollapsed(next);
    saveCollapsedRoutineFolders(bot.id, next);
  };
  const expand = (folder: string) => {
    if (!collapsed.has(routineFolderKey(folder))) return;
    toggleFolder(folder);
  };

  const move = async (routineIds: string[], folder: string | null) => {
    const answer = await act({ action: "move", botId: bot.id, routineIds, folder });
    if (answer && folder) expand(folder);
  };
  const reorder = (folder: string, direction: -1 | 1) => {
    const index = folders.indexOf(folder);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= folders.length) return;
    const next = [...folders];
    [next[index], next[target]] = [next[target]!, next[index]!];
    dispatch({ type: "routineFoldersPatched", botId: bot.id, folders: next });
    void act({ action: "reorder", botId: bot.id, order: next });
  };
  const setFolderEnabled = (folder: string, enabled: boolean) => {
    const key = routineFolderKey(folder);
    for (const routine of routines) {
      if (routine.folder && routineFolderKey(routine.folder) === key && routine.enabled !== enabled) void flipRoutine(routine, pending.current, api, dispatch);
    }
  };
  const removeFolder = async (folder: string) => {
    const key = routineFolderKey(folder);
    const inside = routines.filter((routine) => routine.folder && routineFolderKey(routine.folder) === key);
    const undo: RoutineFolderUndo = { botId: bot.id, folders: [...folders], routines: inside.map((routine) => ({ id: routine.id, name: routine.name, folder: routine.folder })) };
    const answer = await act({ action: "delete", botId: bot.id, name: folder });
    if (answer) setNotice({ text: t("routineFolders.deleted", { name: folder }), undo });
  };
  const sortByPrefix = async () => {
    const answer = await act({ action: "sort-by-prefix", botId: bot.id });
    // Marked seen only when it worked: a failure, or a server without the
    // route, leaves the offer and the menu action where they were.
    if (!answer) return;
    answerRoutinePrefixOffer(bot.id);
    setOfferAnswered(true);
    if (answer.undo) setNotice({ text: t("routineFolders.sorted", { count: answer.routines.length, folders: prefixFolders }), undo: answer.undo });
  };
  const undo = async () => {
    if (!notice) return;
    const answer = await act({ action: "restore", botId: bot.id, undo: notice.undo });
    if (answer) setNotice(null);
  };

  const closeMenu = (focus = true) => {
    const trigger = menu?.trigger;
    setMenu(null);
    if (focus) requestAnimationFrame(() => trigger?.isConnected && trigger.focus());
  };

  const dropProps = (folder: string | null) => ({
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes(ROUTINE_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDropTarget(folder ?? "");
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => current === (folder ?? "") ? null : current);
    },
    onDrop: (event: DragEvent<HTMLDivElement>) => {
      const id = event.dataTransfer.getData(ROUTINE_DRAG_TYPE);
      setDropTarget(null);
      setDragging(false);
      if (!id) return;
      event.preventDefault();
      const routine = routines.find((candidate) => candidate.id === id);
      if (!routine || routineFolderKey(routine.folder ?? "") === routineFolderKey(folder ?? "")) return;
      void move([id], folder);
    },
  });

  const list = (items: Routine[], label?: string) => <RoutineList
    routines={items}
    viewerPrincipalId={viewerPrincipalId}
    runs={runs}
    grouped={grouped}
    label={label}
    onOpen={onOpen}
    onToggle={(routine) => void flipRoutine(routine, pending.current, api, dispatch)}
    onRowMenu={editable ? (routine, at, trigger) => setMenu({ kind: "row", routine, x: at.x, y: at.y, trigger }) : undefined}
    draggableRows={editable && supported && folders.length > 0}
  />;

  const loose = groups[0]!;
  return <div className="flex flex-col gap-1" data-routine-folders=""
    onDragStart={(event) => { if (event.dataTransfer.types.includes(ROUTINE_DRAG_TYPE)) setDragging(true); }}
    onDragEnd={() => { setDragging(false); setDropTarget(null); }}>
    {showOffer && <div data-routine-prefix-offer="" role="note" className="mb-1 flex items-center gap-2 rounded-lg bg-inset px-3 py-2 text-[12px] leading-4 text-ink-secondary">
      <FolderInput size={14} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{t("routineFolders.offer", { count: prefixPlan.length, folders: prefixFolders })}</span>
      <button type="button" data-routine-prefix-sort="" disabled={busy} onClick={() => void sortByPrefix()} className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50">{t("routineFolders.offerSort")}</button>
      <button type="button" aria-label={t("routineFolders.offerDismiss")} title={t("routineFolders.offerDismiss")} onClick={() => { answerRoutinePrefixOffer(bot.id); setOfferAnswered(true); }} className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><X size={13} /></button>
    </div>}
    {serverNote && <div data-routine-folder-server-note="" role="status" className="mb-1 flex items-center gap-2 rounded-lg bg-inset px-3 py-2 text-[12px] leading-4 text-ink-secondary">
      <FolderInput size={14} className="shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{t("serverRoute.needsUpdate")}</span>
      <button type="button" aria-label={t("common.close")} title={t("common.close")} onClick={() => setServerNote(false)} className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><X size={13} /></button>
    </div>}
    {notice && <div data-routine-folder-notice="" role="status" className="mb-1 flex items-center gap-2 rounded-lg bg-inset px-3 py-2 text-[12px] leading-4 text-ink-secondary">
      <Check size={14} className="shrink-0 text-success" aria-hidden="true" />
      <span className="min-w-0 flex-1">{notice.text}</span>
      <button type="button" data-routine-folder-undo="" disabled={busy} onClick={() => void undo()} className="shrink-0 rounded-md px-1.5 py-0.5 font-medium text-accent hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50">{t("routineFolders.undo")}</button>
      <button type="button" aria-label={t("common.close")} title={t("common.close")} onClick={() => setNotice(null)} className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><X size={13} /></button>
    </div>}

    {(loose.routines.length > 0 || folders.length === 0 || loading || error) ? (
      <div data-routine-folder-section="" {...(folders.length ? dropProps(null) : {})} className={cn("rounded-xl", dropTarget === "" && "ring-1 ring-accent/50")}>
        <RoutineList
          routines={loose.routines}
          viewerPrincipalId={viewerPrincipalId}
          runs={runs}
          grouped={grouped}
          loading={loading}
          error={error}
          onOpen={onOpen}
          onToggle={(routine) => void flipRoutine(routine, pending.current, api, dispatch)}
          onRowMenu={editable ? (routine, at, trigger) => setMenu({ kind: "row", routine, x: at.x, y: at.y, trigger }) : undefined}
          draggableRows={editable && supported && folders.length > 0}
        />
      </div>
    ) : dragging && (
      <div data-routine-folder-section="" {...dropProps(null)} className={cn("rounded-lg border border-dashed border-hairline/60 px-3 py-2 text-center text-[12px] text-ink-tertiary", dropTarget === "" && "border-accent/60 text-ink-secondary")}>
        {t("routineFolders.dropOut")}
      </div>
    )}

    {groups.slice(1).map((group) => {
      const folder = group.folder!;
      const isCollapsed = collapsed.has(routineFolderKey(folder));
      const index = folders.indexOf(folder);
      const anyOn = group.routines.some((routine) => routine.enabled);
      return <div key={folder} data-routine-folder-section={folder} {...dropProps(folder)}
        className={cn("flex flex-col rounded-lg", index > 0 || loose.routines.length > 0 ? "pt-1.5" : "", dropTarget === folder && "bg-hover/60 ring-1 ring-accent/50")}>
        {renaming === folder ? (
          <FolderNameInput initial={folder} label={t("routineFolders.renameLabel")} onCancel={() => setRenaming(null)} onSave={async (name) => {
            const answer = await act({ action: "rename", botId: bot.id, from: folder, to: name });
            if (answer) setRenaming(null);
          }} />
        ) : (
          <RoutineFolderHeader
            name={folder}
            count={group.routines.length}
            paused={group.routines.length > 0 && !anyOn}
            collapsed={isCollapsed}
            editable={editable && supported}
            onToggle={() => toggleFolder(folder)}
            onMove={(direction) => reorder(folder, direction)}
            onMenu={(at, trigger) => setMenu({ kind: "folder", folder, x: at.x, y: at.y, trigger })}
            onCreate={() => onCreateIn(folder)}
          />
        )}
        {!isCollapsed && (group.routines.length > 0
          ? list(group.routines, folder)
          : <p data-routine-folder-empty="" className="px-3 pb-1 text-[12px] leading-4 text-ink-tertiary">{t("routineFolders.empty")}</p>)}
      </div>;
    })}

    {menu && createPortal(<div className="fixed inset-0 z-40" onMouseDown={() => closeMenu(false)} onContextMenu={(event) => { event.preventDefault(); closeMenu(false); }}>
      <div role="menu" data-routine-folder-menu={menu.kind}
        aria-label={menu.kind === "row" ? menu.routine.name : menu.kind === "folder" ? menu.folder : t("computer.tab.routines")}
        style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 248)), top: Math.max(8, Math.min(menu.y, window.innerHeight - 320)) }}
        className="absolute flex max-h-[min(420px,80vh)] w-[240px] flex-col gap-0.5 overflow-y-auto rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px] text-ink shadow-lg"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key === "Escape" || event.key === "Tab") { event.preventDefault(); event.stopPropagation(); closeMenu(); return; }
          if (!(event.target instanceof HTMLInputElement)) navigateThreadMenu(event);
        }}>
        {menu.kind === "section" ? <SortByPrefixItem autoFocus onSelect={() => { closeMenu(); void sortByPrefix(); }} /> : menu.kind === "row" ? (menu.naming
          ? <FolderNameInput label={t("routineFolders.newFolderLabel")} onCancel={() => closeMenu()} onSave={async (name) => { closeMenu(); await move([menu.routine.id], name); }} />
          : <RowMenuItems routine={menu.routine} folders={folders} unavailable={!supported}
            onMove={(folder) => { closeMenu(); void move([menu.routine.id], folder); }}
            onNewFolder={() => setMenu({ ...menu, naming: true })} />)
          : <FolderMenuItems
            canMoveUp={folders.indexOf(menu.folder) > 0}
            canMoveDown={folders.indexOf(menu.folder) < folders.length - 1}
            anyOn={routines.some((routine) => routine.folder && routineFolderKey(routine.folder) === routineFolderKey(menu.folder) && routine.enabled)}
            anyRoutine={routines.some((routine) => routine.folder && routineFolderKey(routine.folder) === routineFolderKey(menu.folder))}
            onRename={() => { closeMenu(false); setRenaming(menu.folder); }}
            onMove={(direction) => { closeMenu(); reorder(menu.folder, direction); }}
            onSetEnabled={(enabled) => { closeMenu(); setFolderEnabled(menu.folder, enabled); }}
            canSortByPrefix={showSortAction}
            onSortByPrefix={() => { closeMenu(); void sortByPrefix(); }}
            onDelete={() => { closeMenu(false); void removeFolder(menu.folder); }} />}
      </div>
    </div>, document.body)}
  </div>;
}

/** A folder's header, the sidebar section's: 30px high, the name at 12px
 * in the secondary ink, the chevron in the gutter before it, then a count. */
export function RoutineFolderHeader({ name, count, paused, collapsed, editable, onToggle, onMove, onMenu, onCreate }: {
  name: string;
  count: number;
  paused: boolean;
  collapsed: boolean;
  editable: boolean;
  onToggle: () => void;
  onMove: (direction: -1 | 1) => void;
  onMenu: (at: { x: number; y: number }, trigger: HTMLElement) => void;
  onCreate: () => void;
}) {
  const label = t(collapsed ? "routineFolders.expand" : "routineFolders.collapse", { name });
  return <div data-routine-folder-header={name}
    onContextMenu={editable ? (event) => { event.preventDefault(); onMenu({ x: event.clientX, y: event.clientY }, event.currentTarget.querySelector("button") ?? event.currentTarget); } : undefined}
    className="group/folder relative flex h-[30px] min-w-0 items-center rounded-md hover:bg-hover">
    <button type="button" aria-expanded={!collapsed} title={label}
      aria-keyshortcuts={editable ? "Alt+ArrowUp Alt+ArrowDown Shift+F10" : undefined}
      onClick={onToggle}
      onKeyDown={(event) => {
        if (!editable) return;
        if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); onMove(event.key === "ArrowUp" ? -1 : 1); }
        if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onMenu({ x: rect.left + 8, y: rect.bottom + 4 }, event.currentTarget);
        }
      }}
      className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-md pb-1.5 pl-0.5 pr-2 pt-2 text-left text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">
      <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center"><ChevronRight size={12} className={cn("transition-transform", !collapsed && "rotate-90")} /></span>
      <span className="truncate text-[12px] font-normal leading-4">{name}</span>
      <span data-routine-folder-count={count} className="shrink-0 text-[11px] leading-4 tabular-nums text-ink-tertiary">{count}</span>
      {paused && <span data-routine-folder-paused="" className="shrink-0 text-[11px] leading-4 text-ink-tertiary">· {t("routineFolders.allPaused")}</span>}
      <span className="sr-only">{t("routineFolders.countLabel", { count })}</span>
    </button>
    {editable && <div className="hidden shrink-0 items-center gap-0.5 pr-0.5 group-hover/folder:flex group-focus-within/folder:flex touch:flex">
      <button type="button" data-routine-folder-more="" aria-label={t("routineFolders.folderMenu", { name })} title={t("routineFolders.folderMenu", { name })}
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu({ x: rect.left, y: rect.bottom + 4 }, event.currentTarget); }}
        className="flex size-6 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><MoreHorizontal size={14} /></button>
      <button type="button" data-routine-folder-new="" aria-label={t("routineFolders.newIn", { name })} title={t("routineFolders.newIn", { name })} onClick={onCreate}
        className="flex size-6 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"><Plus size={14} /></button>
    </div>}
  </div>;
}

function RowMenuItems({ routine, folders, unavailable, onMove, onNewFolder }: { routine: Routine; folders: string[]; unavailable?: boolean; onMove: (folder: string | null) => void; onNewFolder: () => void }) {
  const current = routine.folder ? routineFolderKey(routine.folder) : null;
  // An older server: the same items, disabled, under the neutral line.
  if (unavailable) return <>
    <div role="presentation" className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-ink-tertiary">{t("routineFolders.moveTo")}</div>
    <button type="button" role="menuitem" aria-disabled="true" autoFocus data-routine-new-folder="" className={cn(MENU_ITEM, "cursor-default opacity-50 hover:bg-transparent")} onClick={(event) => event.preventDefault()}>
      <FolderPlus size={14} aria-hidden="true" />{t("routineFolders.newFolder")}
    </button>
    <p data-routine-folder-unavailable="" role="note" className="px-2 pb-1 pt-0.5 text-[12px] leading-4 text-ink-secondary">{t("serverRoute.needsUpdate")}</p>
  </>;
  return <>
    <div role="presentation" className="px-2 pb-1 pt-0.5 text-[11px] font-medium text-ink-tertiary">{t("routineFolders.moveTo")}</div>
    {folders.map((folder, index) => {
      const here = current === routineFolderKey(folder);
      return <button key={folder} type="button" role="menuitemradio" aria-checked={here} autoFocus={index === 0} disabled={here} data-routine-move-to={folder} className={MENU_ITEM} onClick={() => onMove(folder)}>
        <span className="flex size-3.5 shrink-0 items-center justify-center">{here && <Check size={14} />}</span>
        <span className="min-w-0 flex-1 truncate">{folder}</span>
      </button>;
    })}
    <button type="button" role="menuitem" autoFocus={folders.length === 0} data-routine-new-folder="" className={MENU_ITEM} onClick={onNewFolder}>
      <FolderPlus size={14} aria-hidden="true" />{t("routineFolders.newFolder")}
    </button>
    {routine.folder && <>
      <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />
      <button type="button" role="menuitem" data-routine-remove-folder="" className={MENU_ITEM} onClick={() => onMove(null)}>
        <FolderMinus size={14} aria-hidden="true" />{t("routineFolders.removeFrom")}
      </button>
    </>}
  </>;
}

function SortByPrefixItem({ onSelect, autoFocus }: { onSelect: () => void; autoFocus?: boolean }) {
  return <button type="button" role="menuitem" autoFocus={autoFocus} data-routine-sort-by-prefix="" className={MENU_ITEM} onClick={onSelect}>
    <span aria-hidden="true"><FolderInput size={14} /></span>{t("routineFolders.offerSort")}
  </button>;
}

function FolderMenuItems({ canMoveUp, canMoveDown, anyOn, anyRoutine, canSortByPrefix, onSortByPrefix, onRename, onMove, onSetEnabled, onDelete }: {
  canMoveUp: boolean; canMoveDown: boolean; anyOn: boolean; anyRoutine: boolean; canSortByPrefix: boolean; onSortByPrefix: () => void;
  onRename: () => void; onMove: (direction: -1 | 1) => void; onSetEnabled: (enabled: boolean) => void; onDelete: () => void;
}) {
  const items: Array<{ key: string; label: string; icon: ReactNode; onSelect: () => void; group: number; danger?: boolean }> = [
    { key: "rename", label: t("routineFolders.rename"), icon: <Pencil size={14} />, onSelect: onRename, group: 0 },
    ...(canMoveUp ? [{ key: "up", label: t("routineFolders.moveUp"), icon: <ArrowUp size={14} />, onSelect: () => onMove(-1), group: 0 }] : []),
    ...(canMoveDown ? [{ key: "down", label: t("routineFolders.moveDown"), icon: <ArrowDown size={14} />, onSelect: () => onMove(1), group: 0 }] : []),
    ...(anyRoutine ? [anyOn
      ? { key: "pause", label: t("routineFolders.pauseAll"), icon: <Pause size={14} />, onSelect: () => onSetEnabled(false), group: 1 }
      : { key: "resume", label: t("routineFolders.resumeAll"), icon: <Play size={14} />, onSelect: () => onSetEnabled(true), group: 1 }] : []),
    ...(canSortByPrefix ? [{ key: "sort-by-prefix", label: t("routineFolders.offerSort"), icon: <FolderInput size={14} />, onSelect: onSortByPrefix, group: 1 }] : []),
    { key: "delete", label: t("routineFolders.delete"), icon: <Trash2 size={14} />, onSelect: onDelete, group: 2, danger: true },
  ];
  return <>{items.map((item, index) => <Fragment key={item.key}>
    {index > 0 && items[index - 1]!.group !== item.group && <div role="separator" className="mx-2 my-1 h-[0.5px] bg-border" />}
    <button type="button" role="menuitem" autoFocus={index === 0} data-routine-folder-action={item.key} className={cn(MENU_ITEM, item.danger && "text-danger")} onClick={item.onSelect}>
      <span aria-hidden="true">{item.icon}</span>{item.label}
    </button>
  </Fragment>)}</>;
}

/** A folder name typed in place: Enter saves, Escape cancels. */
function FolderNameInput({ initial = "", label, onSave, onCancel }: { initial?: string; label: string; onSave: (name: string) => Promise<void>; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = async () => {
    const name = value.trim();
    if (!name || saving) return;
    if (name === initial.trim()) { onCancel(); return; }
    setSaving(true);
    await onSave(name);
    setSaving(false);
  };
  return <div className="flex h-[30px] items-center px-1" data-routine-folder-name-input="">
    <input ref={ref} value={value} maxLength={ROUTINE_FOLDER_MAX} aria-label={label} placeholder={label} disabled={saving}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); void save(); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
      }}
      onBlur={() => { if (!saving) onCancel(); }}
      className="h-7 w-full rounded-md border border-hairline/60 bg-inset px-2 text-[12px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60" />
  </div>;
}
