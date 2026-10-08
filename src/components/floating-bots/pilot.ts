// The desktop mascot moving its own window: flying off to the nearest side of
// its screen while its bot works, back to the exact spot it left when the
// work is done, and short hops along the desk when idle. Main clamps every
// move so the character's own box stays on a display's work area (the
// window's transparent room may hang off), so the mascot can never get lost
// off screen (with several displays, "off screen" is simply the edge of its own).
// While it pilots, main does not save the spot: home stays where the person
// put it.
import type { FloatingGeometry, FloatingRect, FloatingWindowBridge } from "./protocol";

export interface Point {
  x: number;
  y: number;
}

/** How high the mascot climbs when it leaves, in px. */
const CLIMB = 140;

/**
 * The part of the window that must stay on screen: the character's box when
 * main reports it (the window's transparent room may hang off the edge),
 * else the whole window.
 */
const visible = (bounds: FloatingRect, body?: FloatingRect | null): FloatingRect => body ?? bounds;
/** The window's spot that puts that part at (x, y). */
const windowAt = (bounds: FloatingRect, part: FloatingRect, x: number, y: number): Point => ({ x: Math.round(x - (part.x - bounds.x)), y: Math.round(y - (part.y - bounds.y)) });

/** Where the window parks while its bot works: the character at the nearest side of its own work area, a little higher. */
export function edgeTarget(bounds: FloatingRect, workArea: FloatingRect, body?: FloatingRect | null): Point & { side: "left" | "right" } {
  const part = visible(bounds, body);
  const center = part.x + part.width / 2;
  const side = center < workArea.x + workArea.width / 2 ? "left" : "right";
  const x = side === "left" ? workArea.x : workArea.x + workArea.width - part.width;
  const y = Math.max(workArea.y, Math.min(part.y - CLIMB, workArea.y + workArea.height - part.height));
  return { side, ...windowAt(bounds, part, x, y) };
}

/** Back home: the window's bottom-right corner (where the mascot stands) on the spot it left. */
export function homeTarget(home: { right: number; bottom: number }, bounds: FloatingRect): Point {
  return { x: home.right - bounds.width, y: home.bottom - bounds.height };
}

