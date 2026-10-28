// The Library tab's artifacts: the widgets this bot saved for the person
// (docs/superpowers/specs/2026-10-16-artifacts-design.md). The person opens
// one, pins or unpins it (the server's favorite flag), and deletes it; everything else
// (what it shows, its source, how often it refreshes, where its window
// opens) is the bot's, so the empty state tells them to ask the bot.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppWindow, ExternalLink, LoaderCircle, PictureInPicture2, RefreshCw, Trash2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { deleteArtifact, refreshArtifact, setArtifactFlags, useArtifact, useArtifactWatch, type ArtifactList } from "@/lib/artifacts";
import { ConfirmDialog } from "../ConfirmDialog";
import { ArtifactFrame } from "./ArtifactFrame";
import { canOpenArtifactInOwnWindow, dockArtifactWindow, openArtifactInOwnWindow, popOutArtifact } from "./artifact-windows";
import type { ArtifactSummary } from "../../../shared/artifacts";

/** "30 s", "5 min", "2 h", "1 d". */
export function intervalLabel(seconds: number): string {
  if (seconds < 60) return t("artifacts.interval.seconds", { count: seconds });
  if (seconds < 3600) return t("artifacts.interval.minutes", { count: Math.round(seconds / 60) });
  if (seconds < 86_400) return t("artifacts.interval.hours", { count: Math.round(seconds / 3600) });
  return t("artifacts.interval.days", { count: Math.round(seconds / 86_400) });
}

/** The line under an artifact's title: when its data is from, how often it
 * refreshes, or why it does not. The server's own words ride the title. */
export function artifactStatus(artifact: ArtifactSummary, now = Date.now()): { tone: "muted" | "warning" | "danger"; text: string; detail?: string } {
  const when = relativeTime(artifact.dataAt ?? artifact.updatedAt, now);
  const every = artifact.source && artifact.intervalSeconds ? intervalLabel(artifact.intervalSeconds) : null;
  const detail = artifact.refresh.error;
  switch (artifact.source ? artifact.refresh.state : "idle") {
    case "blocked":
      return { tone: "warning", text: t("artifacts.status.blocked"), ...(detail ? { detail } : {}) };
    case "paused":
      return artifact.refresh.failures > 0
        ? { tone: "danger", text: t("artifacts.status.paused", { count: artifact.refresh.failures }), ...(detail ? { detail } : {}) }
        : { tone: "muted", text: t("artifacts.status.pausedByBot") };
    case "error":
      return { tone: "warning", text: t("artifacts.status.error", { when: relativeTime(artifact.refresh.lastRunAt ?? now, now) }), ...(detail ? { detail } : {}) };
    default:
      return { tone: "muted", text: every ? t("artifacts.status.every", { when, every }) : t("artifacts.updated", { when }) };
  }
}

/** Kept for callers that only need the words. */
export function artifactMeta(artifact: ArtifactSummary, now = Date.now()): string {
  return artifactStatus(artifact, now).text;
}

const STATUS_TONE = { muted: "text-ink-secondary", warning: "text-warning", danger: "text-danger" } as const;

/** What the person can do to an artifact from a row, shared with the
 * palette and the floating windows. */
export interface ArtifactActions {
  open(artifact: ArtifactSummary): void;
  toggleFavorite(artifact: ArtifactSummary): void;
  remove(artifact: ArtifactSummary): void;
  /** Run its source now (only offered when it has one). */
  refresh(artifact: ArtifactSummary): void;
  /** Into its own floating window, or back from it. */
  togglePopped(artifact: ArtifactSummary): void;
  /** Into a real window of its own, outside the app (desktop app only). */
  openInOwnWindow(artifact: ArtifactSummary): void;
  /** Artifact ids whose refresh is running from this window. */
  refreshing: ReadonlySet<string>;
}

export function ArtifactStatusLine({ artifact, now }: { artifact: ArtifactSummary; now?: number }) {
  const status = artifactStatus(artifact, now);
  return (
    <span data-artifact-status={artifact.source ? artifact.refresh.state : "static"} title={status.detail} className={cn("truncate text-[11px]", STATUS_TONE[status.tone])}>
      {status.text}
    </span>
  );
}

/** The person's three actions, with the list patched at once and the
 * server's frame confirming. */
