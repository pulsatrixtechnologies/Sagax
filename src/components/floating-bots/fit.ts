// How big a floating mascot's stage (and so its transparent window) must be
// so no pose is ever cut off: a backflip or a spin swings the owl's box
// around its pivot, spread wings reach past its sides, a jump lifts it. The
// stage is that big; the owl stays centered in it and the WINDOW moves
// (pilot.ts) when it travels. The margin is transparent and lets clicks
// through (only the owl's painted pixels take the pointer).

/** Where the owl turns and flips, as a fraction of its box (owl-art's own pivot, near the hips). */
export const PIVOT = { x: 0.5, y: 0.62 } as const;
/** The largest reach of a spread wing past the box's side, as a fraction of the box. */
export const WING_REACH = 0.36;
/** The highest a clip lifts the owl (a backflip), as a fraction of the box. */
export const MAX_LIFT = 0.3;

export interface MascotStage {
  width: number;
  height: number;
  /** Where the owl's box sits in the stage. */
  left: number;
  top: number;
}

/** The stage for an owl box of `size` px, with `margin` px to spare all round. */
export function mascotStage(size: number, margin = 6): MascotStage {
  // the farthest a box corner gets from the pivot while it turns over
  const corner = Math.hypot(Math.max(PIVOT.x, 1 - PIVOT.x), Math.max(PIVOT.y, 1 - PIVOT.y)) * size;
  const side = Math.max(corner, (0.5 + WING_REACH) * size);
  const lift = MAX_LIFT * size;
  const width = Math.ceil(2 * side + 2 * margin);
  const height = Math.ceil(corner + lift + Math.max(corner, (1 - PIVOT.y) * size) + 2 * margin);
  return {
    width,
    height,
    left: Math.round(width / 2 - PIVOT.x * size),
    top: Math.round(margin + lift + corner - PIVOT.y * size),
  };
}

/** Whether a point (px, relative to the owl's box pivot) stays inside the stage. */
export function insideStage(stage: MascotStage, size: number, point: { x: number; y: number }): boolean {
  const x = stage.left + PIVOT.x * size + point.x;
  const y = stage.top + PIVOT.y * size + point.y;
  return x >= 0 && y >= 0 && x <= stage.width && y <= stage.height;
}
