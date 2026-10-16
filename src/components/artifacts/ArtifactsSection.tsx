// The Files tab's Artifacts: the widgets this bot saved for the person
// (docs/superpowers/specs/2026-10-16-artifacts-design.md). The person opens
// one, pins or unpins it as a favorite, and deletes it; everything else
// (what it shows, its source, how often it refreshes, where its window
// opens) is the bot's, so the empty state tells them to ask the bot.
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AppWindow, LoaderCircle, MoreHorizontal, RotateCcw, Star, Trash2, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import { deleteArtifact, setArtifactFlags, useArtifact, type ArtifactList } from "@/lib/artifacts";
import { ConfirmDialog } from "../ConfirmDialog";
import { ArtifactFrame } from "./ArtifactFrame";
import type { ArtifactSummary } from "../../../shared/artifacts";

const ICON_BUTTON = "flex size-7 shrink-0 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-40";

/** The line under an artifact's title. */
export function artifactMeta(artifact: ArtifactSummary, now = Date.now()): string {
  return t("artifacts.updated", { when: relativeTime(artifact.dataAt ?? artifact.updatedAt, now) });
}

/** What the person can do to an artifact from a row, shared with the
 * palette and the floating windows. */
export interface ArtifactActions {
  open(artifact: ArtifactSummary): void;
  toggleFavorite(artifact: ArtifactSummary): void;
  remove(artifact: ArtifactSummary): void;
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
  return {
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

export function ArtifactRow({ artifact, actions, now }: { artifact: ArtifactSummary; actions: ArtifactActions; now?: number }) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) setMenu(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenu(false);
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);
  const favoriteLabel = artifact.favorite ? t("artifacts.unfavorite") : t("artifacts.favorite");
  return (
    <li data-artifact-row={artifact.id} className="flex min-w-0 items-center gap-2 border-b border-hairline-weak py-2 last:border-b-0">
      <button
        type="button"
        onClick={() => actions.open(artifact)}
        aria-label={t("artifacts.openAria", { title: artifact.title })}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-inset text-ink-secondary">
          <AppWindow size={17} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] text-ink">{artifact.title}</span>
          <span className="truncate text-[11px] text-ink-secondary">{artifactMeta(artifact, now)}</span>
        </span>
      </button>
      <button
        type="button"
        aria-pressed={artifact.favorite}
        aria-label={favoriteLabel}
        title={favoriteLabel}
        data-artifact-favorite={artifact.favorite ? "on" : "off"}
        onClick={() => actions.toggleFavorite(artifact)}
        className={cn(ICON_BUTTON, artifact.favorite && "text-accent")}
      >
        <Star size={14} aria-hidden="true" fill={artifact.favorite ? "currentColor" : "none"} />
      </button>
      <div ref={menuRef} className="relative">
        <button type="button" aria-label={t("artifacts.moreAria", { title: artifact.title })} title={t("artifacts.moreAria", { title: artifact.title })} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((value) => !value)} className={ICON_BUTTON}>
          <MoreHorizontal size={14} aria-hidden="true" />
        </button>
        {menu && (
          <div role="menu" aria-label={artifact.title} className="absolute right-0 top-full z-30 mt-1 flex w-[200px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px] shadow-lg popover-surface">
            <button type="button" role="menuitem" onClick={() => { setMenu(false); actions.open(artifact); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink hover:bg-hover">
              <AppWindow size={14} className="shrink-0 text-ink-secondary" aria-hidden="true" /> {t("artifacts.open")}
            </button>
            <button type="button" role="menuitem" onClick={() => { setMenu(false); actions.remove(artifact); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-danger hover:bg-hover">
              <Trash2 size={14} className="shrink-0" aria-hidden="true" /> {t("artifacts.delete")}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

/** One artifact, opened over the app. */
export function ArtifactDialog({ artifact, onClose }: { artifact: Pick<ArtifactSummary, "id" | "botId" | "title">; onClose: () => void }) {
  const { artifact: full, error, gone } = useArtifact(artifact.botId, artifact.id);
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
          <span id={labelId} className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">{artifact.title}</span>
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

/** The Favorites section and the Artifacts list share this body. */
export function ArtifactsList({ list, favoritesOnly = false, actions, now }: {
  list: ArtifactList;
  favoritesOnly?: boolean;
  actions: ArtifactActions;
  now?: number;
}) {
  const shown = (list.artifacts ?? []).filter((artifact) => !favoritesOnly || artifact.favorite);
  if (list.artifacts === null && !list.error) {
    return favoritesOnly ? null : (
      <div role="status" className="flex items-center justify-center gap-2 py-10 text-[13px] text-ink-secondary">
        <LoaderCircle size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> {t("artifacts.loading")}
      </div>
    );
  }
  if (list.artifacts === null && list.error) {
    return favoritesOnly ? null : (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-[13px] text-ink-secondary">
        <span role="alert">{t("artifacts.error")}</span>
        <button type="button" onClick={list.reload} className="flex items-center gap-1.5 rounded-md border border-hairline-weak px-2.5 py-1 text-[12px] text-ink hover:bg-hover">
          <RotateCcw size={12} aria-hidden="true" /> {t("chat.retry")}
        </button>
      </div>
    );
  }
  if (shown.length === 0) {
    return favoritesOnly ? null : (
      <div data-artifacts-empty="" className="flex flex-col items-center gap-2 px-6 py-12 text-center text-ink-secondary">
        <AppWindow size={20} aria-hidden="true" />
        <span className="text-[13px]">{t("artifacts.empty")}</span>
      </div>
    );
  }
  return (
    <ul className="flex flex-col" data-artifacts-list={favoritesOnly ? "favorites" : "all"}>
      {shown.map((artifact) => <ArtifactRow key={artifact.id} artifact={artifact} actions={actions} now={now} />)}
    </ul>
  );
}

/** Dialogs the actions open: the artifact itself and the delete question. */
export function ArtifactDialogs({ state }: { state: ReturnType<typeof useArtifactActions> }) {
  return (
    <>
      {state.opened && <ArtifactDialog artifact={state.opened} onClose={state.close} />}
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

export function ArtifactsSectionHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="px-0.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-tertiary">{children}</h3>;
}
