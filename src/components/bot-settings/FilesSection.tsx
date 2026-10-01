// The Files tab: every file of the open conversation, the person's uploads
// and what the bot attached, linked or wrote, newest first. The server lists
// them (GET /api/threads/:id/files) because the transcript here may hold only
// its newest page, and it serves each one by an opaque id under the same
// roots the message file route uses. Nothing in this tab turns a host path
// into a request.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  Copy,
  Download,
  File as FileIcon,
  FileArchive,
  FileCode,
  FileText,
  Film,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  List,
  LoaderCircle,
  MessageSquare,
  Music,
  RotateCcw,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { activeLocale, t } from "@/lib/i18n";
import { formatSize } from "@/lib/composer-attachments";
import {
  classifyFile,
  countByFilter,
  FILE_FILTERS,
  filesSignature,
  threadFileUrl,
  visibleFiles,
  type FileFilter,
  type FileKind,
  type FileOrigin,
  type FileSort,
  type ThreadFile,
} from "@/lib/chat-files";
import { AttachmentPreviewDialog, canonicalDownloadFilename, type PreviewImage } from "../AttachmentPreview";

const KIND_ICON: Record<FileKind, LucideIcon> = {
  image: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
  code: FileCode,
  archive: FileArchive,
  other: FileIcon,
};

const VIEW_KEY = "omb-files-view";
const REFRESH_DELAY_MS = 400;

function readView(): "grid" | "list" | null {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    return stored === "grid" || stored === "list" ? stored : null;
  } catch {
    return null;
  }
}

function formatWhen(at: number): string {
  try {
    return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(at);
  } catch {
    return new Date(at).toLocaleString();
  }
}

/** A readable local path the person can paste somewhere: an absolute POSIX
 * or Windows path, or a file:// URL. Relative spellings are not offered. */
function copyablePath(path: string): string | null {
  if (/^file:\/\//i.test(path)) {
    try { return decodeURIComponent(new URL(path).pathname).replace(/^\/([a-z]:[\\/])/i, "$1"); } catch { return null; }
  }
  return path.startsWith("/") || /^[a-z]:[\\/]/i.test(path) || path.startsWith("\\\\") ? path : null;
}

async function downloadThreadFile(threadId: string, file: ThreadFile): Promise<void> {
  const response = await fetch(threadFileUrl(threadId, file.id));
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? t("attach.downloadFailed"));
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = canonicalDownloadFilename({
    contentDisposition: response.headers.get("content-disposition"),
    fallback: file.name,
    source: file.name,
    mime: blob.type || response.headers.get("content-type"),
  });
  link.style.display = "none";
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

/** One video or audio file, fetched on open (the server bounds the size),
 * played from a blob URL, and gone when the dialog closes. */
