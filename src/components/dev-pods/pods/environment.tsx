// Environment: the computer the bot works on (its place and, when the
// transcript or the server says it, Connecting or Ready), the folder its
// shell runs in, and the repository and branch the server read there.
import { useEffect, useRef, useState } from "react";
import { FolderGit2, GitBranch, Monitor, MoreHorizontal, Plus, Settings } from "lucide-react";
import { t } from "@/lib/i18n";
import { api, type Bot } from "@/state/store";
import { copyText } from "@/lib/copy-text";
import { effectivePlace, isComputerPlace, placeLabelKey, type EffectivePlace } from "@/lib/place";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { cn } from "@/lib/cn";
import { useMenuMotion } from "../../MenuMotion";
import { DEV_WINDOW } from "../detector";
import { registerDevPod, type DevPodContext } from "../registry";
import { currentBranch, folderLabel, isParallelTaskBranch } from "../sources";

export interface EnvironmentData {
  place: EffectivePlace;
  placeLabel: string;
  computer: boolean;
  state: "connecting" | "ready" | null;
  folder: string | null;
  branch: string | null;
}

/** owner/name of a repository, as the server reports it (shared/bot-activity.ts). */
export interface EnvironmentRepo {
  name: string;
  url?: string;
}

export function environmentData(ctx: Pick<DevPodContext, "bot" | "task" | "messages" | "computerStart">, organization = false): EnvironmentData | null {
  const place = effectivePlace(ctx.bot, ctx.task);
  const computer = isComputerPlace(place);
  const recent = ctx.messages.slice(-DEV_WINDOW);
  // Ready only when something proves it: a screen frame, or a command that
  // ran there and succeeded, since the last start.
  const ranThere = recent.some((message) => message.kind === "screen" || (message.kind === "activity" && message.tool?.ok === true && message.tool.place !== undefined));
  const state = ctx.computerStart ? "connecting" : computer && ranThere ? "ready" : null;
  // task.cwd: undefined = not pinned yet (the bot's folder), null = the
  // private bot workspace, a string = that folder
  const pinned = ctx.task?.cwd;
  const folder = pinned === undefined ? ctx.bot.cwd ?? null : pinned;
  const branch = currentBranch(recent) ?? null;
  if (!computer && !folder && !branch) return null;
  return { place, placeLabel: t(placeLabelKey(place, organization)), computer, state, folder, branch };
}

/** What GET /api/bots/:id/activity says about this conversation's folder:
 * the repository and the branch checked out there. Absent fields stay
 * absent (the pod then keeps what the transcript already proved). */
export function environmentWork(payload: unknown, threadId: string): { repo?: EnvironmentRepo; branch?: string } {
  const items = (payload as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return {};
  const item = items.find((entry) => (entry as { threadId?: unknown }).threadId === threadId) as
    { code?: { repo?: unknown; repoUrl?: unknown; branch?: unknown } } | undefined;
  const code = item?.code;
  const repo = typeof code?.repo === "string" && code.repo.trim()
    ? { name: code.repo.trim(), ...(typeof code.repoUrl === "string" && code.repoUrl.trim() ? { url: code.repoUrl.trim() } : {}) }
    : undefined;
  const branch = typeof code?.branch === "string" && code.branch.trim() ? code.branch.trim() : undefined;
  return { ...(repo ? { repo } : {}), ...(branch ? { branch } : {}) };
}

const MENU_ITEM = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover";

/** A "..." menu anchored to its button. Closes on a choice, Escape, or a
 * press outside it. */
function RowMenu({ open, label, onToggle, onClose, children }: { open: boolean; label: string; onToggle: () => void; onClose: () => void; children: React.ReactNode }) {
  const motion = useMenuMotion(open);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!ref.current?.parentElement?.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose]);
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={onToggle}
        className={MINI_BUTTON}
        data-env-menu=""
      >
        <MoreHorizontal size={14} />
      </button>
      {motion.shown && (
        <div ref={ref} role="menu" className={cn("absolute right-0 top-7 z-40 flex w-[210px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5", motion.className)} {...motion.exitProps}>
          {children}
        </div>
      )}
    </div>
  );
}

const ROW = "flex min-h-[28px] items-center gap-2";
const ROW_ICON = "shrink-0 text-ink-secondary";
const MINI_BUTTON = "flex size-6 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink";

/** The branch as a person reads it: Sagax's parallel-task branches are named
 * after an id, so they read as what they are (the name stays in the tooltip). */
export function environmentBranchLabel(branch: string): string {
  return isParallelTaskBranch(branch) ? t("folder.parallelBranch") : branch;
}

/** A folder the desktop bridge may act on: an absolute path, nothing else. */
function localFolder(folder: string | null): string | null {
  return folder && folder.startsWith("/") ? folder : null;
}

/** The folder the bot works in, as the server keeps it: null is its own
 * private folder (bot-settings/AccessSection.tsx). */
async function saveFolder(bot: Bot, cwd: string | null): Promise<void> {
  await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ cwd }) });
}

