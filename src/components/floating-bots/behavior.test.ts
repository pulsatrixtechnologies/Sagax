import { describe, expect, it } from "vitest";
import {
  blinkAt,
  MASCOT_MS,
  mascotFrameRate,
  mascotMotion,
  newMascotState,
  stepMascot,
  type MascotInput,
  type MascotOptions,
  type MascotState,
} from "./behavior";

/** A fixed sequence of "random" numbers, so every choice is known. */
function rolls(...values: number[]) {
  let at = 0;
  return () => values[at++ % values.length];
}

const desk = (extra: Partial<MascotOptions> = {}): MascotOptions => ({ reduced: false, flyAway: true, canMove: true, random: rolls(0.5), ...extra });

function run(state: MascotState, inputs: MascotInput[], options = desk()) {
  const effects: string[] = [];
  for (const input of inputs) {
    const step = stepMascot(state, input, options);
    state = step.state;
    effects.push(...step.effects.map((effect) => effect.type));
  }
  return { state, effects };
}

describe("mascot behavior: idle life", () => {
  it("rests idle, then picks a small action when its idle time comes", () => {
    const start = newMascotState(0);
    expect(start.activity).toBe("idle");
    expect(stepMascot(start, { type: "tick", now: 100 }, desk()).state.activity).toBe("idle");
    // 0.1 looks around, 0.4 spins, 0.7 hops
    expect(stepMascot(start, { type: "tick", now: start.nextIdle }, desk({ random: rolls(0.1) })).state.activity).toBe("look");
    expect(stepMascot(start, { type: "tick", now: start.nextIdle }, desk({ random: rolls(0.4) })).state.activity).toBe("spin");
    expect(stepMascot(start, { type: "tick", now: start.nextIdle }, desk({ random: rolls(0.7) })).state.activity).toBe("hop");
  });

  it("wanders along the desk only where it can move its window", () => {
    const start = newMascotState(0);
    const walk = stepMascot(start, { type: "tick", now: start.nextIdle }, desk({ random: rolls(0.9, 0.2, 0.5) }));
    expect(walk.state.activity).toBe("wander");
    expect(walk.state.facing).toBe(-1);
    expect(walk.effects).toEqual([{ type: "wander", dx: -120 }]);
    const arrived = stepMascot(walk.state, { type: "arrived", now: start.nextIdle + 1200 }, desk());
    expect(arrived.state.activity).toBe("idle");
    // the in-app overlay cannot move: it hops instead
    expect(stepMascot(start, { type: "tick", now: start.nextIdle }, desk({ canMove: false, random: rolls(0.9) })).state.activity).toBe("hop");
  });

  it("ends a timed action by itself and goes back to idle", () => {
    const spin = stepMascot(newMascotState(0), { type: "tick", now: MASCOT_MS.idleMin }, desk({ random: rolls(0.4) })).state;
    expect(spin.activity).toBe("spin");
    expect(stepMascot(spin, { type: "tick", now: spin.since + MASCOT_MS.spin - 1 }, desk()).state.activity).toBe("spin");
    const after = stepMascot(spin, { type: "tick", now: spin.since + MASCOT_MS.spin }, desk()).state;
    expect(after.activity).toBe("idle");
    expect(after.nextIdle).toBeGreaterThan(after.since);
  });

  it("naps after a long quiet and wakes up when played with", () => {
    const quiet = run(newMascotState(0), [{ type: "tick", now: MASCOT_MS.sleepAfter }]).state;
    expect(quiet.activity).toBe("sleep");
    expect(stepMascot(quiet, { type: "tick", now: MASCOT_MS.sleepAfter * 5 }, desk()).state.activity).toBe("sleep");
    const woken = stepMascot(quiet, { type: "play", now: MASCOT_MS.sleepAfter + 10 }, desk());
    expect(woken.state.activity).toBe("react");
    expect(woken.effects).toEqual([{ type: "hearts" }]);
  });

  it("only looks around under reduced motion: no spins, hops or walks", () => {
    const start = newMascotState(0);
    for (const roll of [0.1, 0.4, 0.7, 0.95]) {
      expect(stepMascot(start, { type: "tick", now: start.nextIdle }, desk({ reduced: true, random: rolls(roll) })).state.activity).toBe("look");
    }
  });
});

