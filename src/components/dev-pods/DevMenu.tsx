// The dev panel's menus: a pod's options, a folder's or a branch's actions,
// a change's actions. Drawn in a portal on <body> (AnchoredPopover), so the
// scrolling rail or a card never clips them; they flip above their button
// near the bottom and shift to stay inside the window. Close on a choice,
// Escape, or a press outside both the button and the menu.
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { AnchoredPopover } from "../AnchoredPopover";
import { useMenuMotion } from "../MenuMotion";

export const DEV_MENU_ITEM =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

export function DevMenu({ open, anchorRef, label, onClose, width = 210, children }: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  label?: string;
  onClose: () => void;
  width?: number;
  children: ReactNode;
}) {
  const motion = useMenuMotion(open);
  const menuRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, onClose, anchorRef]);
  if (!motion.shown) return null;
  return (
    <AnchoredPopover
      anchorRef={anchorRef}
      popoverRef={menuRef}
      role="menu"
      {...(label ? { "aria-label": label } : {})}
      side="bottom"
      align="end"
      className={cn("flex flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 shadow-lg", motion.className)}
      style={{ width }}
    >
      {/* a closing menu is only a picture of one (useMenuMotion exitProps) */}
      <div className="contents" {...motion.exitProps}>{children}</div>
    </AnchoredPopover>
  );
}
