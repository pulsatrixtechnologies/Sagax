// Bot panel > Library: the conversation's files and the bot's artifacts in one
// list. What the person pinned sits on top under "Pinned"; the rest is grouped
// by period ("This week", "Older"), each group in a rounded card, one line per
// item: the type's icon and the name. A file's pin is kept on the server per
// conversation; an artifact's pin is its favorite flag, also on the server, so
// both follow the person to iOS. Skills live on the Personas page and the
// bot's Claude Code plugins in Connect apps, in that bot's scope.
// (docs/superpowers/specs/2026-10-16-artifacts-design.md)
import { useState, type ReactNode } from "react";
import { AppWindow, Copy, Download, FolderOpen, LoaderCircle, MessageSquare, MoreHorizontal, Pin, PinOff, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { copyText } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useBotArtifacts, type ArtifactList } from "@/lib/artifacts";
import { classifyFile, threadFileUrl, type ThreadFile } from "@/lib/chat-files";
import { groupLibraryItems, libraryItems, type LibraryItem } from "@/lib/library-items";
import { AttachmentPreviewDialog, canonicalDownloadFilename } from "../AttachmentPreview";
import type { ArtifactSummary } from "../../../shared/artifacts";
import { ArtifactDialogs, artifactStatus, useArtifactActions, type ArtifactActions } from "../artifacts/ArtifactsSection";
import { canOpenArtifactInOwnWindow } from "../artifacts/artifact-windows";
import { copyablePath, downloadThreadFile, FileHover, KIND_ICON, MediaPreviewDialog, MenuItem, PopoverMenu, useThreadFiles } from "./FilesSection";

/** Opens Connect apps in this bot's install scope. */
export function openBotPlugins(dispatch: ReturnType<typeof useStore>["dispatch"], botId: string): void {
  dispatch({ type: "togglePlugins", open: true, botId });
}

export function LibraryTab({ bot }: { bot: Bot }) {
  const list = useBotArtifacts(bot.id);
  const files = useThreadFiles(bot);
  const advanced = useAdvancedMode();
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const setPinned = (file: ThreadFile, pinned: boolean) => {
    files.patch(file.id, { pinned });
    void api(`/api/threads/${encodeURIComponent(files.threadId)}/files/${encodeURIComponent(file.id)}/pin`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned }),
    }).catch((reason: unknown) => {
      files.patch(file.id, { pinned: !pinned });
      setStatus({ tone: "error", text: reason instanceof Error ? reason.message : t("botPanel.library.pinFailed") });
    });
  };
  return (
    <LibraryBody
      key={files.threadId}
      threadId={files.threadId}
      files={files.files}
      filesError={files.error}
      onRetryFiles={files.reload}
      onJump={files.jump}
      onPinFile={setPinned}
      list={list}
      advanced={advanced}
      status={status}
    />
  );
}

