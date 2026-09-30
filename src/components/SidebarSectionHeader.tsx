import { ChevronRight } from "lucide-react";
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
          <span className="size-1.5 animate-pulse rounded-full bg-success" />
        </span>
      )}
      {attentionLabel && <span className="sr-only">{attentionLabel}</span>}
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
          // Perspicax's group header: a small-capitals label, the section's
          // attention marks, and a chevron that turns as the group opens
          className="group/section flex h-[30px] w-full min-w-0 items-center gap-2 rounded-lg px-3 text-left text-sidebar-ink-secondary transition-colors hover:bg-sidebar-hover hover:text-sidebar-ink"
        >
          <span className="sidebar-section-label truncate text-[11px] font-medium leading-4">{name}</span>
          {marks}
          <ChevronRight size={16} strokeWidth={2} className={cn("ml-auto shrink-0 transition-transform duration-200 motion-reduce:transition-none", !collapsed && "rotate-90")} aria-hidden="true" />
        </button>
      ) : (
        <div className="flex h-[30px] min-w-0 items-center gap-2 px-3">
          <span className="sidebar-section-label truncate text-[11px] font-medium leading-4 text-sidebar-ink-secondary">{name}</span>
          {marks}
        </div>
      )}
    </div>
  );
}
