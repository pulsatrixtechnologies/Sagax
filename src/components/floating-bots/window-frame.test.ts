import { describe, expect, it } from "vitest";
import { FLOAT_BODY, FLOAT_HOME } from "../../../electron/floating-bot-window.mjs";
import { mascotStage } from "./fit";
import { balloonReserve, chatHomeSize, createMoveCoalescer, dockedWindowSize, GROW_AHEAD, homeBody, nextWindowSize } from "./window-frame";

describe("the mascot window's size", () => {
  const mascot = { width: 156, height: 172 };

  it("fits the content exactly while no balloon is open, and asks nothing when it already fits", () => {
    expect(nextWindowSize({ content: mascot, current: null, reserve: null, exact: true })).toEqual(mascot);
    expect(nextWindowSize({ content: mascot, current: mascot, reserve: null, exact: true })).toBeNull();
    // the balloon closed: back down to the mascot
    expect(nextWindowSize({ content: mascot, current: { width: 500, height: 700 }, reserve: null, exact: true })).toEqual(mascot);
  });

  it("opens the balloon's room in one step and keeps it while a reply streams", () => {
    const reserve = { width: 500, height: 700 };
    const opened = nextWindowSize({ content: { width: 300, height: 260 }, current: mascot, reserve, exact: false });
    expect(opened).toEqual(reserve);
    // growing and shrinking content inside the room: no resize at all
    for (const height of [260, 380, 520, 690, 300]) {
      expect(nextWindowSize({ content: { width: 480, height }, current: reserve, reserve, exact: false })).toBeNull();
    }
  });

  it("grows past what is needed when the content outgrows the window, so the next frames need no resize", () => {
    const current = { width: 500, height: 700 };
    const next = nextWindowSize({ content: { width: 520, height: 650 }, current, reserve: current, exact: false });
    expect(next).toEqual({ width: 520 + GROW_AHEAD, height: 700 });
    expect(nextWindowSize({ content: { width: 600, height: 650 }, current: next, reserve: current, exact: false })).toBeNull();
  });

  it("fits again when a gesture ends, never smaller than the balloon's room", () => {
    const reserve = { width: 500, height: 700 };
    expect(nextWindowSize({ content: { width: 480, height: 600 }, current: { width: 1100, height: 1100 }, reserve, exact: true })).toEqual(reserve);
  });

  it("holds the quick chat's room so opening it does not resize the window", () => {
    const stage = mascotStage(120);
    const home = chatHomeSize(stage);
    // the character's corner is the window's: main opens at this size
    expect(home).toEqual(FLOAT_HOME);
    expect(dockedWindowSize(stage)).toEqual(home);
    expect(home.width).toBeGreaterThan(stage.width);
    expect(home.height).toBeGreaterThan(stage.height + 360);
    expect(nextWindowSize({ content: stage, current: home, reserve: home, exact: false })).toBeNull();
    // a short reply, and a size inside the home, stay put
    expect(nextWindowSize({ content: { width: home.width - 8, height: home.height - 8 }, current: home, reserve: dockedWindowSize(stage, { h: 200 }), exact: false })).toBeNull();
    const grown = dockedWindowSize(stage, { w: 640, h: 520, dx: -80, dy: -40 });
    expect(grown.width).toBeGreaterThan(home.width);
    expect(grown.height).toBeGreaterThan(home.height);
  });

  it("knows where the character stands in the home window, for each side the chat opens on", () => {
    const stage = mascotStage(120);
    const owl = { left: stage.left, top: stage.top, size: 120 };
    // main keeps this box on screen before the page reports it
    expect(homeBody(stage, owl, FLOAT_HOME)).toEqual(FLOAT_BODY);
    // the chat below and to the right: the character in the window's top-left corner
    expect(homeBody(stage, owl, FLOAT_HOME, { below: true, right: true })).toEqual({ x: 6 + stage.left, y: 8 + stage.top, width: 120, height: 120 });
    expect(homeBody(stage, owl, FLOAT_HOME, { below: false, right: true })).toMatchObject({ x: 6 + stage.left, y: FLOAT_BODY.y });
  });

  it("reserves the balloon's widest and tallest, its offset, the stage and the paddings", () => {
    const stage = { width: 150, height: 170 };
    const room = { w: 900, h: 540 };
    expect(balloonReserve({ stage, room, place: {}, maxWidth: 480 })).toEqual({ width: 480 + 4 + 12, height: 540 + 8 + 170 + 12 });
    // a size the person chose, moved away from the mascot
    expect(balloonReserve({ stage, room, place: { w: 600, h: 300, dx: -40, dy: -20 }, maxWidth: 480 })).toEqual({ width: 600 + 40 + 4 + 12, height: 300 + 20 + 8 + 170 + 12 });
    // never narrower than the mascot
    expect(balloonReserve({ stage: { width: 400, height: 170 }, room: { w: 280, h: 160 }, place: {}, maxWidth: 480 }).width).toBe(412);
  });
});