/** Everything the tab shows, given the loaded lists (tests render it). */
export function LibraryBody({ threadId, files, filesError = false, onRetryFiles = () => {}, onJump = () => {}, onPinFile = () => {}, list, advanced = false, now, status = null, openMenus = false }: {
  threadId: string;
  /** null while the first load is in flight. */
  files: ThreadFile[] | null;
  filesError?: boolean;
  onRetryFiles?: () => void;
  onJump?: (file: ThreadFile) => void;
  onPinFile?: (file: ThreadFile, pinned: boolean) => void;
  list: ArtifactList;
  /** Advanced mode: a file's menu also offers Copy path. */
  advanced?: boolean;
  now?: number;
  status?: { tone: "ok" | "error"; text: string } | null;
  /** Tests: render every row menu already open. */
  openMenus?: boolean;
}) {
  const [error, setError] = useState("");
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [imageId, setImageId] = useState<string | null>(null);
  const [media, setMedia] = useState<{ file: ThreadFile; kind: "video" | "audio" } | null>(null);
  const actions = useArtifactActions(list, setError);

  const loading = (files === null && !filesError) || (list.artifacts === null && !list.error);
  const failed = (files === null && filesError) && (list.artifacts === null && list.error);
  const items = libraryItems(files, list.artifacts);
  const groups = groupLibraryItems(items, now ?? Date.now());
  const shownNote = note ?? status;
  // Pictures open in one viewer that steps through them, newest first.
  const pictures = (files ?? []).filter((file) => file.available && classifyFile(file) === "image").sort((a, b) => b.at - a.at);
  const previews = pictures.map((file) => ({
    src: threadFileUrl(threadId, file.id, true),
    name: file.name,
    downloadUrl: threadFileUrl(threadId, file.id),
    downloadName: canonicalDownloadFilename({ fallback: file.name, source: file.name, mime: file.mime }),
  }));
  const imageIndex = imageId ? pictures.findIndex((file) => file.id === imageId) : -1;

  const download = (file: ThreadFile) => {
    setNote(null);
    void downloadThreadFile(threadId, file).catch((reason: unknown) =>
      setNote({ tone: "error", text: reason instanceof Error ? reason.message : t("attach.downloadFailed") }));
  };
  const open = (file: ThreadFile) => {
    if (!file.available) return;
    const kind = classifyFile(file);
    if (kind === "image") setImageId(file.id);
    else if (kind === "video" || kind === "audio") setMedia({ file, kind });
    else download(file);
  };
  const copyPath = (path: string) => {
    void copyText(path).then((result) => setNote(result === "copied"
      ? { tone: "ok", text: t("botPanel.files.copied") }
      : { tone: "error", text: t("attach.saveFailed") }));
  };

  const row = (item: LibraryItem): ReactNode => item.kind === "file"
    ? <FileRow key={item.key} threadId={threadId} file={item.file} advanced={advanced} openMenus={openMenus} onOpen={open} onJump={onJump} onDownload={download} onCopyPath={copyPath} onPin={onPinFile} />
    : <ArtifactLibraryRow key={item.key} artifact={item.artifact} actions={actions} now={now} openMenus={openMenus} />;
  const card = (id: string, title: string, rows: LibraryItem[]) => (
    <section key={id} data-library-group={id} className="flex flex-col gap-1.5">
      <h3 className="px-0.5 text-[12px] font-medium text-ink-secondary">{title}</h3>
      <ul className="flex flex-col overflow-hidden rounded-2xl border border-hairline-weak bg-elevated">{rows.map(row)}</ul>
    </section>
  );

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 pt-2" data-library="">
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      {shownNote && (
        <p role={shownNote.tone === "error" ? "alert" : "status"} className={cn("text-[12px]", shownNote.tone === "error" ? "text-danger" : "text-success")}>{shownNote.text}</p>
      )}
      {loading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-secondary">
          <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("botPanel.library.loading")}
        </div>
      ) : failed ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-[13px] text-ink-secondary">
          <span role="alert">{t("botPanel.library.error")}</span>
          <button type="button" onClick={() => { onRetryFiles(); list.reload(); }} className="flex items-center gap-1.5 rounded-md border border-hairline-weak px-2.5 py-1 text-[12px] text-ink hover:bg-hover">
            <RotateCcw size={12} aria-hidden="true" /> {t("chat.retry")}
          </button>
        </div>
      ) : items.length === 0 ? (
        <div data-library-empty="" className="flex flex-col items-center gap-2 px-6 py-12 text-center text-ink-secondary">
          <FolderOpen size={20} aria-hidden="true" />
          <span className="text-[13px]">{t("botPanel.library.empty")}</span>
        </div>
      ) : (
        <>
          {groups.pinned.length > 0 && card("pinned", t("botPanel.library.pinned"), groups.pinned)}
          {groups.periods.map((period) => card(period.id, t(`botPanel.library.period.${period.id}`), period.items))}
        </>
      )}
      {imageIndex >= 0 && <AttachmentPreviewDialog image={previews[imageIndex]!} images={previews} initialIndex={imageIndex} onClose={() => setImageId(null)} />}
      {media && <MediaPreviewDialog threadId={threadId} file={media.file} kind={media.kind} onClose={() => setMedia(null)} />}
      <ArtifactDialogs state={actions} />
    </div>
  );
}

const ROW_BUTTON = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-40";
/** Row actions show on hover and focus, and always on a touch screen. */
const REVEAL = "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 has-[[aria-expanded=true]]:opacity-100 touch:opacity-100 motion-reduce:transition-none";

/** One line: the type's icon and the name, the pin and a menu. */
function LibraryRow({ attr, icon, name, trail, pinned, pinLabel, onTogglePin, menuLabel, menu, openMenus, children }: {
  attr: Record<`data-${string}`, string>;
  icon: ReactNode;
  name: string;
  trail?: ReactNode;
  pinned: boolean;
  pinLabel: string;
  onTogglePin: () => void;
  menuLabel: string;
  menu: (close: () => void) => ReactNode;
  openMenus: boolean;
  /** The open button around icon and name. */
  children: (content: ReactNode) => ReactNode;
}) {
  return (
    <li {...attr} className="group flex min-w-0 items-center gap-1 border-b border-hairline-weak px-2.5 py-1.5 last:border-b-0">
      {children(
        <>
          <span className="flex size-6 shrink-0 items-center justify-center text-ink-secondary">{icon}</span>
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink" title={name}>{name}</span>
          {trail}
        </>,
      )}
      <button
        type="button"
        aria-pressed={pinned}
        aria-label={pinLabel}
        title={pinLabel}
        data-library-pin={pinned ? "on" : "off"}
        onClick={onTogglePin}
        className={cn(ROW_BUTTON, pinned ? "text-accent" : REVEAL)}
      >
        <Pin size={14} aria-hidden="true" fill={pinned ? "currentColor" : "none"} />
      </button>
      <PopoverMenu className={REVEAL} buttonClass={ROW_BUTTON} label={menuLabel} icon={<MoreHorizontal size={14} />} menuLabel={name} defaultOpen={openMenus}>
        {menu}
      </PopoverMenu>
    </li>
  );
}