function EnvironmentBody({ data, ctx }: { data: EnvironmentData; ctx: DevPodContext }) {
  const [menu, setMenu] = useState<"folder" | "branch" | null>(null);
  const [work, setWork] = useState<{ repo?: EnvironmentRepo; branch?: string }>({});
  const [notice, setNotice] = useState<string | null>(null);
  const close = () => setMenu(null);
  const folder = data.folder;
  const local = localFolder(folder);
  const branch = work.branch ?? data.branch;

  useEffect(() => {
    if (!folder) return;
    let live = true;
    api(`/api/bots/${ctx.bot.id}/activity?filter=coding`)
      .then((payload) => { if (live) setWork(environmentWork(payload, ctx.bot.threadId)); })
      .catch(() => { /* the transcript's branch stays; the repo simply is not shown */ });
    return () => { live = false; };
  }, [ctx.bot.id, ctx.bot.threadId, folder]);

  const pickFolder = async (mode: "change" | "add") => {
    const chosen = await window.ogb?.pickFolder?.(mode === "change" ? folder ?? undefined : undefined);
    if (!chosen || chosen === folder) return;
    try {
      await saveFolder(ctx.bot, chosen);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };
  const reveal = async () => {
    if (!local) return;
    const result = await window.ogb?.revealInFolder?.(local);
    if (result && result !== "shown") setNotice(t("devPods.environment.folderMissing"));
  };
  const openTerminal = async (cwd: string) => {
    const opened = await window.ogb?.openTerminalAt?.(cwd);
    if (opened === false) setNotice(t("devPods.environment.terminalUnavailable"));
  };
  const run = (action: () => void) => () => { close(); action(); };

  return (
    <div className="flex flex-col gap-1">
      {data.computer && (
        <div className={ROW} data-env-computer="">
          <Monitor size={14} strokeWidth={1.75} aria-hidden="true" className={ROW_ICON} />
          <span className="min-w-0 flex-1 truncate text-ink">{data.placeLabel}</span>
          {data.state && (
            <span data-env-state={data.state} className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-secondary">
              <span aria-hidden="true" className={cn("size-1.5 rounded-full", data.state === "ready" ? "bg-success" : "animate-pulse bg-warning")} />
              {t(data.state === "ready" ? "devPods.environment.ready" : "devPods.environment.connecting")}
            </span>
          )}
          <button type="button" className={MINI_BUTTON} onClick={() => ctx.dispatch({ type: "toggleSettings", open: true, section: "worksOn", botId: ctx.bot.id })} aria-label={t("devPods.environment.settings")} title={t("devPods.environment.settings")}>
            <Settings size={13} />
          </button>
        </div>
      )}
      <div className={ROW} data-env-folder="">
        <FolderGit2 size={14} strokeWidth={1.75} aria-hidden="true" className={ROW_ICON} />
        <span className="min-w-0 flex-1 truncate text-ink" title={folder ?? undefined}>
          {folder ? folderLabel(folder) : <span className="text-ink-secondary">{t("devPods.environment.ownFolder")}</span>}
        </span>
        <RowMenu open={menu === "folder"} label={t("devPods.environment.folderMenu")} onToggle={() => setMenu(menu === "folder" ? null : "folder")} onClose={close}>
          {local && <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => void reveal())}>{t("devPods.environment.showInFinder")}</button>}
          {folder && <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => void copyText(folder))}>{t("devPods.environment.copyPath")}</button>}
          {local && <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => void pickFolder("change"))}>{t("devPods.environment.changeFolder")}</button>}
          <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => void pickFolder("add"))}>{t("devPods.environment.addFolder")}</button>
          {local && <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => void openTerminal(local))}>{t("devPods.environment.openTerminal")}</button>}
        </RowMenu>
      </div>
      {work.repo && (
        <div className={cn(ROW, "pl-[22px]")} data-env-repo="">
          <span className="sr-only">{t("devPods.environment.repository")}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink-secondary" title={work.repo.name}>{work.repo.name}</code>
        </div>
      )}
      {branch && (
        <div className={ROW} data-env-branch="">
          <GitBranch size={14} strokeWidth={1.75} aria-hidden="true" className={ROW_ICON} />
          <span className="sr-only">{t("devPods.environment.branch")}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink" title={branch}>{environmentBranchLabel(branch)}</code>
          <RowMenu open={menu === "branch"} label={t("devPods.environment.branchMenu")} onToggle={() => setMenu(menu === "branch" ? null : "branch")} onClose={close}>
            <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => void copyText(branch))}>{t("devPods.environment.copyBranch")}</button>
            {local && <button type="button" role="menuitem" className={MENU_ITEM} onClick={run(() => void openTerminal(local))}>{t("devPods.environment.openTerminal")}</button>}
          </RowMenu>
        </div>
      )}
      {notice && <p data-env-notice="" className="px-1 text-[12px] text-danger">{notice}</p>}
      {!folder && (
        <button type="button" data-env-add="" onClick={() => void pickFolder("add")} className={cn(ROW, "rounded-md px-1 text-ink-secondary hover:bg-hover hover:text-ink")}>
          <Plus size={14} strokeWidth={1.75} aria-hidden="true" className={ROW_ICON} />
          <span className="min-w-0 flex-1 truncate">{t("devPods.environment.addFolder")}</span>
        </button>
      )}
    </div>
  );
}

registerDevPod<EnvironmentData>({
  id: "environment",
  order: 10,
  title: () => t("devPods.environment.title"),
  icon: Monitor,
  collapsible: true,
  useData: (ctx) => {
    const organization = usePerspicaxOrg() !== null;
    const data = environmentData(ctx, organization);
    return data ? { status: "ready", data } : { status: "empty" };
  },
  Body: EnvironmentBody,
});