describe("moving the mascot by hand", () => {
  const frames = () => {
    const queue: Array<() => void> = [];
    return { schedule: (run: () => void) => void queue.push(run), tick: () => queue.splice(0).forEach((run) => run()) };
  };

  it("sends the moves of a frame as one", async () => {
    const sent: Array<[number, number]> = [];
    const clock = frames();
    const moves = createMoveCoalescer((dx, dy) => void sent.push([dx, dy]), clock.schedule);
    moves.add(3, 1);
    moves.add(4, -2);
    moves.add(0, 0);
    expect(sent).toEqual([]);
    clock.tick();
    expect(sent).toEqual([[7, -1]]);
    await moves.flush();
    expect(moves.sent).toBe(1);
  });

  it("keeps one request in flight and sends what came meanwhile after it, in one", async () => {
    const sent: Array<[number, number]> = [];
    const answers: Array<() => void> = [];
    const clock = frames();
    const moves = createMoveCoalescer((dx, dy) => {
      sent.push([dx, dy]);
      return new Promise<void>((done) => answers.push(done));
    }, clock.schedule);
    moves.add(5, 5);
    clock.tick();
    moves.add(1, 0);
    moves.add(1, 0);
    clock.tick();
    expect(sent).toEqual([[5, 5]]);
    let flushed = false;
    const all = moves.flush().then(() => {
      flushed = true;
    });
    answers.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    clock.tick();
    expect(sent).toEqual([[5, 5], [2, 0]]);
    expect(flushed).toBe(false);
    answers.shift()?.();
    await all;
    expect(flushed).toBe(true);
  });

  it("ignores moves that are not numbers and resolves a flush with nothing to send", async () => {
    const sent: unknown[] = [];
    const moves = createMoveCoalescer((dx, dy) => void sent.push([dx, dy]), () => undefined);
    moves.add(Number.NaN, 2);
    await moves.flush();
    expect(sent).toEqual([]);
  });
});

describe("the character's box the window reports to main", () => {
  const stage = mascotStage(120);
  const fakeRoot = (rect: { left: number; top: number; width: number; height: number }, attrs: { away?: boolean; fallback?: boolean } = {}) => {
    const stageEl = { getBoundingClientRect: () => rect, hasAttribute: (name: string) => name === "data-away" && Boolean(attrs.away) };
    return { querySelector: () => stageEl, hasAttribute: (name: string) => name === "data-fallback" && Boolean(attrs.fallback) } as unknown as HTMLElement;
  };

  it("is the character's own box in its stage, not the stage's empty room", async () => {
    const { bodyRectIn } = await import("./FloatingBotWindow");
    const rect = bodyRectIn(fakeRoot({ left: 127, top: 472, width: stage.width, height: stage.height }));
    expect(rect).toEqual({ x: 127 + stage.left, y: 472 + stage.top, width: 120, height: 120 });
  });

  it("is the parked badge while away, the plain owl's stage in the fallback, nothing before a layout", async () => {
    const { bodyRectIn } = await import("./FloatingBotWindow");
    expect(bodyRectIn(fakeRoot({ left: 4, top: 6, width: 52, height: 52 }, { away: true }))).toEqual({ x: 4, y: 6, width: 52, height: 52 });
    expect(bodyRectIn(fakeRoot({ left: 0, top: 0, width: 219, height: 240 }, { fallback: true }))).toEqual({ x: 0, y: 0, width: 219, height: 240 });
    expect(bodyRectIn(fakeRoot({ left: 0, top: 0, width: 0, height: 0 }))).toBeNull();
    expect(bodyRectIn(null)).toBeNull();
  });
});
