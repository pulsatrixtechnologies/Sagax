import { ChevronDown, ChevronRight } from "lucide-react";
import type { DragEvent, FocusEvent, KeyboardEvent, MouseEvent } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { lastInputWasPointer, trackInputModality } from "@/lib/input-modality";
import {
  sidebarAttentionLabel,
  type SidebarSectionAttention,
} from "@/lib/sidebar-attention";

export function SidebarSectionHeader({
  name,
  collapsed,
  attention,
  alert,
  onToggle,
  reorderable,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
  onContextMenu,
}: {
  name: string;
  collapsed: boolean;
  attention?: SidebarSectionAttention;
  alert?: boolean;
  onToggle?: () => void;
  reorderable: boolean;
  dragging: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onMove?: (direction: -1 | 1) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const attentionLabel = attention ? sidebarAttentionLabel(attention) : "";
  // a click must not draw the focus frame on the header; Tab or an arrow
  // key does (2026-10-15, src/lib/input-modality.ts)
  trackInputModality();
  const onHeaderFocus = (event: FocusEvent<HTMLButtonElement>) => {
    if (lastInputWasPointer()) event.currentTarget.dataset.pointerFocus = "";
    else delete event.currentTarget.dataset.pointerFocus;
  };
  const onHeaderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Tab" || event.key.startsWith("Arrow")) delete event.currentTarget.dataset.pointerFocus;
    if (!reorderable || !event.altKey) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onMove?.(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      onMove?.(1);
    }
  };

  const marks = (
    <>
      {attention && attention.waiting > 0 && (
        <span
          aria-hidden="true"
          className="min-w-4 rounded-full bg-warning/15 px-1 text-center text-[9px] font-semibold leading-4 text-warning"
        >
          {attention.waiting}
        </span>
      )}
      {attention && attention.unread > 0 && (
        <span
          aria-hidden="true"
          className="min-w-4 rounded-full bg-accent/15 px-1 text-center text-[9px] font-semibold leading-4 text-accent"
        >
          {attention.unread}
        </span>
      )}
      {attention && attention.working > 0 && (
        <span aria-hidden="true" className="flex size-4 items-center justify-center">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
        </span>
      )}
      {attentionLabel && <span className="sr-only">{attentionLabel}</span>}
      {alert && (
        <>
          <span data-testid="section-alert" aria-hidden="true" className="size-2 shrink-0 rounded-full bg-danger" />
          <span className="sr-only">{t("computer.routines.needsYou")}</span>
        </>
      )}
    </>
  );

  return (
    <div
      className={cn("pb-0.5", dragging && "opacity-40")}
      data-section={name}
      tabIndex={onContextMenu ? -1 : undefined}
      onContextMenu={onContextMenu}
      draggable={reorderable || undefined}
      onDragStart={reorderable ? onDragStart : undefined}
      onDragEnd={reorderable ? onDragEnd : undefined}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          onFocus={onHeaderFocus}
          onKeyDown={onHeaderKeyDown}
          data-sidebar-section-header=""
          aria-expanded={!collapsed}
          aria-keyshortcuts={reorderable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
          title={
            reorderable
              ? collapsed
                ? t("sidebar.section.expandReorder", { name })
                : t("sidebar.section.collapseReorder", { name })
              : collapsed
                ? t("sidebar.section.expand", { name })
                : t("sidebar.section.collapse", { name })
          }
          // Sentence-case 12px name in secondary ink, a small chevron for fold
          // state (› folded, ⌄ open; same pair as pinned/attention panels),
          // then attention marks. No item count (#1664; count stays off after
          // the My Team reference pass).
          className="group/section flex h-[30px] w-full min-w-0 items-center gap-1.5 rounded-md px-2 pb-1.5 pt-2 text-left text-sidebar-ink-secondary transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink"
        >
          <Chevron size={12} aria-hidden="true" data-section-chevron="" className="shrink-0 opacity-80" />
          <span className="sidebar-section-label truncate text-[12px] font-normal leading-4">{name}</span>
          {marks}
        </button>
      ) : (
        <div className="flex h-[30px] min-w-0 items-center gap-2 px-2 pb-1.5 pt-2">
          <span className="sidebar-section-label truncate text-[12px] font-normal leading-4 text-sidebar-ink-secondary">{name}</span>
          {marks}
        </div>
      )}
    </div>
  );
}
