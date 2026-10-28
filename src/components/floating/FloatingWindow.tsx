// One floating window (src/lib/floating-windows.ts): a title bar to move it,
// a close button, a corner to resize it. Non-blocking: no backdrop, the app
// behind keeps its clicks. A press anywhere in it brings it to the front.
// A window that can leave the app (onDetach) leaves it when its title bar is
// let go outside the app's window: the pointer's screen point goes to it.
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { AppWindow, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { FloatingRect, FloatingWindowEntry, FloatingWindows } from "@/lib/floating-windows";

type Gesture = { mode: "move" | "resize"; pointer: number; startX: number; startY: number; rect: FloatingRect; last: FloatingRect; outside: boolean };

/** Whether a pointer at these page coordinates is outside the app's window. */
export function pointerOutsideViewport(clientX: number, clientY: number, viewport = { width: window.innerWidth, height: window.innerHeight }): boolean {
  return clientX < 0 || clientY < 0 || clientX >= viewport.width || clientY >= viewport.height;
}

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
  const [leaving, setLeaving] = useState(false);
  const { rect } = entry;
  const detachable = manager.detachable(entry.id);

  const start = (mode: Gesture["mode"]) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (mode === "move" && (event.target as HTMLElement).closest("button")) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { mode, pointer: event.pointerId, startX: event.clientX, startY: event.clientY, rect, last: rect, outside: false };
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
    if (current.mode === "move" && detachable) {
      const outside = pointerOutsideViewport(event.clientX, event.clientY);
      if (outside !== current.outside) {
        current.outside = outside;
        setLeaving(outside);
      }
    }
  };
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const current = gesture.current;
    if (!current || current.pointer !== event.pointerId) return;
    gesture.current = null;
    setLeaving(false);
    // Let go outside the app: it leaves for a window of its own, at the
    // pointer. Its place in the app stays the one it had before the drag.
    if (event.type === "pointerup" && current.mode === "move" && detachable && pointerOutsideViewport(event.clientX, event.clientY)) {
      manager.setRect(entry.id, current.rect);
      manager.detach(entry.id, { x: event.screenX, y: event.screenY });
      return;
    }
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
      data-floating-leaving={leaving ? "" : undefined}
      className={cn(
        "window-no-drag pointer-events-auto fixed flex flex-col overflow-hidden rounded-xl border bg-card text-ink shadow-2xl shadow-black/40",
        leaving ? "border-accent ring-2 ring-accent/60" : focused ? "border-hairline/70" : "border-hairline/40",
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
        {leaving && (
          <span role="status" className="flex shrink-0 items-center gap-1 text-[11.5px] text-accent">
            <AppWindow size={12} aria-hidden="true" /> {t("floating.releaseToDetach")}
          </span>
        )}
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
