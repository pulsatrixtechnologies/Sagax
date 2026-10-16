import type { DragEvent, KeyboardEvent, MouseEvent } from "react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import {
  sidebarAttentionLabel,
  type SidebarSectionAttention,
} from "@/lib/sidebar-attention";

export function SidebarSectionHeader({
  name,
  collapsed,
  attention,
  count,
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
  /** What the section holds, shown at the right while it is folded. */
  count?: number;
  alert?: boolean;
  onToggle?: () => void;
  reorderable: boolean;
  dragging: boolean;
  onDragStart?: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd?: () => void;
  onMove?: (direction: -1 | 1) => void;
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  const attentionLabel = attention ? sidebarAttentionLabel(attention) : "";
  const onHeaderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
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
          onKeyDown={onHeaderKeyDown}
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
          // The reference window's header: the name in sentence case (as
          // upstream), 12px regular in the secondary ink, then the section's
          // attention marks; no chevron (a click folds it, aria-expanded
          // says which way), and while folded what it holds at the right
          className="group/section flex h-7 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-sidebar-ink-secondary transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink"
        >
          <span className="sidebar-section-label truncate text-[12px] font-normal leading-4">{name}</span>
          {marks}
          {collapsed && count !== undefined && count > 0 && (
            <span data-section-count="" className="ml-auto shrink-0 text-[12px] leading-4 tabular-nums">{count}</span>
          )}
        </button>
      ) : (
        <div className="flex h-7 min-w-0 items-center gap-2 px-2">
          <span className="sidebar-section-label truncate text-[12px] font-normal leading-4 text-sidebar-ink-secondary">{name}</span>
          {marks}
        </div>
      )}
    </div>
  );
}
