// Keeps a popover drawn in a portal (fixed, on document.body) next to its
// anchor: placed before the first paint, then again whenever anything
// scrolls, the window changes size or the popover itself does (a search in
// the reaction picker). The placement rules live in src/lib/popover-placement.ts.
import { useLayoutEffect, type RefObject } from "react";

import { placePopover } from "@/lib/popover-placement";

export function useAnchoredPopover(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  popupRef: RefObject<HTMLElement | null>,
  { prefer, align }: { prefer: "above" | "below"; align: "start" | "end" },
) {
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = anchorRef.current;
      const popup = popupRef.current;
      if (!anchor || !popup) return;
      // offset sizes, not the box: the opening pop scales the popover
      popup.style.maxHeight = "";
      const rtl = getComputedStyle(anchor).direction === "rtl";
      const edge = (align === "end") !== rtl ? "right" : "left";
      const spot = placePopover(
        anchor.getBoundingClientRect(),
        { width: popup.offsetWidth, height: popup.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        { prefer, edge },
      );
      popup.style.left = `${spot.left}px`;
      popup.style.top = `${spot.top}px`;
      if (spot.maxHeight !== undefined) popup.style.maxHeight = `${spot.maxHeight}px`;
      popup.dataset.side = spot.side;
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    if (popupRef.current) observer?.observe(popupRef.current);
    if (anchorRef.current) observer?.observe(anchorRef.current);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      observer?.disconnect();
    };
  }, [open, anchorRef, popupRef, prefer, align]);
}
