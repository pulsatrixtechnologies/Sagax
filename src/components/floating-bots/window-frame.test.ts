import { describe, expect, it } from "vitest";
import { balloonReserve, createMoveCoalescer, GROW_AHEAD, nextWindowSize } from "./window-frame";

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