describe("mascot behavior: Tamagotchi reactions", () => {
  it("reacts to a click with a happy spin and hearts, and to a stroke by leaning in", () => {
    const played = stepMascot(newMascotState(0), { type: "play", now: 50 }, desk());
    expect(played.state).toMatchObject({ activity: "react", lastInteraction: 50, until: 50 + MASCOT_MS.react });
    expect(played.effects).toEqual([{ type: "hearts" }]);
    const petted = stepMascot(newMascotState(0), { type: "pet", now: 50 }, desk());
    expect(petted.state.activity).toBe("petted");
  });

  it("flaps while dragged, then lands with a hop; a drag halts a walk", () => {
    const walking = stepMascot(newMascotState(0), { type: "tick", now: MASCOT_MS.idleMin }, desk({ random: rolls(0.9, 0.9, 0.5) })).state;
    expect(walking.activity).toBe("wander");
    const grabbed = stepMascot(walking, { type: "drag", now: 5000, on: true }, desk());
    expect(grabbed.state.activity).toBe("drag");
    expect(grabbed.effects).toEqual([{ type: "halt" }]);
    expect(mascotMotion(grabbed.state, { now: 5100, pose: "idle", reduced: false, gaze: null }).wing).toBeGreaterThan(0.3);
    expect(stepMascot(grabbed.state, { type: "drag", now: 6000, on: false }, desk()).state.activity).toBe("hop");
  });
});

describe("mascot behavior: flying off while the bot works", () => {
  it("flies out, works away, flies back and celebrates", () => {
    let step = stepMascot(newMascotState(0), { type: "task", now: 10, task: "working" }, desk());
    expect(step.state).toMatchObject({ activity: "flyOut", away: true });
    expect(step.effects).toEqual([{ type: "flyOut" }]);
    // a click while away does nothing: the badge opens the thread instead
    expect(stepMascot(step.state, { type: "play", now: 20 }, desk()).state.activity).toBe("flyOut");
    step = stepMascot(step.state, { type: "arrived", now: 900 }, desk());
    expect(step.state).toMatchObject({ activity: "working", away: true });
    // no nap while working, however long it takes
    expect(stepMascot(step.state, { type: "tick", now: MASCOT_MS.sleepAfter * 3 }, desk()).state.activity).toBe("working");
    step = stepMascot(step.state, { type: "task", now: 60_000, task: "idle" }, desk());
    expect(step.state).toMatchObject({ activity: "return", away: true, returnAs: "celebrate" });
    expect(step.effects).toEqual([{ type: "flyHome" }]);
    step = stepMascot(step.state, { type: "arrived", now: 61_000 }, desk());
    expect(step.state).toMatchObject({ activity: "celebrate", away: false });
    expect(step.effects).toEqual([{ type: "sparkles" }]);
    expect(stepMascot(step.state, { type: "tick", now: 61_000 + MASCOT_MS.celebrate }, desk()).state.activity).toBe("idle");
  });

  it("comes back sad after an error", () => {
    const away = run(newMascotState(0), [
      { type: "task", now: 0, task: "working" },
      { type: "arrived", now: 900 },
      { type: "task", now: 5000, task: "error" },
    ]);
    expect(away.state).toMatchObject({ activity: "return", returnAs: "sad" });
    const home = stepMascot(away.state, { type: "arrived", now: 6000 }, desk()).state;
    expect(home).toMatchObject({ activity: "sad", away: false });
    expect(mascotMotion(home, { now: 6100, pose: "alert", reduced: false, gaze: null }).headPitch).toBeGreaterThan(0.3);
  });

  it("comes back for an approval, without a celebration", () => {
    const back = run(newMascotState(0), [
      { type: "task", now: 0, task: "working" },
      { type: "arrived", now: 900 },
      { type: "task", now: 5000, task: "waiting" },
      { type: "arrived", now: 6000 },
    ]);
    expect(back.state).toMatchObject({ activity: "idle", away: false, returnAs: null });
    expect(back.effects).toEqual(["flyOut", "flyHome"]);
  });

  it("lands anyway when a flight never reports back", () => {
    const out = stepMascot(newMascotState(0), { type: "task", now: 0, task: "working" }, desk()).state;
    expect(stepMascot(out, { type: "tick", now: MASCOT_MS.flight }, desk()).state.activity).toBe("working");
  });

  it("works in place when the toggle is off or motion is reduced", () => {
    for (const options of [desk({ flyAway: false }), desk({ reduced: true })]) {
      const working = stepMascot(newMascotState(0), { type: "task", now: 0, task: "working" }, options);
      expect(working.state).toMatchObject({ activity: "working", away: false });
      expect(working.effects).toEqual([]);
      // a click is still welcome while it works in place, and it goes back to working
      const played = stepMascot(working.state, { type: "play", now: 10 }, options).state;
      expect(played.activity).toBe("react");
      expect(stepMascot(played, { type: "tick", now: 10 + MASCOT_MS.react }, options).state.activity).toBe("working");
      const done = stepMascot(working.state, { type: "task", now: 100, task: "idle" }, options);
      expect(done.state.activity).toBe("celebrate");
      expect(stepMascot(working.state, { type: "task", now: 100, task: "error" }, options).state.activity).toBe("sad");
    }
  });

  it("ignores a task state it already has", () => {
    const state = newMascotState(0);
    expect(stepMascot(state, { type: "task", now: 5, task: "idle" }, desk())).toEqual({ state, effects: [] });
  });
});

