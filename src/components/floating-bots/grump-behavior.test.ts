// The desktop Grump's own life in the shared behavior machine: the prowl
// (stalk low to a spot within its room and loaf there), its own idle actions
// (and only for a cat), what each clip and pose keeps it doing, and the
// moves the desktop's events play on it.
import { describe, expect, it } from "vitest";
import { CAT_STALK_PACE, newMascotState, stepMascot, type MascotEffect, type MascotOptions, type MascotState } from "./behavior";
import { CLIP_MS } from "./clips";
import { cueClipFor, GRUMP_CUES, GRUMP_MENU_MOVES, grumpHeldFor, mascotFor } from "./mascots";
import { IDLE_ACTIONS, idleWeights, moveDuration, newSchedulerMemory } from "./scheduler";
import { GRUMP_MOVE_TIMING, grumpMoveFor } from "../grump-moves";

const rolls = (...values: number[]) => {
  let at = 0;
  return () => values[at++ % values.length];
};
const cat = (extra: Partial<MascotOptions> = {}): MascotOptions => ({ reduced: false, flyAway: true, canMove: true, random: rolls(0.5), cat: true, ...extra });
const roomy = (state: MascotState): MascotState => ({ ...state, room: { left: 400, right: 600 } });
/** Only the prowl may be picked. */
const prowlOnly = () => ({ ...newSchedulerMemory(), last: Object.fromEntries(IDLE_ACTIONS.filter((action) => action.id !== "prowl").map((action) => [action.id, 0])) });

describe("the desktop Grump", () => {
  it("prowls every few minutes: stalks slowly to a spot within its room, then loafs there and stays", () => {
    const options = cat();
    const prowl = IDLE_ACTIONS.find((action) => action.id === "prowl")!;
    expect(prowl.choice).toEqual({ kind: "move", style: "walk", trip: true });
    expect(prowl.cooldown).toBeGreaterThanOrEqual(120_000);
    const state: MascotState = { ...roomy(newMascotState(0)), memory: prowlOnly() };
    const step = stepMascot(state, { type: "tick", now: state.nextIdle }, options);
    expect(step.state.activity).toBe("walk");
    expect(step.state.trip).toEqual({ phase: "stalk", back: 0 });
    const out = step.effects.find((effect) => effect.type === "wander") as Extract<MascotEffect, { type: "wander" }>;
    expect(out).toMatchObject({ type: "wander", style: "walk" });
    // never past its room (the screen edge, the chat's side)
    expect(Math.abs(out.dx)).toBeLessThanOrEqual(600);
    // slower than a plain walk of the same distance
    expect(out.ms).toBeGreaterThanOrEqual(Math.round(moveDuration("walk", Math.abs(out.dx), 0) * CAT_STALK_PACE) - 1);
    // the window arrived: it loafs on the spot, with no walk back
    const arrived = stepMascot(step.state, { type: "arrived", now: state.nextIdle + out.ms }, options);
    expect(arrived.state.activity).toBe("loaf");
    expect(arrived.effects.some((effect) => effect.type === "wander")).toBe(false);
    const after = stepMascot(arrived.state, { type: "tick", now: state.nextIdle + out.ms + CLIP_MS.loaf + 10 }, options);
    expect(after.state.activity).toBe("idle");
    expect(after.effects.some((effect) => effect.type === "wander")).toBe(false);
  });

  it("never prowls while it cannot move (the chat open, its bot waiting, reduced motion)", () => {
    const state: MascotState = { ...roomy(newMascotState(0)), memory: prowlOnly() };
    for (const options of [cat({ canMove: false }), cat({ reduced: true })]) {
      const step = stepMascot(state, { type: "tick", now: state.nextIdle }, options);
      expect(step.effects.some((effect) => effect.type === "wander"), JSON.stringify(options.reduced)).toBe(false);
    }
  });

  it("has idle actions of its own (a groom, a tail flick, a slow blink, kneading, a loaf, a hop onto a ledge), for a cat only", () => {
    const own = IDLE_ACTIONS.filter((action) => action.cat).map((action) => action.id);
    expect(own).toEqual(expect.arrayContaining(["prowl", "groom", "tailFlick", "slowBlink", "knead", "loaf", "ledge"]));
    const base = { liveliness: "normal" as const, mood: 0.6, reduced: false, canMove: true, random: Math.random };
    const weightOf = (cat: boolean, dog: boolean) => Object.fromEntries(idleWeights(newSchedulerMemory(), 1e9, { ...base, cat, dog }).map((entry) => [entry.action.id, entry.weight]));
    const forCat = weightOf(true, false);
    const forOwl = weightOf(false, false);
    const forDog = weightOf(false, true);
    for (const id of own) {
      expect(forCat[id], id).toBeGreaterThan(0);
      expect(forOwl[id], id).toBe(0);
      expect(forDog[id], id).toBe(0);
    }
    // and none of the dog's
    for (const action of IDLE_ACTIONS.filter((item) => item.dog)) expect(forCat[action.id], action.id).toBe(0);
    // reduced motion keeps only the gentle ones
    const reduced = Object.fromEntries(idleWeights(newSchedulerMemory(), 1e9, { ...base, cat: true, reduced: true }).map((entry) => [entry.action.id, entry.weight]));
    expect(reduced.prowl).toBe(0);
    expect(reduced.groom).toBeGreaterThan(0);
  });

  it("keeps doing what each long clip and the brain's pose ask", () => {
    expect(grumpHeldFor("walk", "idle")).toBe("walk");
    expect(grumpHeldFor("walk", "idle", true)).toBe("stalk");
    expect(grumpHeldFor("fly", "idle")).toBe("walk");
    expect(grumpHeldFor("loaf", "idle")).toBe("loaf");
    expect(grumpHeldFor("sleep", "idle")).toBe("sleep");
    expect(grumpHeldFor("idle", "sleep")).toBe("sleep");
    expect(grumpHeldFor("drag", "idle")).toBe("drag");
    expect(grumpHeldFor("working", "idle")).toBe("work");
    expect(grumpHeldFor("idle", "speak")).toBe("talk");
    expect(grumpHeldFor("idle", "alert")).toBe("listen");
    expect(grumpHeldFor("idle", "idle")).toBeNull();
    for (const move of ["walk", "stalk", "loaf", "sleep", "drag", "work", "talk", "listen"] as const) expect(GRUMP_MOVE_TIMING[move].loop, move).toBe(true);
  });

  it("reacts to the desktop's events like a cat", () => {
    expect(GRUMP_CUES).toEqual({ nudge: "bonk", achievement: "knead", message: "pounce", snooze: "curl", refusal: "hiss", error: "earsFlat" });
    for (const [cue, clip] of Object.entries(GRUMP_CUES)) {
      expect(cueClipFor("grump", cue as keyof typeof GRUMP_CUES)).toBe(clip);
      expect(Object.hasOwn(CLIP_MS, clip), clip).toBe(true);
      expect(grumpMoveFor(clip), clip).not.toBeNull();
    }
    // the others do not hiss or flatten their ears
    expect(cueClipFor("shiba", "refusal")).toBeNull();
    expect(cueClipFor("owl", "error")).toBeNull();
  });

  it("offers its own moves in the menu, each one a clip its rig plays once", () => {
    expect(mascotFor({ character: "grump" }).moves).toEqual(GRUMP_MENU_MOVES);
    for (const clip of GRUMP_MENU_MOVES) {
      const move = grumpMoveFor(clip);
      expect(move, clip).not.toBeNull();
      expect(GRUMP_MOVE_TIMING[move!].loop, clip).toBe(false);
    }
  });
});