function MediaPreviewDialog({ threadId, file, kind, onClose }: { threadId: string; file: ThreadFile; kind: "video" | "audio"; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    let created: string | null = null;
    void fetch(threadFileUrl(threadId, file.id), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(t("attach.downloadFailed"));
        const mime = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
        if (!mime.startsWith(`${kind}/`)) throw new Error(t(kind === "video" ? "attach.videoUnavailable" : "attach.audioUnavailable"));
        created = URL.createObjectURL(new Blob([await response.arrayBuffer()], { type: mime }));
        if (controller.signal.aborted) URL.revokeObjectURL(created);
        else setSrc(created);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("attach.downloadFailed"));
      });
    return () => {
      controller.abort();
      if (created) URL.revokeObjectURL(created);
    };
  }, [threadId, file.id, kind]);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("botPanel.files.previewAria", { name: file.name })}
        tabIndex={-1}
        className="flex max-h-full w-full max-w-[960px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-black/70 shadow-2xl outline-none"
      >
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
          <span className="min-w-0 truncate text-[13px] font-medium text-white">{file.name}</span>
          <button type="button" onClick={onClose} aria-label={t("attach.close")} className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white/65 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60">
            <X size={19} />
          </button>
        </header>
        <div className="flex min-h-[160px] items-center justify-center p-4">
          {error ? (
            <p role="alert" className="text-[13px] text-white/70">{error}</p>
          ) : !src ? (
            <span role="status" className="flex items-center gap-2 text-[13px] text-white/60">
              <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" /> {t("botPanel.files.previewLoading")}
            </span>
          ) : kind === "video" ? (
            <video src={src} controls playsInline className="max-h-[75vh] max-w-full rounded-lg" aria-label={file.name} />
          ) : (
            <audio src={src} controls className="w-full max-w-md" aria-label={file.name} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Thumbnail({ threadId, file, kind, className, iconSize = 20 }: { threadId: string; file: ThreadFile; kind: FileKind; className?: string; iconSize?: number }) {
  const [failed, setFailed] = useState(false);
  const Icon = KIND_ICON[kind];
  return (
    <span className={cn("relative flex items-center justify-center overflow-hidden bg-inset text-ink-secondary", className)}>
      {kind === "image" && file.available && !failed ? (
        <img
          src={threadFileUrl(threadId, file.id, true)}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <Icon size={iconSize} aria-hidden="true" />
      )}
    </span>
  );
}

function meta(file: ThreadFile): string {
  return [t(`botPanel.files.source.${file.source}`), file.size === null ? null : formatSize(file.size), formatWhen(file.at)]
    .filter(Boolean)
    .join(" · ");
}

/** The open conversation's files: the fetch, the live refresh and the jump
 * back into the chat. FilesBrowser is everything the person sees. */
export function FilesSection({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const threadId = bot.threadId;
  const [files, setFiles] = useState<ThreadFile[] | null>(null);
  const [error, setError] = useState(false);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const request = useRef(0);
  const loadedOnce = useRef(false);

  const load = useCallback(() => {
    const id = ++request.current;
    return api<{ files: ThreadFile[] }>(`/api/threads/${encodeURIComponent(threadId)}/files`)
      .then((body) => {
        if (id !== request.current) return;
        loadedOnce.current = true;
        setFiles(Array.isArray(body.files) ? body.files : []);
        setError(false);
      })
      .catch(() => {
        if (id === request.current) setError(true);
      });
  }, [threadId]);

  // A different conversation starts from nothing, not from the last one's list.
  useEffect(() => {
    loadedOnce.current = false;
    setFiles(null);
    setError(false);
  }, [threadId]);

  // Live: refetch shortly after the transcript changes in a way that can add
  // a file (a message, a tool settling, an attachment), so files appear
  // while the chat runs without a request per streamed token.
  const signature = useMemo(() => filesSignature(bot.messages), [bot.messages]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), loadedOnce.current ? REFRESH_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [load, signature]);
  useEffect(() => () => { request.current++; }, []);

  // A jump to a message older than the loaded page pulls earlier pages in
  // until the message is there; ChatView then scrolls to it and flashes it.
  useEffect(() => {
    if (!pendingJump) return;
    if (bot.messages.some((message) => message.id === pendingJump) || !bot.hasMore) {
      setPendingJump(null);
      return;
    }
    if (!state.loadingOlder[threadId]) dispatch({ type: "loadOlderMessages", threadId });
  }, [pendingJump, bot.messages, bot.hasMore, state.loadingOlder, threadId, dispatch]);

  const jump = (file: ThreadFile) => {
    dispatch({ type: "focusMessage", threadId, messageId: file.messageId });
    if (!bot.messages.some((message) => message.id === file.messageId)) setPendingJump(file.messageId);
    // Below the desktop breakpoint this panel covers the chat.
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1023px)").matches) {
      dispatch({ type: "toggleSettings", open: false });
    }
  };

  return <FilesBrowser key={threadId} threadId={threadId} files={files} error={error} onRetry={() => void load()} onJump={jump} />;
}

