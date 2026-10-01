// The desktop mascot moving its own window: flying off to the nearest side of
// its screen while its bot works, back to the exact spot it left when the
// work is done, and short hops along the desk when idle. Main clamps every
// move to the displays' work areas, so the mascot can never get lost off
// screen (with several displays, "off screen" is simply the edge of its own).
// While it pilots, main does not save the spot: home stays where the person
// put it.
import type { FloatingGeometry, FloatingRect, FloatingWindowBridge } from "./protocol";

export interface Point {
  x: number;
  y: number;
}

/** How high the mascot climbs when it leaves, in px. */
const CLIMB = 140;

/** Where the window parks while its bot works: the nearest side of its own work area, a little higher. */
export function edgeTarget(bounds: FloatingRect, workArea: FloatingRect): Point & { side: "left" | "right" } {
  const center = bounds.x + bounds.width / 2;
  const side = center < workArea.x + workArea.width / 2 ? "left" : "right";
  return {
    side,
    x: side === "left" ? workArea.x : workArea.x + workArea.width - bounds.width,
    y: Math.max(workArea.y, Math.min(bounds.y - CLIMB, workArea.y + workArea.height - bounds.height)),
  };
}

/** Back home: the window's bottom-right corner (where the mascot stands) on the spot it left. */
export function homeTarget(home: { right: number; bottom: number }, bounds: FloatingRect): Point {
  return { x: home.right - bounds.width, y: home.bottom - bounds.height };
}

/** A short walk along the desk, kept on the window's own work area. */
export function wanderTarget(bounds: FloatingRect, workArea: FloatingRect, dx: number): Point {
  const x = Math.min(Math.max(bounds.x + dx, workArea.x), workArea.x + workArea.width - bounds.width);
  return { x, y: bounds.y };
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** A point along a flight from `from` to `to` at 0..1, lifted by `arc` px at the middle. */
export function flightPoint(from: Point, to: Point, t: number, arc = 0, hops = 0): Point {
  const p = ease(Math.min(1, Math.max(0, t)));
  const lift = hops > 0 ? Math.abs(Math.sin(t * Math.PI * hops)) * arc : Math.sin(p * Math.PI) * arc;
  return { x: Math.round(from.x + (to.x - from.x) * p), y: Math.round(from.y + (to.y - from.y) * p - lift) };
}

export interface FloatingPilot {
  /** The pointer relative to the window's center, in px; null when unknown. */
  cursor(): Promise<Point | null>;
  flyOut(): Promise<void>;
  /** Snap the parked badge to its side once the window has shrunk to it. */
  park(): Promise<void>;
  flyHome(): Promise<void>;
  wander(dx: number): Promise<void>;
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
  const fly = (from: Point, to: Point, ms: number, arc: number, hops = 0) =>
    new Promise<void>((resolve) => {
      const id = ++flight;
      const start = clock();
      const step = () => {
        if (id !== flight) return resolve();
        const t = Math.min(1, (clock() - start) / ms);
        const at = flightPoint(from, to, t, arc, hops);
        void moveTo(at.x, at.y)?.catch?.(() => undefined);
        if (t >= 1) resolve();
        else frame(step);
      };
      frame(step);
    });

  return {
    async cursor() {
      const g = await read();
      if (!g?.cursor) return null;
      return { x: g.cursor.x - (g.bounds.x + g.bounds.width / 2), y: g.cursor.y - (g.bounds.y + g.bounds.height * 0.6) };
    },
    async flyOut() {
      const g = await read();
      if (!g) return;
      // the spot to come back to is where the person left it, unless it is already away
      if (!home) home = { right: g.bounds.x + g.bounds.width, bottom: g.bounds.y + g.bounds.height };
      autopilot(true);
      const target = edgeTarget(g.bounds, g.workArea);
      side = target.side;
      await fly(g.bounds, target, 1100, 60);
    },
    async park() {
      const g = await read();
      if (!g) return;
      const x = side === "left" ? g.workArea.x : g.workArea.x + g.workArea.width - g.bounds.width;
      await moveTo(x, g.bounds.y)?.catch?.(() => undefined);
    },
    async flyHome() {
      const g = await read();
      if (!g || !home) {
        autopilot(false);
        return;
      }
      await fly(g.bounds, homeTarget(home, g.bounds), 1200, 70);
      home = null;
      autopilot(false);
    },
    async wander(dx: number) {
      if (home) return;
      const g = await read();
      if (!g) return;
      autopilot(true);
      await fly(g.bounds, wanderTarget(g.bounds, g.workArea, dx), 1200, 12, 2);
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
