import { describe, expect, it, vi } from "vitest";
import { createWindowPilot, edgeTarget, flightPoint, homeTarget, wanderTarget } from "./pilot";
import type { FloatingGeometry, FloatingWindowBridge } from "./protocol";

const AREA = { x: 0, y: 25, width: 1440, height: 850 };

function fakeBridge(start = { x: 1200, y: 700, width: 156, height: 172 }) {
  let bounds = { ...start };
  const moves: { x: number; y: number }[] = [];
  const autopilot = vi.fn();
  const moved = vi.fn();
  const bridge = {
    moveBy: vi.fn(),
    moved,
    resize: vi.fn(),
    setInteractive: vi.fn(),
    setFocusable: vi.fn(),
    send: vi.fn(),
    ready: vi.fn(),
    onState: vi.fn(),
    autopilot,
    geometry: vi.fn(async (): Promise<FloatingGeometry> => ({ bounds: { ...bounds }, workArea: AREA, cursor: { x: 100, y: 100 } })),
    moveTo: vi.fn(async (x: number, y: number) => {
      bounds = { ...bounds, x, y };
      moves.push({ x, y });
      return { ...bounds };
    }),
  } satisfies FloatingWindowBridge;
  return { bridge, moves, autopilot, moved, resize: (width: number, height: number) => (bounds = { ...bounds, width, height }), bounds: () => bounds };
}

/** A clock and frame loop that jump ahead 100 ms per frame. */
function fastFrames() {
  let time = 0;
  return {
    frame: (callback: (now: number) => void) => setTimeout(() => callback((time += 100)), 0),
    clock: () => time,
  };
}

describe("mascot pilot: where the window goes", () => {
  it("parks on the nearest side of its own screen, a little higher", () => {
    expect(edgeTarget({ x: 1200, y: 700, width: 156, height: 172 }, AREA)).toEqual({ side: "right", x: 1440 - 156, y: 560 });
    expect(edgeTarget({ x: 100, y: 60, width: 156, height: 172 }, AREA)).toEqual({ side: "left", x: 0, y: 25 });
    // a second display to the right: its own edges
    const second = { x: 1440, y: 0, width: 1920, height: 1040 };
    expect(edgeTarget({ x: 3000, y: 500, width: 156, height: 172 }, second).x).toBe(1440 + 1920 - 156);
  });

  it("parks and walks with the character itself at the edge, its window's room hanging off", () => {
    const bounds = { x: 900, y: 300, width: 352, height: 716 };
    const body = { x: 900 + 177, y: 300 + 535, width: 120, height: 120 };
    const right = edgeTarget(bounds, AREA, body);
    expect(right.side).toBe("right");
    // the character's right side on the screen's edge
    expect(right.x + 177 + 120).toBe(AREA.x + AREA.width);
    const left = edgeTarget({ ...bounds, x: 100 }, AREA, { ...body, x: 100 + 177 });
    expect(left.x + 177).toBe(AREA.x);
    expect(left.x).toBeLessThan(AREA.x);
    // a walk stops with the character at the edge, not the window
    expect(wanderTarget({ ...bounds, x: 100 }, AREA, -5000, { ...body, x: 100 + 177 }).x + 177).toBe(AREA.x);
  });

  it("comes home to the corner it left, whatever its size now", () => {
    expect(homeTarget({ right: 1356, bottom: 872 }, { x: 0, y: 0, width: 52, height: 52 })).toEqual({ x: 1304, y: 820 });
  });

  it("wanders without leaving the work area", () => {
    expect(wanderTarget({ x: 1300, y: 600, width: 156, height: 172 }, AREA, 300).x).toBe(1440 - 156);
    expect(wanderTarget({ x: 20, y: 600, width: 156, height: 172 }, AREA, -300).x).toBe(0);
  });

  it("flies along an arc that starts and ends on its points", () => {
    const from = { x: 0, y: 500 };
    const to = { x: 400, y: 100 };
    expect(flightPoint(from, to, 0, 60)).toEqual(from);
    expect(flightPoint(from, to, 1, 60)).toEqual(to);
    expect(flightPoint(from, to, 0.5, 60).y).toBeLessThan(300);
  });
});

describe("mascot pilot: flying the window", () => {
  it("is only made where main can move the window for it", () => {
    expect(createWindowPilot(undefined)).toBeNull();
    const { bridge } = fakeBridge();
    const { geometry: _g, ...older } = bridge;
    expect(createWindowPilot(older as FloatingWindowBridge)).toBeNull();
  });

  it("flies to the edge under autopilot and back to the exact spot", async () => {
    const fake = fakeBridge();
    const { frame, clock } = fastFrames();
    const pilot = createWindowPilot(fake.bridge, frame, clock)!;
    await pilot.flyOut();
    expect(fake.autopilot).toHaveBeenLastCalledWith(true);
    expect(fake.bounds()).toMatchObject({ x: 1440 - 156, y: 560 });
    // shrunk to the badge, it snaps to its side
    fake.resize(52, 52);
    await pilot.park();
    expect(fake.bounds().x).toBe(1440 - 52);
    // grown back to the owl, home again: bottom-right corner where it was
    fake.resize(156, 172);
    await pilot.flyHome();
    expect(fake.bounds()).toMatchObject({ x: 1200, y: 700 });
    expect(fake.autopilot).toHaveBeenLastCalledWith(false);
    expect(fake.moved).not.toHaveBeenCalled();
  });

  it("wanders, then saves the new spot", async () => {
    const fake = fakeBridge({ x: 600, y: 700, width: 156, height: 172 });
    const { frame, clock } = fastFrames();
    const pilot = createWindowPilot(fake.bridge, frame, clock)!;
    await pilot.wander(-120);
    expect(fake.bounds().x).toBe(480);
    expect(fake.moved).toHaveBeenCalledTimes(1);
    expect(fake.autopilot.mock.calls).toEqual([[true], [false]]);
  });

  it("tells where the pointer is from the window's middle", async () => {
    const pilot = createWindowPilot(fakeBridge().bridge)!;
    expect(await pilot.cursor()).toEqual({ x: 100 - (1200 + 78), y: 100 - (700 + 172 * 0.6) });
  });
});
