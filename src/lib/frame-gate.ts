/**
 * Frame pacing for requestAnimationFrame loops that may draw slower than
 * the display on purpose (a desktop mascot at rest, asleep, or behind an open
 * balloon). The loops are all time based, so skipping a frame never changes
 * where anything is, only how often it is drawn.
 *
 * `DISPLAY_RATE` (Infinity) means every display frame: 120 Hz on ProMotion,
 * 90 Hz, 144 Hz, whatever the screen runs at. A finite rate keeps to a grid
 * of `1000 / fps` ms, drawing up to 4 ms (at most a quarter of the budget)
 * early to absorb vsync jitter, so it never aliases
 * down: 60 fps on a 90 Hz screen draws two frames in three (the old
 * `now - last < 1000 / 60 - 3` test drew one in two, 45 fps), and on a 120 Hz
 * screen exactly every other frame.
 */
export const DISPLAY_RATE = Number.POSITIVE_INFINITY;

/** A gate for one loop: call it with the rAF timestamp and the wanted rate;
 * true means draw this frame. */
export function createFrameGate(): (now: number, fps: number) => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return (now, fps) => {
    if (!(fps < DISPLAY_RATE)) {
      last = now;
      return true;
    }
    const budget = 1000 / Math.max(1, fps);
    const elapsed = now - last;
    if (elapsed < budget - Math.min(budget * 0.25, 4)) return false;
    // stay on the grid when on time, start afresh after a stall
    last = elapsed < budget * 2 ? last + budget : now;
    return true;
  };
}
