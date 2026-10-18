// Where an anchored popover goes on screen (JC, 2026-10-18): the quick
// reaction pill, the "…" menu and the full reaction picker beside a chat
// message. They are drawn in a portal on document.body with fixed
// coordinates, so no scrolling transcript or other container with an
// overflow can cut them; this decides the coordinates.
//
// - Vertically: on the preferred side of the anchor (below for the pill and
//   the menu, above for the picker) when it fits in the window, else on the
//   other side when that fits, else on the side with more room, pushed back
//   inside the window and, when even the window is too short, given a
//   maximum height (the popover then scrolls inside).
// - Horizontally: one edge lined up with the same edge of the anchor (the
//   message's side), then slid back inside the window at either border.

export type PopoverBox = { left: number; top: number; right: number; bottom: number };
export type PopoverSize = { width: number; height: number };

export type PopoverPlacement = {
  left: number;
  top: number;
  side: "above" | "below";
  /** Set only when the window is shorter than the popover. */
  maxHeight?: number;
};

/** Space kept between the popover and its anchor. */
export const POPOVER_GAP = 4;
/** Space kept between the popover and the window's borders. */
export const POPOVER_EDGE = 8;

export function placePopover(
  anchor: PopoverBox,
  popup: PopoverSize,
  view: PopoverSize,
  { prefer = "below", edge = "left", gap = POPOVER_GAP, margin = POPOVER_EDGE }: {
    prefer?: "above" | "below";
    /** Which edge of the popover lines up with the same edge of the anchor. */
    edge?: "left" | "right";
    gap?: number;
    margin?: number;
  } = {},
): PopoverPlacement {
  const roomBelow = view.height - margin - (anchor.bottom + gap);
  const roomAbove = anchor.top - gap - margin;
  const fits = (side: "above" | "below") => popup.height <= (side === "below" ? roomBelow : roomAbove);
  const other = prefer === "below" ? "above" : "below";
  const side = fits(prefer) ? prefer : fits(other) ? other : roomBelow >= roomAbove ? "below" : "above";

  const usable = Math.max(0, view.height - 2 * margin);
  const tooTall = popup.height > usable;
  const height = tooTall ? usable : popup.height;
  const wanted = side === "below" ? anchor.bottom + gap : anchor.top - gap - height;
  const top = Math.max(margin, Math.min(wanted, view.height - margin - height));

  const lined = edge === "left" ? anchor.left : anchor.right - popup.width;
  const maxLeft = Math.max(margin, view.width - margin - popup.width);
  const left = Math.max(margin, Math.min(lined, maxLeft));

  return tooTall ? { left, top, side, maxHeight: usable } : { left, top, side };
}
