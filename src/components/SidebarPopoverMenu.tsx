// The popover at the foot of the sidebar: a trigger that opens a list of
// items above itself. The keyboard handling, the outside-click close and the
// item chrome live here once.
//
// The footer's account row opens on hover when it carries the sidebar's
// places (it is a browsing gesture: you sweep the bottom of the sidebar
// looking for the page you want); a click pins it. A trigger without
// places opens on click only, because a menu that appears under the cursor
// when you are aiming at nothing in particular is startling.
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { bindHoverIntent, createHoverIntent } from "./sidebar-hover-intent";

export interface SidebarMenuItem {
  key: string;
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  /** the item wants attention (a failed routine, a downloaded update); a
   * folded item cannot show its own dot, so the trigger carries one on its
   * behalf */
  attention?: boolean;
  /** what the attention means — something went wrong (default) or something
   * good is waiting */
  attentionTone?: "danger" | "accent";
  disabled?: boolean;
  /** draw a hairline above this item — the Grok-style trailing group */
  separatorBefore?: boolean;
  /** rendered at the trailing edge (a spinner, a status dot) */
  trailing?: React.ReactNode;
  /** the menu normally closes on select; an item that reports progress in
   * place (the update check) keeps it open */
  keepOpen?: boolean;
  onSelect: () => void;
  /** `data-tour` id, so the guided tour can point at this item */
  tourId?: string;
}

/** Opening is quick enough to feel like a hover, closing is slow enough to
 * forgive a diagonal path from the trigger to the menu. */
const OPEN_DELAY_MS = 80;
const CLOSE_DELAY_MS = 250;

export function SidebarPopoverMenu({
  tourId,
  items,
  ariaLabel,
  openOnHover = false,
  menuClassName = "left-0 right-0",
  renderTrigger,
}: {
  /** `data-tour` id for the trigger button */
  tourId?: string;
  items: SidebarMenuItem[];
  ariaLabel: string;
  openOnHover?: boolean;
  /** horizontal placement of the menu; it spans the trigger by default, a
   * trigger narrower than its items (the avatar) gives it a width instead */
  menuClassName?: string;
  renderTrigger: (state: {
    open: boolean;
    attention: boolean;
    /** the loudest tone among the items asking for attention */
    attentionTone: "danger" | "accent";
  }) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinnedState] = useState(false);
  // the hover listeners are native and bound once, so they read the latest
  // pin and mode through refs rather than a stale render's closure
  const pinnedRef = useRef(false);
  const openOnHoverRef = useRef(openOnHover);
  openOnHoverRef.current = openOnHover;
  const setPinned = (value: boolean) => {
    pinnedRef.current = value;
    setPinnedState(value);
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const [hover] = useState(() =>
    createHoverIntent({
      openDelayMs: OPEN_DELAY_MS,
      closeDelayMs: CLOSE_DELAY_MS,
      active: () => openOnHoverRef.current && !pinnedRef.current,
      setOpen,
    }),
  );
  const clearTimers = hover.cancel;
  useEffect(() => {
    const root = rootRef.current;
    return root ? bindHoverIntent(root, hover) : undefined;
  }, [hover]);

  const close = () => {
    clearTimers();
    setPinned(false);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && close();
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      // the guided tour's card floats outside the menu but is talking about it
      if (event.target instanceof Element && event.target.closest("[data-tour-card]")) return;
      if (!rootRef.current?.contains(event.target)) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const asking = items.filter((item) => item.attention);
  const attention = asking.length > 0;
  // a failure outranks good news when both are folded away
  const attentionTone = asking.some((item) => item.attentionTone !== "accent") ? "danger" : "accent";

  return (
    <div
      ref={rootRef}
      className="relative"
      // hover is bound natively in the effect above (see sidebar-hover-intent)
      // a keyboard user tabbing in gets the same menu a pointer gets
      onFocus={() => {
        if (!openOnHover) return;
        clearTimers();
        setOpen(true);
      }}
      onBlur={(event) => {
        if (pinnedRef.current) return;
        if (!event.relatedTarget || !rootRef.current?.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        type="button"
        data-tour={tourId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => {
          clearTimers();
          if (open && (pinned || !openOnHover)) close();
          else {
            setPinned(true);
            setOpen(true);
          }
        }}
        className="w-full"
      >
        {renderTrigger({ open, attention, attentionTone })}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={ariaLabel}
          className={cn("animate-pop-in absolute bottom-full z-40 mb-1 flex min-w-[200px] flex-col gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px]", menuClassName)}
        >
          {items.map((item) => (
            <div key={item.key}>
              {item.separatorBefore && <div className="mx-2 my-1 h-[0.5px] bg-border" />}
              <button
                type="button"
                role="menuitem"
                data-tour={item.tourId}
                disabled={item.disabled}
                onClick={() => {
                  item.onSelect();
                  if (!item.keepOpen) close();
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] disabled:opacity-60",
                  item.active ? "bg-selected text-ink" : "text-ink hover:bg-hover",
                )}
              >
                {item.icon && (
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center",
                      "text-ink",
                    )}
                  >
                    {item.icon}
                  </span>
                )}
                <span className="flex-1 truncate">{item.label}</span>
                {item.trailing}
                {item.attention && (
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      item.attentionTone === "accent" ? "bg-accent" : "bg-danger",
                    )}
                  />
                )}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
