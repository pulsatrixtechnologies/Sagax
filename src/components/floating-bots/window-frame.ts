// How the desktop mascot's window follows what it draws, without fighting it.
//
// A transparent window that is resized while its content changes shows the
// content cut, or the mascot jumping, for a frame or two each time (the
// window server draws the old surface at the new place). So while the
// balloon is open the window is sized once, for the room the balloon may
// take, and only ever grows, in steps with some room ahead; it fits the
// content exactly again only when the balloon closes or a gesture ends. The
// empty part is transparent and lets clicks through.
//
// Moves by hand are coalesced to one per frame, with one request in flight:
// the pointer may report 120 moves a second, the window moves at most once a
// frame and never queues stale moves behind the pointer.

export interface Size {
  width: number;
  height: number;
}

/** How far ahead of the content a growing window reaches, px: a few frames of growth without a resize. */
export const GROW_AHEAD = 120;

/**
 * The window size for this content. `exact` fits it (the balloon closed, or a
 * gesture ended); otherwise the window keeps its size while the content and
 * the reserved room fit, and grows past what is needed when they do not.
 * Null: no change to ask for.
 */
export function nextWindowSize({ content, current, reserve, exact }: { content: Size; current: Size | null; reserve: Size | null; exact: boolean }): Size | null {
  const want = {
    width: Math.ceil(Math.max(content.width, reserve?.width ?? 0)),
    height: Math.ceil(Math.max(content.height, reserve?.height ?? 0)),
  };
  if (exact || !current) return current && current.width === want.width && current.height === want.height ? null : want;
  const grow = (need: number, have: number, contentNeed: number) =>
    need <= have ? have : Math.max(need, Math.ceil(contentNeed) > have ? Math.ceil(contentNeed) + GROW_AHEAD : need);
  const next = { width: grow(want.width, current.width, content.width), height: grow(want.height, current.height, content.height) };
  return next.width === current.width && next.height === current.height ? null : next;
}

/**
 * The room the open balloon may take, as a window size: its widest and
 * tallest (a size the person chose, or the room it was given), its offset
 * from the mascot, the mascot's stage and the paddings around them.
 */
export function balloonReserve({ stage, room, place, maxWidth }: {
  stage: Size;
  room: { w: number; h: number };
  place: { w?: number; h?: number; dx?: number; dy?: number };
  maxWidth: number;
}): Size {
  const width = (place.w ?? Math.min(maxWidth, room.w)) + Math.abs(place.dx ?? 0) + 4;
  const height = (place.h ?? room.h) + Math.abs(place.dy ?? 0);
  // the root's padding (8 6 4) and the gap between the balloon and the stage (8)
  return { width: Math.ceil(Math.max(stage.width, width) + 12), height: Math.ceil(height + 8 + stage.height + 12) };
}

export interface MoveCoalescer {
  /** Add a move by hand; it reaches the window on the next frame. */
  add(dx: number, dy: number): void;
  /** Resolves once every move added so far has reached the window. */
  flush(): Promise<void>;
  /** Moves sent so far (for tests and measures). */
  readonly sent: number;
}

/**
 * Sums the moves of a frame and sends them as one, with one request in
 * flight: moves added meanwhile wait for it and go together.
 */
export function createMoveCoalescer(
  send: (dx: number, dy: number) => Promise<unknown> | void,
  schedule: (run: () => void) => void = (run) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(() => run()) : setTimeout(run, 16)),
): MoveCoalescer {
  let dx = 0;
  let dy = 0;
  let scheduled = false;
  let inFlight: Promise<unknown> | null = null;
  let sent = 0;
  const waiting: Array<() => void> = [];
  const settle = () => {
    if (dx || dy || scheduled || inFlight) return;
    for (const done of waiting.splice(0)) done();
  };
  const pump = () => {
    scheduled = false;
    if (inFlight || (!dx && !dy)) return settle();
    const x = dx;
    const y = dy;
    dx = 0;
    dy = 0;
    sent += 1;
    inFlight = Promise.resolve(send(x, y)).catch(() => undefined);
    void inFlight.then(() => {
      inFlight = null;
      if (dx || dy) kick();
      else settle();
    });
  };
  const kick = () => {
    if (scheduled) return;
    scheduled = true;
    schedule(pump);
  };
  return {
    add(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || (!x && !y)) return;
      dx += x;
      dy += y;
      if (!inFlight) kick();
    },
    flush() {
      return new Promise<void>((done) => {
        waiting.push(done);
        settle();
      });
    },
    get sent() {
      return sent;
    },
  };
}
