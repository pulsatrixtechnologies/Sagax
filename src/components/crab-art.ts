// Crab, the pixel-rect mascot (CrabMascot.tsx): only axis-aligned rectangles.
// Idle sprite is Anthropic's Clawd-Still (claude.ai/images/clawd/core/Clawd-Still.png):
// a 24 x 16 cell grid at 50 px/cell, mapped into the 0..100 box. Two 2x2 square
// eyes, stub 4x4 arms, four 2x4 legs flush with the body, no pincers, no feet
// pads, no shine. Motion lives on groups (crab-moves.ts) and in CSS
// (crab-mascot.css); no paths, no curves, no GSAP. Codrops walking/flag/gym/
// confetti timings feed the rig. Fill #DD775B matches that article.
import { mixColor } from "./shiba-art";

export const CRAB_CORAL = "#DD775B";
export const CRAB_INK = "#111111";
export const CRAB_SHINE = "#F8F4EE";
export const CRAB_SPARK = "#FBF236";
export const CRAB_PX = 4;
export const CRAB_GRID_W = 24;
export const CRAB_GRID_H = 16;
/** @deprecated width of the still; prefer CRAB_GRID_W. */
export const CRAB_GRID = CRAB_GRID_W;
export const CRAB_OX = (100 - CRAB_GRID_W * CRAB_PX) / 2;
export const CRAB_OY = 100 - CRAB_GRID_H * CRAB_PX;

export type CrabRect = { x: number; y: number; w: number; h: number };

export function cell(x: number, y: number, w: number, h: number): CrabRect {
  return { x: CRAB_OX + x * CRAB_PX, y: CRAB_OY + y * CRAB_PX, w: w * CRAB_PX, h: h * CRAB_PX };
}

/** Idle sprite in grid cells (Clawd-Still 24x16). */
export const CRAB_PARTS = {
  body: cell(4, 0, 16, 12),
  armL: cell(0, 4, 4, 4),
  armR: cell(20, 4, 4, 4),
  legs: [cell(4, 12, 2, 4), cell(8, 12, 2, 4), cell(14, 12, 2, 4), cell(18, 12, 2, 4)] as const,
  eyeL: cell(6, 2, 2, 2),
  eyeR: cell(16, 2, 2, 2),
  sparkles: [cell(5, 0, 1, 1), cell(12, 0, 1, 1), cell(18, 0, 1, 1)] as const,
} as const;

export const CRAB_PIVOTS = {
  ground: [50, CRAB_OY + CRAB_GRID_H * CRAB_PX] as const,
  body: [CRAB_PARTS.body.x + CRAB_PARTS.body.w / 2, CRAB_PARTS.body.y + CRAB_PARTS.body.h / 2] as const,
  armL: [CRAB_PARTS.armL.x + CRAB_PARTS.armL.w, CRAB_PARTS.armL.y] as const,
  armR: [CRAB_PARTS.armR.x, CRAB_PARTS.armR.y] as const,
  legs: CRAB_PARTS.legs.map((leg) => [leg.x + leg.w / 2, leg.y] as const),
  eyes: [(CRAB_PARTS.eyeL.x + CRAB_PARTS.eyeR.x + CRAB_PARTS.eyeR.w) / 2, CRAB_PARTS.eyeL.y + CRAB_PARTS.eyeL.h / 2] as const,
  eyeL: [CRAB_PARTS.eyeL.x + CRAB_PARTS.eyeL.w / 2, CRAB_PARTS.eyeL.y + CRAB_PARTS.eyeL.h / 2] as const,
  eyeR: [CRAB_PARTS.eyeR.x + CRAB_PARTS.eyeR.w / 2, CRAB_PARTS.eyeR.y + CRAB_PARTS.eyeR.h / 2] as const,
} as const;

/** Bust crop under 48 px: the body, arms and eyes, the legs off-frame. */
export const CRAB_BUST = { x: 0, y: CRAB_PARTS.body.y - 4, w: 100, h: CRAB_PARTS.body.h + 8 } as const;
export const CRAB_BUST_MAX = 48;

export function crabViewBox(size: number): string {
  return size <= CRAB_BUST_MAX ? `${CRAB_BUST.x} ${CRAB_BUST.y} ${CRAB_BUST.w} ${CRAB_BUST.h}` : "0 0 100 100";
}

/** Plain takes 45 % of the bot colour into the coral so it still reads as the pixel crab. */
export function crabFill(hex: string, amount = 0.45): string {
  return mixColor(CRAB_CORAL, hex, amount);
}

export function crabOrigin(point: readonly [number, number]): string {
  return `${point[0]}px ${point[1]}px`;
}

export interface CrabEyeDraw {
  pupils: readonly [CrabRect, CrabRect];
  shines: readonly [CrabRect, CrabRect] | null;
}

/** Official still is 2x2 solid squares. Happy is a lower 2x1 squint (flag waver).
 *  Sleepy is a higher lid. Asleep is closed: a 4x1 dash on the eye's lower
 *  row, wider than the eye so it never reads as a squint or a blink.
 *  Open faces have no shine. */
export function crabEyeDraw(face: string | null | undefined): CrabEyeDraw {
  switch (face) {
    case "asleep":
      return { pupils: [cell(5, 3, 4, 1), cell(15, 3, 4, 1)], shines: null };
    case "happy":
    case "laughing":
    case "proud":
      return { pupils: [cell(6, 3, 2, 1), cell(16, 3, 2, 1)], shines: null };
    case "sleepy":
    case "bored":
      return { pupils: [cell(6, 2, 2, 1), cell(16, 2, 2, 1)], shines: null };
    default:
      return { pupils: [CRAB_PARTS.eyeL, CRAB_PARTS.eyeR], shines: null };
  }
}

/** Rects in the idle drawing (body, arms, legs, eyes, sparkles). Clip and skins extra. */
export const CRAB_IDLE_RECTS = 12;
/** The ground clipPath's own <rect>, counted by markup tests. */
export const CRAB_CLIP_RECTS = 1;