describe("mascot motion", () => {
  const at = (activity: MascotState["activity"], elapsed: number, extra: Partial<Parameters<typeof mascotMotion>[1]> = {}) =>
    mascotMotion({ activity, since: 1000, facing: 1 }, { now: 1000 + elapsed, pose: "idle", reduced: false, gaze: null, ...extra });

  it("turns a full circle in a spin and lands back facing front", () => {
    expect(at("spin", 0).spin).toBeCloseTo(0);
    expect(at("spin", MASCOT_MS.spin / 2).spin).toBeCloseTo(Math.PI, 1);
    expect(at("spin", MASCOT_MS.spin).spin).toBeCloseTo(Math.PI * 2);
  });

  it("shuts its eyes asleep, follows the pointer awake", () => {
    expect(at("sleep", 500).lid).toBe(1);
    const looking = at("idle", 50, { gaze: { x: 1, y: 0 } });
    expect(looking.headYaw).toBeGreaterThan(0.5);
    expect(looking.pupilX).toBe(1);
  });

  it("rises and shrinks flying off, grows back coming home", () => {
    expect(at("flyOut", 900).scale).toBeLessThan(0.6);
    expect(at("flyOut", 900).y).toBeGreaterThan(1);
    expect(at("return", 1000).scale).toBeCloseTo(1);
    expect(at("flyOut", 900, { reduced: true }).y).toBeLessThan(0.1);
  });

  it("blinks briefly every few seconds", () => {
    expect(blinkAt(75)).toBeGreaterThan(0.9);
    expect(blinkAt(1000)).toBe(0);
  });

  it("draws fast while it moves, slowly at rest or asleep", () => {
    expect(mascotFrameRate("spin", false, false)).toBe(60);
    expect(mascotFrameRate("idle", false, false)).toBe(30);
    expect(mascotFrameRate("idle", true, false)).toBe(60);
    expect(mascotFrameRate("sleep", false, false)).toBeLessThan(20);
    expect(mascotFrameRate("spin", false, true)).toBeLessThanOrEqual(30);
  });
});
