// One floating window (src/lib/floating-windows.ts): a title bar to move it,
// a close button, a corner to resize it. Non-blocking: no backdrop, the app
// behind keeps its clicks. A press anywhere in it brings it to the front.
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { FloatingRect, FloatingWindowEntry, FloatingWindows } from "@/lib/floating-windows";

type Gesture = { mode: "move" | "resize"; pointer: number; startX: number; startY: number; rect: FloatingRect; last: FloatingRect };

export function FloatingWindow({
  entry,
  manager,
  focused,
  children,
}: {
  entry: FloatingWindowEntry;
  manager: FloatingWindows;
  focused: boolean;
  children: ReactNode;
}) {
  const gesture = useRef<Gesture | null>(null);
  const { rect } = entry;

  const start = (mode: Gesture["mode"]) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (mode === "move" && (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { mode, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, rect, last: rect };
  };
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    const next =
      current.mode === "move"
        ? { ...current.rect, x: current.rect.x + dx, y: current.rect.y + dy }
        : { ...current.rect, width: current.rect.width + dx, height: current.rect.height + dy };
    current.last = next;
    manager.setRect(entry.id, next);
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    gesture.current = null;
    manager.setRect(entry.id, current.last, { commit: true });
  };

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-label={entry.title}
      data-floating-window={entry.id}
      data-floating-kind={entry.kind}
      data-focused={focused ? "" : undefined}
      className={cn(
        "window-no-drag pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border bg-card text-ink shadow-2xl shadow-black/40",
        focused ? "border-hairline/70" : "border-hairline/40",
      )}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
      onPointerDownCapture={() => manager.focus(entry.id)}
    >
      <header
        className="flex h-9 shrink-0 cursor-grab select-none items-center gap-2 border-b border-hairline/40 bg-inset/40 pl-3 pr-1.5 active:cursor-grabbing"
        onPointerDown={start("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        onDoubleClick={() => {
          const remembered = manager.rememberedRect(entry.id);
          if (remembered) manager.setRect(entry.id, remembered);
        }}
      >
        <span className={cn("min-w-0 flex-1 truncate text-[12.5px] font-medium", focused ? "text-ink" : "text-ink-secondary")}>{entry.title}</span>
        <button
          type="button"
          className="rounded-md p-1 text-ink-tertiary hover:bg-hover hover:text-ink"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={() => manager.close(entry.id)}
        >
          <X size={14} />
        </button>
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
      <span
        aria-hidden
        data-floating-resize=""
        className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize touch-none"
        onPointerDown={start("resize")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </section>
  );
}