export function useArtifactActions(list: ArtifactList, onError: (text: string) => void): ArtifactActions & {
  opened: ArtifactSummary | null;
  close(): void;
  confirming: ArtifactSummary | null;
  cancelDelete(): void;
  confirmDelete(): void;
  deleting: boolean;
} {
  const [opened, setOpened] = useState<ArtifactSummary | null>(null);
  const [confirming, setConfirming] = useState<ArtifactSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(() => new Set());
  return {
    refreshing,
    togglePopped: (artifact) => {
      const popped = !artifact.popped;
      list.patch(artifact.id, { popped });
      if (popped) setOpened((current) => current?.id === artifact.id ? null : current);
      void (popped ? popOutArtifact(artifact) : dockArtifactWindow(artifact)).catch((reason: unknown) => {
        list.patch(artifact.id, { popped: !popped });
        onError(reason instanceof Error ? reason.message : t("artifacts.error"));
      });
    },
    openInOwnWindow: (artifact) => {
      setOpened((current) => current?.id === artifact.id ? null : current);
      const wasPopped = artifact.popped;
      list.patch(artifact.id, { popped: true });
      void openArtifactInOwnWindow(artifact).then((opened) => {
        if (opened) return;
        list.patch(artifact.id, { popped: wasPopped });
        onError(t("artifacts.error"));
      });
    },
    refresh: (artifact) => {
      if (!artifact.source || refreshing.has(artifact.id)) return;
      setRefreshing((current) => new Set([...current, artifact.id]));
      void refreshArtifact(artifact.botId, artifact.id).then((next) => {
        const { html: _html, data, ...rest } = next;
        list.patch(artifact.id, data ? { ...rest, dataAt: data.at } : rest);
      }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : t("artifacts.error")))
        .finally(() => setRefreshing((current) => {
          const next = new Set(current);
          next.delete(artifact.id);
          return next;
        }));
    },
    opened,
    close: () => setOpened(null),
    open: (artifact) => setOpened(artifact),
    toggleFavorite: (artifact) => {
      const favorite = !artifact.favorite;
      list.patch(artifact.id, { favorite });
      void setArtifactFlags(artifact.botId, artifact.id, { favorite }).catch((reason: unknown) => {
        list.patch(artifact.id, { favorite: !favorite });
        onError(reason instanceof Error ? reason.message : t("artifacts.error"));
      });
    },
    remove: (artifact) => setConfirming(artifact),
    confirming,
    cancelDelete: () => setConfirming(null),
    confirmDelete: () => {
      const artifact = confirming;
      if (!artifact) return;
      setDeleting(true);
      void deleteArtifact(artifact.botId, artifact.id).then(() => {
        list.patch(artifact.id, null);
        setOpened((current) => current?.id === artifact.id ? null : current);
        setConfirming(null);
      }).catch((reason: unknown) => onError(reason instanceof Error ? reason.message : t("artifacts.error")))
        .finally(() => setDeleting(false));
    },
    deleting,
  };
}

/** One artifact, opened over the app. */
export function ArtifactDialog({ artifact, onClose, onPopOut, onOwnWindow }: { artifact: Pick<ArtifactSummary, "id" | "botId" | "title">; onClose: () => void; onPopOut?: () => void; onOwnWindow?: () => void }) {
  const { artifact: full, error, gone } = useArtifact(artifact.botId, artifact.id);
  // open: its source refreshes while this dialog is up
  useArtifactWatch(artifact.id);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const refreshNow = () => {
    setRefreshing(true);
    setRefreshError("");
    void refreshArtifact(artifact.botId, artifact.id)
      .catch((reason: unknown) => setRefreshError(reason instanceof Error ? reason.message : t("artifacts.error")))
      .finally(() => setRefreshing(false));
  };
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeAction = useRef(onClose);
  closeAction.current = onClose;
  const labelId = useId();
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeAction.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, []);
  useEffect(() => { if (gone) closeAction.current(); }, [gone]);
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={labelId} data-artifact-dialog={artifact.id} className="flex h-full max-h-[860px] w-full max-w-[1100px] flex-col overflow-hidden rounded-2xl border border-hairline/40 bg-panel shadow-2xl">
        <header className="flex shrink-0 items-center gap-3 border-b border-hairline/30 px-4 py-2.5">
          <AppWindow size={15} className="shrink-0 text-ink-secondary" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span id={labelId} className="truncate text-[13px] font-medium text-ink">{full?.title ?? artifact.title}</span>
            {full && <ArtifactStatusLine artifact={{ ...full, ...(full.data ? { dataAt: full.data.at } : {}) }} />}
          </span>
          {refreshError && <span role="alert" className="max-w-[40%] truncate text-[11.5px] text-danger" title={refreshError}>{refreshError}</span>}
          {full?.source && (
            <button type="button" onClick={refreshNow} disabled={refreshing} aria-label={t("artifacts.refreshNow")} title={t("artifacts.refreshNow")} className="flex size-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40">
              <RefreshCw size={15} aria-hidden="true" className={cn(refreshing && "animate-spin motion-reduce:animate-none")} />
            </button>
          )}
          {onOwnWindow && (
            <button type="button" onClick={onOwnWindow} data-artifact-own-window aria-label={t("artifacts.ownWindow")} title={t("artifacts.ownWindow")} className="flex size-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <ExternalLink size={15} aria-hidden="true" />
            </button>
          )}
          {onPopOut && (
            <button type="button" onClick={onPopOut} aria-label={t("artifacts.popOut")} title={t("artifacts.popOut")} className="flex size-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <PictureInPicture2 size={15} aria-hidden="true" />
            </button>
          )}
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("attach.close")} className="flex size-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-raised hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
            <X size={17} />
          </button>
        </header>
        <div className="min-h-0 flex-1 p-4">
          {full ? (
            <ArtifactFrame artifact={full} fill />
          ) : error ? (
            <p role="alert" className="text-[13px] text-danger">{t("artifacts.error")}</p>
          ) : (
            <span role="status" className="flex items-center gap-2 text-[13px] text-ink-secondary">
              <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("artifacts.loading")}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Dialogs the actions open: the artifact itself and the delete question. */
export function ArtifactDialogs({ state }: { state: ReturnType<typeof useArtifactActions> }) {
  return (
    <>
      {state.opened && (
        <ArtifactDialog
          artifact={state.opened}
          onClose={state.close}
          onPopOut={() => state.opened && state.togglePopped(state.opened)}
          {...(canOpenArtifactInOwnWindow() ? { onOwnWindow: () => state.opened && state.openInOwnWindow(state.opened) } : {})}
        />
      )}
      <ConfirmDialog
        open={state.confirming !== null}
        title={t("artifacts.deleteTitle")}
        body={t("artifacts.deleteBody", { title: state.confirming?.title ?? "" })}
        confirmLabel={t("artifacts.delete")}
        tone="danger"
        icon={<Trash2 size={16} />}
        pending={state.deleting}
        onCancel={state.cancelDelete}
        onConfirm={state.confirmDelete}
      />
    </>
  );
}