/** Filters, search, sort, grid or list, and each file's actions. */
export function FilesBrowser({ threadId, files, error, onRetry, onJump, initialFilter = "all", initialView }: {
  threadId: string;
  /** null while the first load is in flight. */
  files: ThreadFile[] | null;
  error: boolean;
  onRetry: () => void;
  onJump: (file: ThreadFile) => void;
  initialFilter?: FileFilter;
  initialView?: "grid" | "list";
}) {
  const [filter, setFilter] = useState<FileFilter>(initialFilter);
  const [origin, setOrigin] = useState<FileOrigin>("all");
  const [sort, setSort] = useState<FileSort>("newest");
  const [search, setSearch] = useState("");
  const [pickedView, setPickedView] = useState<"grid" | "list" | null>(() => initialView ?? readView());
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  const [media, setMedia] = useState<{ file: ThreadFile; kind: "video" | "audio" } | null>(null);

  useEffect(() => {
    if (!status || status.tone === "error") return;
    const timer = setTimeout(() => setStatus(null), 2500);
    return () => clearTimeout(timer);
  }, [status]);

  const all = useMemo(() => files ?? [], [files]);
  const counts = useMemo(() => countByFilter(all, { origin, search }), [all, origin, search]);
  const shown = useMemo(() => visibleFiles(all, { filter, origin, search, sort }), [all, filter, origin, search, sort]);
  // Grid suits pictures; a chosen view sticks.
  const view = pickedView ?? (filter === "image" || filter === "video" ? "grid" : "list");
  const images = useMemo(() => shown.filter((file) => file.available && classifyFile(file) === "image"), [shown]);
  const previews = useMemo<PreviewImage[]>(() => images.map((file) => ({
    src: threadFileUrl(threadId, file.id, true),
    name: file.name,
    downloadUrl: threadFileUrl(threadId, file.id),
    downloadName: canonicalDownloadFilename({ fallback: file.name, source: file.name, mime: file.mime }),
  })), [images, threadId]);

  const chooseView = (next: "grid" | "list") => {
    setPickedView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* this session only */ }
  };

  const download = (file: ThreadFile) => {
    setStatus(null);
    void downloadThreadFile(threadId, file).catch((reason: unknown) =>
      setStatus({ tone: "error", text: reason instanceof Error ? reason.message : t("attach.downloadFailed") }));
  };

  const open = (file: ThreadFile) => {
    if (!file.available) return;
    const kind = classifyFile(file);
    if (kind === "image") {
      const index = images.findIndex((candidate) => candidate.id === file.id);
      if (index >= 0) setImageIndex(index);
      return;
    }
    if (kind === "video" || kind === "audio") {
      setMedia({ file, kind });
      return;
    }
    download(file);
  };

  const copyPath = (path: string) => {
    void navigator.clipboard?.writeText(path)
      .then(() => setStatus({ tone: "ok", text: t("botPanel.files.copied") }))
      .catch(() => setStatus({ tone: "error", text: t("attach.saveFailed") }));
  };

  const actionButton = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-40";

  const actions = (file: ThreadFile, className?: string) => {
    const path = file.available ? copyablePath(file.localPath ?? file.path) : null;
    return (
      <div className={cn("flex items-center gap-0.5", className)}>
        <button type="button" onClick={() => onJump(file)} aria-label={t("botPanel.files.jump")} title={t("botPanel.files.jump")} className={actionButton}>
          <MessageSquare size={14} />
        </button>
        <button type="button" disabled={!file.available} onClick={() => download(file)} aria-label={t("botPanel.files.downloadAria", { name: file.name })} title={t("attach.download")} className={actionButton}>
          <Download size={14} />
        </button>
        {path && (
          <button type="button" onClick={() => copyPath(path)} aria-label={t("botPanel.files.copyPath")} title={path} className={actionButton}>
            <Copy size={14} />
          </button>
        )}
      </div>
    );
  };

  const selectClass = "min-w-0 flex-1 rounded-lg border border-hairline-weak bg-elevated px-2 py-1.5 text-[12.5px] text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";
  const emptyText = search.trim()
    ? t("botPanel.files.noMatch", { query: search.trim() })
    : t(`botPanel.files.empty.${filter}`);

  return (
    <div className="flex flex-col gap-3" data-files-section>
      <div className="flex items-center gap-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-hairline-weak bg-elevated px-2.5 py-1.5">
          <Search size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && search) {
                event.stopPropagation();
                setSearch("");
              }
            }}
            placeholder={t("botPanel.files.search")}
            aria-label={t("botPanel.files.search")}
            className="w-full min-w-0 bg-transparent text-[13px] text-ink placeholder:text-ink-secondary focus:outline-none"
          />
        </label>
        <div className="flex shrink-0 items-center rounded-lg border border-hairline-weak p-0.5">
          {(["grid", "list"] as const).map((mode) => {
            const Icon = mode === "grid" ? LayoutGrid : List;
            const label = t(mode === "grid" ? "botPanel.files.viewGrid" : "botPanel.files.viewList");
            return (
              <button
                key={mode}
                type="button"
                aria-pressed={view === mode}
                aria-label={label}
                title={label}
                onClick={() => chooseView(mode)}
                className={cn("flex size-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60", view === mode ? "bg-elevated-hover text-ink" : "text-ink-secondary hover:text-ink")}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>
      </div>

      <div role="group" aria-label={t("botPanel.files.filterAria")} className="flex flex-wrap gap-1.5">
        {FILE_FILTERS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={filter === id}
            onClick={() => setFilter(id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] leading-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              filter === id ? "border-transparent bg-ink text-app" : "border-hairline-weak text-ink-secondary hover:text-ink",
            )}
          >
            {t(`botPanel.files.filter.${id}`)}
            <span className={cn("tabular-nums", filter === id ? "text-app/70" : "text-ink-tertiary")}>{counts[id]}</span>
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <select value={origin} onChange={(event) => setOrigin(event.target.value as FileOrigin)} aria-label={t("botPanel.files.originAria")} className={selectClass}>
          {(["all", "bot", "you"] as const).map((id) => <option key={id} value={id}>{t(`botPanel.files.origin.${id}`)}</option>)}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value as FileSort)} aria-label={t("botPanel.files.sortAria")} className={selectClass}>
          {(["newest", "name", "size"] as const).map((id) => <option key={id} value={id}>{t(`botPanel.files.sort.${id}`)}</option>)}
        </select>
      </div>

      <p className="sr-only" aria-live="polite">{files ? t("botPanel.files.count", { count: shown.length }) : ""}</p>
      {status && (
        <p role={status.tone === "error" ? "alert" : "status"} className={cn("flex items-center gap-1.5 text-[12px]", status.tone === "error" ? "text-danger" : "text-success")}>
          {status.tone === "ok" && <Check size={13} aria-hidden="true" />} {status.text}
        </p>
      )}

      {files === null && !error ? (
        <div role="status" className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-secondary">
          <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("botPanel.files.loading")}
        </div>
      ) : files === null && error ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center text-[13px] text-ink-secondary">
          <span role="alert">{t("botPanel.files.error")}</span>
          <button type="button" onClick={onRetry} className="flex items-center gap-1.5 rounded-md border border-hairline-weak px-2.5 py-1 text-[12px] text-ink hover:bg-hover">
            <RotateCcw size={12} /> {t("chat.retry")}
          </button>
        </div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-ink-secondary">
          <FolderOpen size={20} aria-hidden="true" />
          <span className="text-[13px]">{emptyText}</span>
        </div>
      ) : view === "grid" ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2" data-files-view="grid">
          {shown.map((file) => {
            const kind = classifyFile(file);
            return (
              <li key={file.id} className={cn("group relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-hairline-weak", !file.available && "opacity-60")}>
                <button
                  type="button"
                  onClick={() => open(file)}
                  disabled={!file.available}
                  aria-label={t("botPanel.files.openAria", { name: file.name })}
                  title={file.available ? file.name : t("botPanel.files.unavailableHint")}
                  className="block aspect-square w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 disabled:cursor-default"
                >
                  <Thumbnail threadId={threadId} file={file} kind={kind} className="size-full" iconSize={24} />
                </button>
                <div className="min-w-0 px-2 py-1.5">
                  <div className="truncate text-[12px] text-ink" title={file.name}>{file.name}</div>
                  <div className="truncate text-[10.5px] text-ink-secondary">
                    {file.available ? (file.size === null ? t(`botPanel.files.source.${file.source}`) : formatSize(file.size)) : t("botPanel.files.unavailable")}
                  </div>
                </div>
                {actions(file, "absolute right-1 top-1 rounded-lg bg-panel/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100 motion-reduce:transition-none")}
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="flex flex-col" data-files-view="list">
          {shown.map((file) => {
            const kind = classifyFile(file);
            return (
              <li key={file.id} className="flex min-w-0 items-center gap-2.5 border-b border-hairline-weak py-2 last:border-b-0">
                <button
                  type="button"
                  onClick={() => open(file)}
                  disabled={!file.available}
                  aria-label={t("botPanel.files.openAria", { name: file.name })}
                  title={file.available ? file.name : t("botPanel.files.unavailableHint")}
                  className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default", !file.available && "opacity-60")}
                >
                  <Thumbnail threadId={threadId} file={file} kind={kind} className="size-10 shrink-0 rounded-lg" iconSize={17} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] text-ink">{file.name}</span>
                    <span className="truncate text-[11px] text-ink-secondary">
                      {file.available ? meta(file) : `${t("botPanel.files.unavailable")} · ${formatWhen(file.at)}`}
                    </span>
                  </span>
                </button>
                {actions(file)}
              </li>
            );
          })}
        </ul>
      )}

      {imageIndex !== null && previews[imageIndex] && (
        <AttachmentPreviewDialog image={previews[imageIndex]} images={previews} initialIndex={imageIndex} onClose={() => setImageIndex(null)} />
      )}
      {media && <MediaPreviewDialog threadId={threadId} file={media.file} kind={media.kind} onClose={() => setMedia(null)} />}
    </div>
  );
}