/** A short walk along the desk, the character kept on its own work area. */
export function wanderTarget(bounds: FloatingRect, workArea: FloatingRect, dx: number, body?: FloatingRect | null): Point {
  const part = visible(bounds, body);
  const x = Math.min(Math.max(part.x + dx, workArea.x), workArea.x + workArea.width - part.width);
  return { x: Math.round(x - (part.x - bounds.x)), y: bounds.y };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** A point along a flight from `from` to `to` at 0..1, lifted by `arc` px at the middle. */
export function flightPoint(from: Point, to: Point, t: number, arc = 0, hops = 0, linear = false): Point {
  const k = Math.min(1, Math.max(0, t));
  const p = linear ? k : ease(k);
  const lift = hops > 0 ? Math.abs(Math.sin(t * Math.PI * hops)) * arc : Math.sin(p * Math.PI) * arc;
  return { x: Math.round(from.x + (to.x - from.x) * p), y: Math.round(from.y + (to.y - from.y) * p - lift) };
}

export interface FloatingPilot {
  /** The pointer relative to the window's center, in px; null when unknown. */
  cursor(): Promise<Point | null>;
  /** The pointer (as cursor()) and the free px left and right of the window on its screen. */
  sense(): Promise<{ cursor: Point | null; room: { left: number; right: number } | null; geometry?: FloatingGeometry | null }>;
  /** Where the window, the character and its display are now (null when main cannot say). */
  geometry(): Promise<FloatingGeometry | null>;
  /** Fly to the nearest screen edge over `ms` (a believable 1 to 2 s). */
  flyOut(ms?: number): Promise<void>;
  /** Snap the parked badge to its side once the window has shrunk to it. */
  park(): Promise<void>;
  flyHome(ms?: number): Promise<void>;
  /** Walk (small steps) or fly (an arc) dx px along the desk over ms. */
  wander(dx: number, ms?: number, style?: "walk" | "fly"): Promise<void>;
  /** Stop a wander in progress (the person grabbed the mascot). */
  halt(): void;
}

type Frame = (callback: (now: number) => void) => unknown;

/** A pilot for a desktop window, or null where the main process cannot move it for the mascot. */
export function createWindowPilot(
  bridge: FloatingWindowBridge | undefined,
  frame: Frame = (callback) => requestAnimationFrame(callback),
  clock: () => number = () => performance.now(),
): FloatingPilot | null {
  if (!bridge?.geometry || !bridge.moveTo || !bridge.autopilot) return null;
  const geometry = bridge.geometry.bind(bridge);
  const moveTo = bridge.moveTo.bind(bridge);
  const autopilot = bridge.autopilot.bind(bridge);
  let home: { right: number; bottom: number } | null = null;
  let side: "left" | "right" = "right";
  let flight = 0;

  const read = async (): Promise<FloatingGeometry | null> => {
    try {
      return await geometry();
    } catch {
      return null;
    }
  };

  /** Moves the window along a path; resolves when done or when another flight replaced it. */
  const fly = (from: Point, to: Point, ms: number, arc: number, hops = 0, linear = false) =>
    new Promise<void>((resolve) => {
      const id = ++flight;
      const start = clock();
      const step = () => {
        if (id !== flight) return resolve();
        const t = Math.min(1, (clock() - start) / ms);
        const at = flightPoint(from, to, t, arc, hops, linear);
        void moveTo(at.x, at.y)?.catch?.(() => undefined);
        if (t >= 1) resolve();
        else frame(step);
      };
      frame(step);
    });

  const pointer = (g: FloatingGeometry | null): Point | null =>
    g?.cursor ? { x: g.cursor.x - (g.bounds.x + g.bounds.width / 2), y: g.cursor.y - (g.bounds.y + g.bounds.height * 0.6) } : null;

  return {
    async cursor() {
      return pointer(await read());
    },
    geometry: read,
    async sense() {
      const g = await read();
      if (!g) return { cursor: null, room: null };
      const part = visible(g.bounds, g.body);
      return {
        cursor: pointer(g),
        room: { left: part.x - g.workArea.x, right: g.workArea.x + g.workArea.width - (part.x + part.width) },
        geometry: g,
      };
    },
    async flyOut(ms = 1400) {
      const g = await read();
      if (!g) return;
      // the spot to come back to is where the person left it, unless it is already away
      if (!home) home = { right: g.bounds.x + g.bounds.width, bottom: g.bounds.y + g.bounds.height };
      autopilot(true);
      const target = edgeTarget(g.bounds, g.workArea, g.body);
      side = target.side;
      // climb first, then across: the arc peaks early like a real take-off
      await fly(g.bounds, target, ms, 90);
    },
    async park() {
      const g = await read();
      if (!g) return;
      const part = visible(g.bounds, g.body);
      const x = side === "left" ? g.workArea.x : g.workArea.x + g.workArea.width - part.width;
      await moveTo(windowAt(g.bounds, part, x, part.y).x, g.bounds.y)?.catch?.(() => undefined);
    },
    async flyHome(ms = 1400) {
      const g = await read();
      if (!g || !home) {
        autopilot(false);
        return;
      }
      await fly(g.bounds, homeTarget(home, g.bounds), ms, 70);
      home = null;
      autopilot(false);
    },
    async wander(dx: number, ms = 1200, style: "walk" | "fly" = "walk") {
      if (home) return;
      const g = await read();
      if (!g) return;
      autopilot(true);
      const target = wanderTarget(g.bounds, g.workArea, dx, g.body);
      if (style === "fly") await fly(g.bounds, target, ms, Math.min(120, 40 + Math.abs(dx) * 0.25));
      // a waddle: steady pace, a tiny bounce per step (about 3 steps a second)
      else await fly(g.bounds, target, ms, 3, Math.max(1, Math.round((ms / 1000) * 3.2)), true);
      autopilot(false);
      // a halted or finished walk: where it stands now is its spot
      bridge.moved();
    },
    halt() {
      if (home) return;
      flight += 1;
      autopilot(false);
    },
  };
}
