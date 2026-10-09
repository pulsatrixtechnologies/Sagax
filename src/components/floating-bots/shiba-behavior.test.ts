// The desktop Shiba's own life in the shared behavior machine: the wander
// (walk off, sniff, turn, walk back), the check-out of a spot it was dropped
// on, its own idle actions (and only for a dog), sitting still while its bot
// waits, and the moves a cue plays.
import { describe, expect, it } from "vitest";
import { newMascotState, stepMascot, type MascotEffect, type MascotOptions, type MascotState } from "./behavior";
import { IDLE_ACTIONS, idleWeights, newSchedulerMemory } from "./scheduler";

const rolls = (...values: number[]) => {
  let at = 0;
  return () => values[at++ % values.length];
};
const dog = (extra: Partial<MascotOptions> = {}): MascotOptions => ({ reduced: false, flyAway: true, canMove: true, random: rolls(0.5), dog: true, ...extra });
const roomy = (state: MascotState): MascotState => ({ ...state, room: { left: 400, right: 600 } });

/** Ends the current walk (the window arrived) or timed clip (its time passed), and collects the effects. */
function next(state: MascotState, now: number, options: MascotOptions): { state: MascotState; effects: MascotEffect[]; now: number } {
  if (state.activity === "walk") {
    const step = stepMascot(state, { type: "arrived", now }, options);
    return { ...step, now };
  }
  const later = Math.max(now + 10, state.until ?? now + 10);
  const step = stepMascot(state, { type: "tick", now: later }, options);
  return { ...step, now: later };
}

describe("the desktop Shiba", () => {
  it("wanders: walks off within its room, sniffs, turns, walks back the same distance, then rests", () => {
    const options = dog();
    const wander = IDLE_ACTIONS.find((action) => action.id === "wander")!;
    expect(wander.choice).toEqual({ kind: "move", style: "walk", trip: true });
    expect(wander.cooldown).toBeGreaterThanOrEqual(120_000);
    // force the wander: only it may be picked
    const memory = { ...newSchedulerMemory(), last: Object.fromEntries(IDLE_ACTIONS.filter((action) => action.id !== "wander").map((action) => [action.id, 0])) };
    let state: MascotState = { ...roomy(newMascotState(0)), memory };
    let step = stepMascot(state, { type: "tick", now: state.nextIdle }, options);
    expect(step.state.activity).toBe("walk");
    const out = step.effects.find((effect) => effect.type === "wander");
    expect(out).toMatchObject({ type: "wander", style: "walk" });
    const dx = (out as Extract<MascotEffect, { type: "wander" }>).dx;
    expect(Math.abs(dx)).toBeLessThanOrEqual(600 - 16);
    let now = state.nextIdle;
    state = step.state;
    const seen: string[] = [state.activity];
    let back: number | null = null;
    for (let i = 0; i < 6 && state.activity !== "idle"; i += 1) {
      const moved = next(state, now, options);
      state = moved.state;
      now = moved.now;
      seen.push(state.activity);
      const wanderBack = moved.effects.find((effect) => effect.type === "wander") as Extract<MascotEffect, { type: "wander" }> | undefined;
      if (wanderBack) back = wanderBack.dx;
    }
    expect(seen).toEqual(["walk", "sniff", "turn", "walk", "idle"]);
    expect(back).toBe(-dx);
  });

  it("checks out a spot it was dropped on, then comes back to it", () => {
    const options = dog();
    let state = roomy(newMascotState(0));
    state = stepMascot(state, { type: "drag", now: 100, on: true }, options).state;
    state = stepMascot(state, { type: "drag", now: 900, on: false }, options).state;
    expect(state.activity).toBe("land");
    expect(state.trip?.phase).toBe("settle");
    const step = next(state, 900, options);
    expect(step.state.activity).toBe("walk");
    const out = step.effects.find((effect) => effect.type === "wander") as Extract<MascotEffect, { type: "wander" }>;
    expect(Math.abs(out.dx)).toBeLessThanOrEqual(70);
    // not for the other characters, and not under reduced motion
    const owl = stepMascot(stepMascot(roomy(newMascotState(0)), { type: "drag", now: 100, on: true }, dog({ dog: false })).state, { type: "drag", now: 900, on: false }, dog({ dog: false })).state;
    expect(owl.trip).toBeNull();
    const calm = stepMascot(stepMascot(roomy(newMascotState(0)), { type: "drag", now: 100, on: true }, dog({ reduced: true })).state, { type: "drag", now: 900, on: false }, dog({ reduced: true })).state;
    expect(calm.trip).toBeNull();
  });

  it("drops a round trip as soon as something else takes over", () => {
    const options = dog();
    const memory = { ...newSchedulerMemory(), last: Object.fromEntries(IDLE_ACTIONS.filter((action) => action.id !== "wander").map((action) => [action.id, 0])) };
    const start: MascotState = { ...roomy(newMascotState(0)), memory };
    const walking = stepMascot(start, { type: "tick", now: start.nextIdle }, options).state;
    const dragged = stepMascot(walking, { type: "drag", now: start.nextIdle + 100, on: true }, options);
    expect(dragged.state.trip).toBeNull();
    expect(dragged.effects).toContainEqual({ type: "halt" });
  });

  it("has its own idle actions (wag, ear twitch, sniff, nap, circles, a rare bark), only as a dog", () => {
    const own = IDLE_ACTIONS.filter((action) => action.dog).map((action) => action.id);
    expect(own).toEqual(["wander", "wag", "earTwitch", "sniff", "lieDown", "turnCircles", "bark"]);
    const base = { liveliness: "normal" as const, mood: 0.6, reduced: false, canMove: true, random: Math.random };
    const weights = (isDog: boolean) => Object.fromEntries(idleWeights(newSchedulerMemory(), 0, { ...base, dog: isDog }).map((entry) => [entry.action.id, entry.weight]));
    for (const id of own) {
      expect(weights(false)[id], id).toBe(0);
      expect(weights(true)[id], id).toBeGreaterThan(0);
    }
    // the bark is the rarest
    expect(IDLE_ACTIONS.find((action) => action.id === "bark")!.cooldown).toBeGreaterThanOrEqual(120_000);
  });

  it("plays a cue's move by name, whatever it is doing in place", () => {
    const state = stepMascot(newMascotState(0), { type: "move", now: 10, clip: "bark" }, dog()).state;
    expect(state.activity).toBe("bark");
    expect(stepMascot(newMascotState(0), { type: "move", now: 10, clip: "turnCircles" }, dog()).state.activity).toBe("turnCircles");
  });
});