const OPEN_BUTTON = "flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default";

function FileRow({ threadId, file, advanced, openMenus, onOpen, onJump, onDownload, onCopyPath, onPin }: {
  threadId: string;
  file: ThreadFile;
  advanced: boolean;
  openMenus: boolean;
  onOpen: (file: ThreadFile) => void;
  onJump: (file: ThreadFile) => void;
  onDownload: (file: ThreadFile) => void;
  onCopyPath: (path: string) => void;
  onPin: (file: ThreadFile, pinned: boolean) => void;
}) {
  const Icon = KIND_ICON[classifyFile(file)];
  const pinned = file.pinned === true;
  const path = advanced && file.available ? copyablePath(file.localPath ?? file.path) : null;
  const pinLabel = pinned ? t("botPanel.library.unpin") : t("botPanel.library.pin");
  return (
    <LibraryRow
      attr={{ "data-library-file": file.id }}
      icon={<Icon size={16} aria-hidden="true" />}
      name={file.name}
      pinned={pinned}
      pinLabel={pinLabel}
      onTogglePin={() => onPin(file, !pinned)}
      menuLabel={t("botPanel.files.moreAria", { name: file.name })}
      openMenus={openMenus}
      menu={(close) => (
        <>
          <MenuItem icon={<MessageSquare size={14} />} label={t("botPanel.files.jump")} onClick={() => { close(); onJump(file); }} />
          <MenuItem icon={<Download size={14} />} label={t("attach.download")} ariaLabel={t("botPanel.files.downloadAria", { name: file.name })} disabled={!file.available} onClick={() => { close(); onDownload(file); }} />
          <MenuItem icon={pinned ? <PinOff size={14} /> : <Pin size={14} />} label={pinLabel} onClick={() => { close(); onPin(file, !pinned); }} />
          {path && <MenuItem icon={<Copy size={14} />} label={t("botPanel.files.copyPath")} title={path} onClick={() => { close(); onCopyPath(path); }} />}
        </>
      )}
    >
      {(content) => (
        <FileHover threadId={threadId} file={file}>{(anchor) => (
          <button
            type="button"
            {...(anchor ?? {})}
            onClick={(event) => { anchor?.onClick(event); if (!event.defaultPrevented) onOpen(file); }}
            disabled={!file.available}
            aria-label={t("botPanel.files.openAria", { name: file.name })}
            title={file.available ? undefined : t("botPanel.files.unavailableHint")}
            className={cn(OPEN_BUTTON, !file.available && "opacity-60")}
          >
            {content}
          </button>
        )}</FileHover>
      )}
    </LibraryRow>
  );
}

function ArtifactLibraryRow({ artifact, actions, now, openMenus }: { artifact: ArtifactSummary; actions: ArtifactActions; now?: number; openMenus: boolean }) {
  const status = artifactStatus(artifact, now);
  const pinned = artifact.favorite;
  const pinLabel = pinned ? t("botPanel.library.unpin") : t("botPanel.library.pin");
  return (
    <LibraryRow
      attr={{ "data-artifact-row": artifact.id }}
      icon={<AppWindow size={16} aria-hidden="true" />}
      name={artifact.title}
      trail={status.tone === "muted" ? null : (
        <span data-artifact-status={artifact.refresh.state} title={status.detail ? `${status.text} ${status.detail}` : status.text} className={cn("size-1.5 shrink-0 rounded-full", status.tone === "danger" ? "bg-danger" : "bg-warning")} />
      )}
      pinned={pinned}
      pinLabel={pinLabel}
      onTogglePin={() => actions.toggleFavorite(artifact)}
      menuLabel={t("artifacts.moreAria", { title: artifact.title })}
      openMenus={openMenus}
      menu={(close) => (
        <>
          <MenuItem icon={<AppWindow size={14} />} label={t("artifacts.open")} onClick={() => { close(); actions.open(artifact); }} />
          <MenuItem icon={pinned ? <PinOff size={14} /> : <Pin size={14} />} label={pinLabel} onClick={() => { close(); actions.toggleFavorite(artifact); }} />
          {artifact.popped && canOpenArtifactInOwnWindow() && (
            <MenuItem icon={<X size={14} />} label={t("artifacts.closeWindow")} onClick={() => { close(); actions.closeWindow(artifact); }} />
          )}
          {artifact.source && (
            <MenuItem icon={<RefreshCw size={14} />} label={t("artifacts.refreshNow")} disabled={actions.refreshing.has(artifact.id)} onClick={() => { close(); actions.refresh(artifact); }} />
          )}
          <MenuItem icon={<Trash2 size={14} />} label={t("artifacts.delete")} onClick={() => { close(); actions.remove(artifact); }} />
        </>
      )}
    >
      {(content) => (
        <button type="button" onClick={() => actions.open(artifact)} aria-label={t("artifacts.openAria", { title: artifact.title })} className={OPEN_BUTTON}>
          {content}
        </button>
      )}
    </LibraryRow>
  );
}
