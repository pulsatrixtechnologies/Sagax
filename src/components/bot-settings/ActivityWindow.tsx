// The task windows' frame (ActivityDetailModal, ActivityListModal): exactly
// Settings' window (SETTINGS_WINDOW, JC 2026-10-16: "the same size as other
// modal, ex: settings"), on the same dimmed layer, with its round close
// button. It is a layer on document.body, not a native <dialog>: the live
// conversation it can show (ActivityConversation, the real ChatView) opens
// menus, link cards and previews in portals on document.body, which a
// top-layer modal would leave inert behind it.
//
// Escape closes this layer only, never the bot panel under it (the panel
// ignores keys pressed outside its own subtree); a key a control inside
// already used (a menu, the composer) is left alone. Tab stays inside, and
// focus goes back where it was when the window closes.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { DialogCloseButton, SETTINGS_WINDOW } from "../SettingsPrimitives";

const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** The width of an element, followed as it changes; `fallback` until it is
 * measured (and on the server render, where nothing is). */
export function useElementWidth<T extends HTMLElement>(fallback: number): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width || fallback);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [fallback]);
  return [ref, width];
}

export function ActivityWindow({ labelledBy, onClose, frameProps, frameRef, children }: {
  labelledBy: string;
  onClose: () => void;
  /** data-* hooks for the frame */
  frameProps?: Record<string, string | undefined>;
  frameRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}) {
  const ownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Programmatic: no focus ring around the whole window.
    ownRef.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      if (event.defaultPrevented) return;
      event.preventDefault();
      onClose();
      return;
    }
    const frame = ownRef.current;
    if (event.key !== "Tab" || !frame) return;
    const focusable = Array.from(frame.querySelectorAll<HTMLElement>(FOCUSABLE))
      .filter((element) => typeof element.checkVisibility !== "function" || element.checkVisibility());
    if (focusable.length === 0) {
      event.preventDefault();
      frame.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !frame.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const layer = (
    <div
      className={SETTINGS_WINDOW.backdrop}
      data-activity-window=""
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={onKeyDown}
    >
      <div
        ref={(node) => {
          ownRef.current = node;
          if (typeof frameRef === "function") frameRef(node);
          else if (frameRef) (frameRef as React.RefObject<HTMLDivElement | null>).current = node;
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        {...frameProps}
        className={cn(SETTINGS_WINDOW.frame, "relative text-ink")}
      >
        <DialogCloseButton label={t("common.close")} onClick={onClose} />
        {children}
      </div>
    </div>
  );
  // The server render (tests) has no document to portal into.
  return typeof document === "undefined" ? layer : createPortal(layer, document.body);
}

/** Settings' borderless pills (2026-10-16), the chosen one filled: the
 * history's filters and a task's views (Summary, Steps, Conversation). */
export const activityChip = (selected: boolean) => cn(
  "inline-flex h-7 min-h-[44px] items-center gap-1.5 rounded-full px-2.5 text-[13px] leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none md:min-h-0",
  selected ? "bg-selected text-ink" : "text-ink-secondary hover:bg-hover hover:text-ink",
);
