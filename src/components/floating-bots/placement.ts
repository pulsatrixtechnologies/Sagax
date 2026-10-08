// Where things go around the desktop mascot, as pure rules (tested in
// placement.test.ts): which side of the character its chat opens on, how
// much room the chat may take on that display, and on which side the
// effects (reactions, signs, hearts) are drawn so they never cover it.
//
// The character may stand anywhere, right up to a screen's edge or corner
// (main keeps only its own box on screen, electron/floating-bot-window.mjs).
// Its window holds the chat's room on the side that has space, so the chat
// opens in place and is never cut by the screen's edge.

import { BALLOON_GAP } from "./Balloon";
import type { BalloonSide } from "./Balloon";
import { CHAT_BALLOON, type OwlBox, type Rect, type Size } from "./window-frame";
/** How far past the stage's side the docked balloon's edge lines up, px: the root's side padding. */
const BALLOON_OVERHANG = 6;
/** The chat never takes more than this share of its display's height. */
export const BALLOON_SCREEN_SHARE = 0.6;
/** The least room a chat is given, px (it scrolls inside). */
export const BALLOON_MIN_ROOM = { w: 280, h: 160 } as const;

/** A side must leave the quick chat this much more than its size to be chosen (a chat flush against an edge reads as cut). */
const NEED_SLACK = 24;

export { homeBody, ROOT_PAD, type OwlBox, type Rect } from "./window-frame";

export interface ChatPlacement {
  side: BalloonSide;
  /** The room the chat may take on its display, px (it scrolls past it). */
  room: { w: number; h: number };
  /** How far to slide the chat sideways so it stays on its display when the stage hangs off the edge, px. */
  shift: number;
}

/**
 * Which side the chat opens on, from where the character stands on its
 * display: above and to the left by default; below when the room above is
 * short and there is more below; to the right when the room to the left is
 * short and there is more to the right. The room is what that side leaves
 * on the same display, capped at 60 % of its height.
 */
export function placeChat({ body, workArea, stage, owl, need = { w: CHAT_BALLOON.w + NEED_SLACK, h: CHAT_BALLOON.h + NEED_SLACK }, force = {} }: {
  /** The character's box on the screen. */
  body: Rect;
  workArea: Rect;
  stage: Size;
  owl: OwlBox;
  need?: { w: number; h: number };
  /** A side imposed from outside (the window may not reach that way, see sideWithin). */
  force?: Partial<BalloonSide>;
}): ChatPlacement {
  const stageLeft = body.x - owl.left;
  const stageTop = body.y - owl.top;
  const stageRight = stageLeft + stage.width;
  const stageBottom = stageTop + stage.height;
  const areaRight = workArea.x + workArea.width;
  const areaBottom = workArea.y + workArea.height;
  // the chat's edge that lines up with the stage, kept on the display
  const leftEdge = Math.min(Math.max(stageLeft - BALLOON_OVERHANG, workArea.x), areaRight);
  const rightEdge = Math.max(Math.min(stageRight + BALLOON_OVERHANG, areaRight), workArea.x);
  const spaceAbove = Math.max(0, Math.min(stageTop, areaBottom) - BALLOON_GAP - workArea.y);
  const spaceBelow = Math.max(0, areaBottom - Math.max(stageBottom, workArea.y) - BALLOON_GAP);
  const spaceLeft = Math.max(0, rightEdge - workArea.x);
  const spaceRight = Math.max(0, areaRight - leftEdge);
  const below = force.below ?? (spaceAbove < need.h && spaceBelow > spaceAbove);
  const right = force.right ?? (spaceLeft < need.w && spaceRight > spaceLeft);
  const capH = Math.round(workArea.height * BALLOON_SCREEN_SHARE);
  return {
    side: { below, right },
    room: {
      w: Math.max(BALLOON_MIN_ROOM.w, Math.floor(right ? spaceRight : spaceLeft)),
      h: Math.max(BALLOON_MIN_ROOM.h, Math.floor(Math.min(capH, below ? spaceBelow : spaceAbove))),
    },
    shift: Math.round(right ? leftEdge - (stageLeft - BALLOON_OVERHANG) : rightEdge - (stageRight + BALLOON_OVERHANG)),
  };
}

export type EffectSide = "left" | "right" | "above";

/** How wide the lane beside the character is, px: inside the stage's own transparent margin. */
export const EFFECT_LANE = 46;

/**
 * Where the effects go: beside the character, never over it. On the side
 * away from the chat when it fits on the screen, else the other side, else
 * above its head (the stage's top room).
 */
export function effectSide({ body, workArea, lane = EFFECT_LANE, chatSide }: { body: Rect; workArea: Rect; lane?: number; chatSide?: BalloonSide | null }): EffectSide {
  const roomRight = workArea.x + workArea.width - (body.x + body.width);
  const roomLeft = body.x - workArea.x;
  const order: EffectSide[] = chatSide?.right ? ["left", "right"] : ["right", "left"];
  for (const side of order) if ((side === "right" ? roomRight : roomLeft) >= lane) return side;
  return "above";
}

/** The lane's box in the stage's coordinates, for a side. */
export function effectLane(side: EffectSide, owl: OwlBox, lane = EFFECT_LANE): Rect {
  if (side === "right") return { x: owl.left + owl.size + 2, y: owl.top, width: lane, height: owl.size };
  if (side === "left") return { x: owl.left - 2 - lane, y: owl.top, width: lane, height: owl.size };
  const height = Math.max(24, owl.top - 2);
  return { x: owl.left, y: owl.top - height - 2, width: owl.size, height };
}

/** How far the window may reach on each side (screen coordinates; absent: as far as it likes). Main sends it on macOS, next to a neighbouring display. */
export interface WindowLimits {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

/**
 * The chat's side, turned away from a limit the window would pass: next to
 * a neighbouring display (macOS undoes a window that reaches too far onto
 * one), the window's room must open the other way, so the character itself
 * can come right up to the seam.
 */
export function sideWithin({ side, body, homeBody: home, size, limits }: {
  side: BalloonSide;
  body: Rect;
  /** Where the character stands in a home window, for a side. */
  homeBody: (side: BalloonSide) => Rect;
  size: Size;
  limits?: WindowLimits | null;
}): Partial<BalloonSide> {
  if (!limits) return {};
  // `pinned`: the window touching a limit counts as stopped by it (main held the character there)
  const fits = (candidate: BalloonSide, pinned = 0) => {
    const box = home(candidate);
    const x = body.x - box.x;
    const y = body.y - box.y;
    return {
      x: (limits.left === undefined || x >= limits.left + pinned) && (limits.right === undefined || x + size.width <= limits.right - pinned),
      y: (limits.top === undefined || y >= limits.top + pinned) && (limits.bottom === undefined || y + size.height <= limits.bottom - pinned),
    };
  };
  const now = fits(side, 2);
  const force: Partial<BalloonSide> = {};
  if (!now.x && fits({ ...side, right: !side.right }).x) force.right = !side.right;
  if (!now.y && fits({ ...side, below: !side.below }).y) force.below = !side.below;
  return force;
}
