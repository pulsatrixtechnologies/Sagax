import { describe, expect, it } from "vitest";
import {
  blinkAt,
  createFrameSmoother,
  MASCOT_MS,
  mascotFrameRate,
  mascotMotion,
  newMascotState,
  PLAY_POOL,
  stepMascot,
  type MascotEffect,
  type MascotInput,
  type MascotOptions,
  type MascotState,
} from "./behavior";
import { CLIP_MS, TAKEOFF_MS } from "./clips";
import { newSchedulerMemory, pickIdleAction, sleepAfterMs } from "./scheduler";

/** A fixed sequence of "random" numbers, so every choice is known. */
function rolls(...values: number[]) {
  let at = 0;
  return () => values[at++ % values.length];
}

const desk = (extra: Partial<MascotOptions> = {}): MascotOptions => ({ reduced: false, flyAway: true, canMove: true, random: rolls(0.5), ...extra });

function run(state: MascotState, inputs: MascotInput[], options = desk()) {
  const effects: MascotEffect[] = [];
  for (const input of inputs) {
    const step = stepMascot(state, input, options);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

/** Moves the clock past every timed clip until the owl rests again. */
function settle(state: MascotState, from: number, options = desk()) {
  let now = from;
  for (let i = 0; i < 20 && state.activity !== "idle"; i += 1) {
    now = Math.max(now + 50, state.until ?? now + 50);
    state = stepMascot(state, { type: "tick", now }, options).state;
  }
  return { state, now };
}

describe("mascot behavior: idle life", () => {
  it("rests idle, then picks a scheduled action when its idle time comes", () => {
    const start = newMascotState(0);
    expect(stepMascot(start, { type: "tick", now: 100 }, desk()).state.activity).toBe("idle");
    const busy = stepMascot(start, { type: "tick", now: start.nextIdle }, desk({ random: rolls(0.3) })).state;
    expect(busy.activity).not.toBe("idle");
    expect(busy.memory.previous).not.toBeNull();
  });

  it("ends a timed clip by itself and blends back to idle", () => {
    const start = newMascotState(0);
    const acting = stepMascot(start, { type: "tick", now: start.nextIdle }, desk({ random: rolls(0.01) })).state;
    const after = settle(acting, start.nextIdle).state;
    expect(after.activity).toBe("idle");
    expect(after.prev?.activity).toBeDefined();
  });

  it("yawns, then naps after a long quiet; a click wakes it with a stretch", () => {
    const quiet = stepMascot(newMascotState(0), { type: "tick", now: sleepAfterMs("normal", 0.6) }, desk()).state;
    expect(quiet.activity).toBe("yawn");
    const asleep = stepMascot(quiet, { type: "tick", now: quiet.until! }, desk()).state;
    expect(asleep.activity).toBe("sleep");
    expect(stepMascot(asleep, { type: "tick", now: asleep.since + 10 * 60_000 }, desk()).state.activity).toBe("sleep");
    expect(stepMascot(asleep, { type: "play", now: asleep.since + 1000 }, desk()).state.activity).toBe("wake");
  });

  it("turns its head all the way only rarely, never twice running, never when calm", () => {
    let memory = newSchedulerMemory();
    let spins = 0;
    let seed = 3;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let now = 0; now < 10 * 60_000; now += 4000) {
      const pick = pickIdleAction(memory, now, { liveliness: "lively", mood: 0.9, reduced: false, canMove: true, depth: true, random });
      memory = pick.memory;
      if (pick.action?.id === "headSpin") spins += 1;
    }
    expect(spins).toBeLessThanOrEqual(2);
    for (let roll = 0; roll < 1; roll += 0.01) {
      const pick = pickIdleAction(newSchedulerMemory(), 0, { liveliness: "calm", mood: 0.9, reduced: false, canMove: true, depth: true, random: () => roll });
      expect(pick.action?.id).not.toBe("headSpin");
    }
  });

  it("naps sooner when calm, later when lively", () => {
    expect(sleepAfterMs("calm", 0.6)).toBeLessThan(sleepAfterMs("normal", 0.6));
    expect(sleepAfterMs("lively", 0.6)).toBeGreaterThan(sleepAfterMs("normal", 0.6));
  });

  it("turns around in place only with real depth (a 3D model)", () => {
    let state = newMascotState(0);
    for (let roll = 0; roll < 1; roll += 0.01) {
      expect(["turn", "spin", "backflip", "headSpin", "lookBack"]).not.toContain(stepMascot(state, { type: "tick", now: state.nextIdle }, desk({ random: rolls(roll) })).state.activity);
    }
    state = { ...state, memory: { last: {}, previous: null } };
    for (let roll = 0; roll < 1; roll += 0.01) {
      const next = stepMascot(state, { type: "tick", now: state.nextIdle }, desk({ depth: true, random: rolls(roll) })).state;
      if (next.activity === "turn") {
        expect(next.facing).toBe(-1);
        return;
      }
    }
    throw new Error("the scheduler never turned");
  });
});

describe("mascot behavior: walking and short flights along the desk", () => {
  const walkOrFly = (room: { left: number; right: number }, style: "walk" | "fly") => {
    let state = stepMascot(newMascotState(0), { type: "room", now: 0, left: room.left, right: room.right }, desk()).state;
    for (let roll = 0; roll < 1; roll += 0.005) {
      const step = stepMascot(state, { type: "tick", now: state.nextIdle }, desk({ random: rolls(roll, 0.5, 0.5) }));
      if (step.state.activity === style) return step;
    }
    throw new Error(`never ${style}ed`);
  };

  it("walks toward the roomy side, facing it, and lands back to idle", () => {
    const step = walkOrFly({ left: 0, right: 900 }, "walk");
    expect(step.state.facing).toBe(1);
    const effect = step.effects[0];
    expect(effect).toMatchObject({ type: "wander", style: "walk" });
    expect(effect.type === "wander" && effect.dx).toBeGreaterThan(0);
    expect(stepMascot(step.state, { type: "arrived", now: 9000 }, desk()).state.activity).toBe("idle");
  });

  it("faces another way only when it walks or flies the other way", () => {
    const options = desk({ random: Math.random });
    let state = stepMascot(newMascotState(0), { type: "room", now: 0, left: 600, right: 600 }, options).state;
    let now = 0;
    for (let i = 0; i < 400; i += 1) {
      const before = state.facing;
      now += 250;
      const step = stepMascot(state, { type: "tick", now }, options);
      if (step.state.facing !== before) {
        expect(["walk", "fly"]).toContain(step.state.activity);
        const move = step.effects.find((effect) => effect.type === "wander");
        expect(move && move.type === "wander" && Math.sign(move.dx)).toBe(step.state.facing);
      }
      state = step.state;
      if (state.activity === "walk" || state.activity === "fly") state = stepMascot(state, { type: "arrived", now: now + 10 }, options).state;
    }
  });

  it("never walks into the screen edge", () => {
    const step = walkOrFly({ left: 700, right: 10 }, "walk");
    expect(step.state.facing).toBe(-1);
    const effect = step.effects[0];
    expect(effect.type === "wander" && effect.dx).toBeLessThan(0);
    expect(effect.type === "wander" && Math.abs(effect.dx)).toBeLessThanOrEqual(700);
  });

  it("flies with a take-off, then lands with a skid", () => {
    const step = walkOrFly({ left: 50, right: 2000 }, "fly");
    const effect = step.effects[0];
    expect(effect).toMatchObject({ type: "wander", style: "fly", delay: TAKEOFF_MS });
    const landed = stepMascot(step.state, { type: "arrived", now: 5000 }, desk()).state;
    expect(landed.activity).toBe("land");
  });

  it("stays put without a window to move (the in-app overlay) or between two edges", () => {
    const overlay = desk({ canMove: false });
    for (let roll = 0; roll < 1; roll += 0.01) {
      const next = stepMascot(newMascotState(0), { type: "tick", now: MASCOT_MS.idleMin }, { ...overlay, random: rolls(roll) }).state;
      expect(["walk", "fly"]).not.toContain(next.activity);
    }
  });
});

describe("mascot behavior: Tamagotchi reactions", () => {
  it("answers a click with a joyful emote and hearts, never the same twice in a row", () => {
    const first = stepMascot(newMascotState(0), { type: "play", now: 1000 }, desk({ random: rolls(0) }));
    expect(PLAY_POOL).toContain(first.state.activity);
    expect(first.effects).toEqual([{ type: "hearts" }]);
    const rested = settle(first.state, 1000).state;
    const second = stepMascot(rested, { type: "play", now: 20_000 }, desk({ random: rolls(0) })).state;
    expect(second.activity).not.toBe(first.state.activity);
  });

  it("gets cross after a flurry of clicks", () => {
    const flurry = run(newMascotState(0), [500, 1100, 1700, 2300].map((now) => ({ type: "play", now }) as MascotInput));
    expect(flurry.state.activity).toBe("angry");
  });

  it("hugs itself when stroked, and loves it when stroked again and again", () => {
    const petted = stepMascot(newMascotState(0), { type: "pet", now: 1000 }, desk());
    expect(petted.state.activity).toBe("petted");
    expect(petted.effects).toEqual([{ type: "hearts" }]);
    const again = run(petted.state, [{ type: "tick", now: 2900 }, { type: "pet", now: 3000 }, { type: "tick", now: 4900 }, { type: "pet", now: 5000 }]);
    expect(again.state.activity).toBe("love");
  });

  it("flaps while dragged, lands when dropped, and a drag halts a walk", () => {
    const grabbed = stepMascot({ ...newMascotState(0), activity: "walk" }, { type: "drag", now: 5000, on: true }, desk());
    expect(grabbed.state.activity).toBe("drag");
    expect(grabbed.effects).toEqual([{ type: "halt" }]);
    const frame = mascotMotion(grabbed.state, { now: 5400, pose: "idle", reduced: false, gaze: null });
    expect(frame.wing).toBeGreaterThan(0.3);
    expect(stepMascot(grabbed.state, { type: "drag", now: 6000, on: false }, desk()).state.activity).toBe("land");
  });

  it("jumps when the pointer rushes past, waves when it rests nearby, with cooldowns", () => {
    const start = newMascotState(0);
    const startled = stepMascot(start, { type: "cursor", now: 1000, distance: 100, speed: 4000 }, desk()).state;
    expect(startled.activity).toBe("startled");
    const rested = settle(startled, 1000).state;
    expect(stepMascot(rested, { type: "cursor", now: 5000, distance: 100, speed: 4000 }, desk()).state.activity).toBe("idle");
    const greet = run(rested, [
      { type: "cursor", now: 6000, distance: 120, speed: 5 },
      { type: "cursor", now: 7000, distance: 120, speed: 5 },
      { type: "cursor", now: 7600, distance: 120, speed: 5 },
    ]).state;
    expect(greet.activity).toBe("wave");
    // far away it notices nothing
    expect(stepMascot(start, { type: "cursor", now: 1000, distance: 900, speed: 9000 }, desk()).state.activity).toBe("idle");
  });
});

describe("mascot behavior: flying off while the bot works", () => {
  it("stretches, takes off toward the nearest edge, works away, flies back, lands and celebrates", () => {
    let state = stepMascot(newMascotState(0), { type: "room", now: 0, left: 50, right: 900 }, desk()).state;
    let step = stepMascot(state, { type: "task", now: 10, task: "working" }, desk());
    expect(step.state).toMatchObject({ activity: "flyOut", away: true, facing: -1 });
    expect(step.effects).toEqual([{ type: "flyOut", delay: TAKEOFF_MS }]);
    expect(stepMascot(step.state, { type: "play", now: 20 }, desk()).state.activity).toBe("flyOut");
    step = stepMascot(step.state, { type: "arrived", now: 1800 }, desk());
    expect(step.state).toMatchObject({ activity: "working", away: true });
    expect(stepMascot(step.state, { type: "tick", now: 10 * 60_000 }, desk()).state.activity).toBe("working");
    step = stepMascot(step.state, { type: "task", now: 60_000, task: "idle" }, desk());
    expect(step.state).toMatchObject({ activity: "return", returnAs: "celebrate", facing: 1 });
    expect(step.effects).toEqual([{ type: "flyHome" }]);
    state = stepMascot(step.state, { type: "arrived", now: 61_500 }, desk()).state;
    expect(state).toMatchObject({ activity: "land", away: false, after: "celebrate" });
    state = stepMascot(state, { type: "tick", now: state.until! }, desk()).state;
    expect(state.activity).toBe("celebrate");
  });

  it("comes back sad after an error, and straight back for an approval", () => {
    const away = run(newMascotState(0), [{ type: "task", now: 0, task: "working" }, { type: "arrived", now: 1800 }]).state;
    const sad = run(away, [{ type: "task", now: 5000, task: "error" }, { type: "arrived", now: 6500 }]).state;
    expect(sad.after).toBe("sad");
    expect(stepMascot(sad, { type: "tick", now: sad.until! }, desk()).state.activity).toBe("sad");
    const approval = run(away, [{ type: "task", now: 5000, task: "waiting" }, { type: "arrived", now: 6500 }]).state;
    expect(approval).toMatchObject({ activity: "land", after: null, away: false });
  });

  it("lands anyway when a flight never reports back", () => {
    const out = stepMascot(newMascotState(0), { type: "task", now: 0, task: "working" }, desk()).state;
    expect(stepMascot(out, { type: "tick", now: MASCOT_MS.flight }, desk()).state.activity).toBe("working");
  });

  it("works in place when the toggle is off or motion is reduced", () => {
    for (const options of [desk({ flyAway: false }), desk({ reduced: true })]) {
      const working = stepMascot(newMascotState(0), { type: "task", now: 0, task: "working" }, options);
      expect(working.state).toMatchObject({ activity: "working", away: false });
      expect(stepMascot(working.state, { type: "task", now: 1000, task: "idle" }, options).state.activity).toBe("celebrate");
      expect(stepMascot(working.state, { type: "task", now: 1000, task: "error" }, options).state.activity).toBe("sad");
    }
  });
});

describe("mascot motion", () => {
  const at = (activity: MascotState["activity"], elapsed: number, extra: Partial<Parameters<typeof mascotMotion>[1]> = {}) =>
    mascotMotion({ activity, since: 1000, facing: 1, moveMs: 2000 }, { now: 1000 + elapsed, pose: "idle", reduced: false, gaze: null, ...extra });

  it("turns a full circle in a spin, and a full backward turn in a backflip", () => {
    expect(at("spin", CLIP_MS.spin).spin).toBeCloseTo(Math.PI * 2);
    expect(at("backflip", CLIP_MS.backflip).flip).toBeCloseTo(-Math.PI * 2);
  });

  it("opens its wings, covers its eyes, waves, hoots", () => {
    expect(at("stretch", CLIP_MS.stretch / 2).wing).toBeGreaterThan(0.9);
    expect(at("shy", 300).wingSwing).toBeLessThan(-0.5);
    expect(at("wave", CLIP_MS.wave / 2).wing).toBeGreaterThan(0.5);
    expect(at("hoot", 250).beak).toBeGreaterThan(0.3);
  });

  it("flaps the whole flight, pitched forward, and crouches before taking off", () => {
    expect(at("fly", 300).squash).toBeLessThan(0.95);
    const wings = [600, 700, 800, 900, 1000].map((ms) => at("fly", ms).wing);
    expect(Math.max(...wings) - Math.min(...wings)).toBeGreaterThan(0.3);
    expect(at("flyOut", 900).lean).toBeGreaterThan(0.2);
  });

  it("waddles with alternate feet", () => {
    const steps = [0, 100, 200, 300, 400, 500, 600, 700].map((ms) => at("walk", 200 + ms));
    expect(steps.some((frame) => (frame.footNear ?? 0) > 0.3)).toBe(true);
    expect(steps.some((frame) => (frame.footFar ?? 0) > 0.3)).toBe(true);
  });

  it("shuts its eyes asleep, follows the pointer awake", () => {
    expect(at("sleep", 500).lid).toBe(1);
    const looking = at("idle", 50, { gaze: { x: 1, y: 0 } });
    expect(looking.headYaw).toBeGreaterThan(0.5);
  });

  it("cross-fades from the previous clip instead of popping", () => {
    const state = { activity: "idle" as const, since: 1000, facing: 1 as const, prev: { activity: "stretch" as const, since: 0, facing: 1 as const, variant: 0, moveMs: 0 } };
    const start = mascotMotion(state, { now: 1000, pose: "idle", reduced: false, gaze: null });
    const end = mascotMotion(state, { now: 1000 + MASCOT_MS.blend, pose: "idle", reduced: false, gaze: null });
    expect(start.wing).toBeGreaterThan(0.8);
    expect(end.wing).toBeLessThan(0.1);
  });

  it("blinks briefly every few seconds", () => {
    expect(blinkAt(75)).toBeGreaterThan(0.9);
    expect(blinkAt(1000)).toBe(0);
  });

  it("draws fast while it moves, slowly at rest or asleep", () => {
    expect(mascotFrameRate("spin", false, false)).toBe(60);
    expect(mascotFrameRate("idle", false, false)).toBe(30);
    expect(mascotFrameRate("sleep", false, false)).toBeLessThan(20);
  });
});

describe("mascot behavior: no seizures", () => {
  it("stays calm under noisy pointer input: few clip changes, bounded turning speed", () => {
    const options = desk({ random: Math.random });
    let state = newMascotState(0);
    const smooth = createFrameSmoother();
    let changes = 0;
    let previous = state.activity;
    let last: ReturnType<typeof mascotMotion> | null = null;
    let fastest = 0;
    // 5 s of a pointer jittering over the owl every frame: hover strokes, rushes, rests, clicks
    for (let frame = 0; frame < 300; frame += 1) {
      const now = 1000 + frame * 16.7;
      const inputs: MascotInput[] = [
        { type: "cursor", now, distance: frame % 2 ? 30 : 400, speed: frame % 3 ? 5000 : 0 },
        { type: "pet", now },
        { type: "tick", now },
      ];
      if (frame % 7 === 0) inputs.push({ type: "play", now });
      for (const input of inputs) state = stepMascot(state, input, options).state;
      if (state.activity !== previous) {
        changes += 1;
        previous = state.activity;
      }
      const shown = smooth(mascotMotion(state, { now, pose: "idle", reduced: false, gaze: { x: frame % 2 ? 1 : -1, y: frame % 2 ? -1 : 1 } }), now);
      if (last) {
        for (const key of ["headYaw", "headTilt", "sway"] as const) fastest = Math.max(fastest, Math.abs(shown[key] - last[key]) / 0.0167);
      }
      last = shown;
    }
    expect(changes / 5).toBeLessThanOrEqual(3);
    // eased head and eyes: no frame-to-frame snapping even when the pointer jumps every frame
    expect(fastest).toBeLessThan(15);
  });

  it("never wiggles faster than about 4 Hz", () => {
    // sample every clip's parts at 240 Hz and count direction changes per second
    const clips = Object.keys(CLIP_MS).concat(["drag", "walk", "fly", "working", "sleep"]) as MascotState["activity"][];
    for (const clip of clips) {
      const length = (CLIP_MS as Record<string, number>)[clip] ?? 2000;
      for (const key of ["sway", "x", "squash", "headYaw", "headTilt", "wing", "puff"] as const) {
        let flips = 0;
        let lastDelta = 0;
        let lastValue: number | null = null;
        for (let ms = 0; ms <= length; ms += 1000 / 240) {
          const value = mascotMotion({ activity: clip, since: 0, facing: 1, moveMs: 2000 }, { now: ms + 10_000, pose: "idle", reduced: false, gaze: null })[key] ?? 0;
          if (lastValue !== null) {
            const delta = value - lastValue;
            if (Math.abs(delta) > 1e-4 && lastDelta && Math.sign(delta) !== Math.sign(lastDelta)) flips += 1;
            if (Math.abs(delta) > 1e-4) lastDelta = delta;
          }
          lastValue = value;
        }
        // two direction changes per cycle
        expect(flips / 2 / (length / 1000), `${clip}.${key}`).toBeLessThanOrEqual(4.2);
      }
    }
  });
});
