// Shiba's moves: the table (ids, durations, held or one-shot, reduced
// motion), the poses they give at every moment, the walk cycle's keyframes,
// the rig that composes them, what the desktop mascot plays for each state,
// and the cost of a frame.
import { describe, expect, it } from "vitest";
import { MOUTHS, SHIBA_EXPRESSIONS, SHIBA_LEGS } from "./shiba-art";
import {
  blendPose,
  isShibaMove,
  reducedFace,
  restPose,
  SHIBA_BARKS,
  SHIBA_CLIP_MOVES,
  SHIBA_MOVE_TIMING,
  SHIBA_MOVES,
  SHIBA_SPINS,
  ShibaRig,
  shibaMoveAt,
  shibaMoveFor,
  shibaMoveWeight,
  shibaTransforms,
  type ShibaMove,
} from "./shiba-moves";
import { CLIP_MS } from "./floating-bots/clips";
import { cueClipFor, MASCOTS, SHIBA_MENU_MOVES, SHIBA_MOVE_LABELS, shibaHeldFor } from "./floating-bots/mascots";
import { characterMoves, isMoveClip } from "./floating-bots/moves";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";

const GENERIC = ["idle", "blink", "look", "nod", "shake", "bounce", "wave", "think", "celebrate", "sleep", "alert", "talk", "listen", "work"];
const DOG = ["walk", "run", "sniff", "turnCircles", "bark", "sit", "lieDown", "wag", "earTwitch", "stretch", "headTilt", "excited", "sad", "shakeOff", "drag"];
const finite = (value: unknown) => typeof value !== "number" || Number.isFinite(value);
const at = (move: ShibaMove, u: number) => blendPose(restPose(), shibaMoveAt(move, u), 1);

describe("Shiba's moves table", () => {
  it("ports the fourteen moves every character plays, then adds the dog's own", () => {
    expect(SHIBA_MOVES.slice(0, 14)).toEqual(GENERIC);
    expect(SHIBA_MOVES.slice(14)).toEqual(DOG);
    expect(Object.keys(SHIBA_MOVE_TIMING).sort()).toEqual([...SHIBA_MOVES].sort());
    expect(isShibaMove("bark")).toBe(true);
    expect(isShibaMove("fly")).toBe(false);
  });

  it("gives every move a length, held or one-shot, and a reduced-motion form", () => {
    for (const move of SHIBA_MOVES) {
      const { duration, loop, reduced } = SHIBA_MOVE_TIMING[move];
      expect(duration, move).toBeGreaterThan(0);
      expect(duration, move).toBeLessThanOrEqual(4);
      expect(["face", "none"]).toContain(reduced);
      // the activities a state holds are loops; the rest end by themselves
      expect(loop, move).toBe(["idle", "sleep", "talk", "listen", "work", "walk", "run", "drag"].includes(move));
    }
    // the walk cycle: eight keyframes of 80 ms
    expect(SHIBA_MOVE_TIMING.walk.duration).toBe(0.64);
    expect(SHIBA_MOVE_TIMING.turnCircles.duration).toBe(2.6);
    expect(SHIBA_MOVE_TIMING.bark.duration).toBe(1.2);
  });

  it("holds still under reduced motion: a move shows its face and stance, or nothing", () => {
    expect(reducedFace("walk")).toBeNull();
    expect(reducedFace("shake")).toBeNull();
    expect(reducedFace("bark")).toMatchObject({ mouth: "bark" });
    expect(reducedFace("sleep")).toEqual({ stance: "lie", expression: "sleepy", mouth: null });
    expect(reducedFace("sad")).toMatchObject({ expression: "sad" });
    for (const move of SHIBA_MOVES) {
      const face = reducedFace(move);
      if (SHIBA_MOVE_TIMING[move].reduced === "none") expect(face, move).toBeNull();
      else expect(face, move).not.toBeNull();
    }
  });
});

describe("Shiba's poses", () => {
  it("are finite at every moment, with known stances, faces and mouths", () => {
    for (const move of SHIBA_MOVES) {
      const d = SHIBA_MOVE_TIMING[move].duration;
      for (let k = 0; k <= 24; k += 1) {
        const pose = at(move, (k / 24) * d);
        for (const value of Object.values(pose)) expect(finite(value), `${move} ${k}`).toBe(true);
        for (const leg of SHIBA_LEGS) expect(Number.isFinite(pose.legs[leg].angle) && Number.isFinite(pose.legs[leg].lift)).toBe(true);
        expect(["sit", "stand", "lie"]).toContain(pose.stance);
        if (pose.expression) expect(SHIBA_EXPRESSIONS).toContain(pose.expression);
        if (pose.mouth) expect(MOUTHS).toContain(pose.mouth);
        for (const transform of Object.values(shibaTransforms(pose))) expect(transform, move).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it("walks on four legs in diagonal pairs, over eight distinct keyframes, ears and tail trailing", () => {
    const frames = Array.from({ length: 8 }, (_, i) => at("walk", i * 0.08));
    expect(frames.every((pose) => pose.stance === "stand")).toBe(true);
    // the diagonal pairs move together and opposite to the other pair
    for (const pose of frames) {
      expect(pose.legs.frontNear.angle).toBeCloseTo(pose.legs.backFar.angle, 5);
      expect(pose.legs.frontFar.angle).toBeCloseTo(pose.legs.backNear.angle, 5);
      expect(pose.legs.frontNear.angle).toBeCloseTo(-pose.legs.frontFar.angle, 5);
    }
    const keys = new Set(frames.map((pose) => `${pose.legs.frontNear.angle.toFixed(1)}:${pose.legs.frontNear.lift.toFixed(2)}:${pose.legs.frontFar.lift.toFixed(2)}`));
    expect(keys.size).toBe(8);
    // a leg lifts while it swings forward, and the tail and ears move with the step
    expect(Math.max(...frames.map((pose) => pose.legs.frontNear.lift))).toBeGreaterThan(0.9);
    expect(Math.max(...frames.map((pose) => pose.tail)) - Math.min(...frames.map((pose) => pose.tail))).toBeGreaterThan(20);
    expect(Math.max(...frames.map((pose) => pose.earL)) - Math.min(...frames.map((pose) => pose.earL))).toBeGreaterThan(5);
    // a cycle loops
    expect(at("walk", 0.64).legs.frontNear.angle).toBeCloseTo(at("walk", 0).legs.frontNear.angle, 5);
  });

  it("turns in circles twice, facing the other way halfway round, then sits", () => {
    const { count, each, sitAt } = SHIBA_SPINS;
    expect(count * each).toBe(sitAt);
    expect(at("turnCircles", 0.5).turn).toBeLessThan(0);
    expect(at("turnCircles", 1).turn).toBeGreaterThan(0.9);
    expect(at("turnCircles", 1.5).turn).toBeLessThan(0);
    expect(at("turnCircles", 0.5).stance).toBe("stand");
    expect(at("turnCircles", 2.4).stance).toBe("sit");
    expect(Math.abs(at("turnCircles", 0.25).turn)).toBeGreaterThanOrEqual(0.3);
  });

  it("barks three times, mouth wide open each time, with a small hop", () => {
    expect(SHIBA_BARKS).toHaveLength(3);
    for (const start of SHIBA_BARKS) {
      const pose = at("bark", start + 0.12);
      expect(pose.mouth).toBe("bark");
      expect(pose.y).toBeLessThan(-1);
    }
    expect(at("bark", 0.36).mouth).toBeNull();
    expect(SHIBA_BARKS.at(-1)! + 0.24).toBeLessThanOrEqual(SHIBA_MOVE_TIMING.bark.duration);
  });

  it("lies down and gets back up, droops its ears when sad, tilts its head when listening", () => {
    expect(at("lieDown", 1.6).stance).toBe("lie");
    expect(at("lieDown", 3.1).stance).toBe("sit");
    expect(at("sad", 1.3).earL).toBeGreaterThan(20);
    expect(at("sad", 1.3).tail).toBeGreaterThan(20);
    expect(at("listen", 0.3).headRot).toBeGreaterThan(8);
    expect(at("stretch", 0.45).rot).toBeGreaterThan(6);
    expect(at("wave", 0.8).pawR.y).toBeLessThan(-8);
    expect(at("sleep", 1).stance).toBe("lie");
  });

  it("blends a move in and out, and switches the stance and face halfway", () => {
    expect(shibaMoveWeight("bark", 0)).toBe(0);
    expect(shibaMoveWeight("bark", 0.6)).toBe(1);
    expect(shibaMoveWeight("bark", 1.2 + 0.18)).toBe(0);
    const half = blendPose(restPose(), { stance: "stand", expression: "sad", tail: 20 }, 0.4);
    expect(half.stance).toBe("sit");
    expect(half.expression).toBeNull();
    expect(half.tail).toBeCloseTo(8, 5);
    expect(blendPose(restPose(), { stance: "stand", expression: "sad" }, 0.6)).toMatchObject({ stance: "stand", expression: "sad" });
  });
});

describe("Shiba's rig", () => {
  it("breathes and blinks on its own, walks while held, plays a one-shot over it, then rests", () => {
    const rig = new ShibaRig(0, 7);
    expect(rig.busy(0)).toBe(false);
    const breaths = [0, 0.85, 1.7, 2.55].map((t) => rig.pose(t).sy);
    expect(new Set(breaths.map((v) => v.toFixed(4))).size).toBeGreaterThan(1);
    rig.hold("walk", 3);
    expect(rig.pose(3.5).stance).toBe("stand");
    rig.play("bark", 4);
    expect(rig.pose(4 + SHIBA_BARKS[1] + 0.12).mouth).toBe("bark");
    // the walk goes on under the bark
    expect(rig.pose(4 + SHIBA_BARKS[1] + 0.12).stance).toBe("stand");
    rig.hold(null, 6);
    expect(rig.busy(6.1)).toBe(true);
    expect(rig.pose(7).stance).toBe("sit");
    expect(rig.busy(7)).toBe(false);
  });

  it("lands a new stance with a small squash", () => {
    const rig = new ShibaRig(0, 1);
    rig.pose(0);
    rig.hold("walk", 1);
    rig.pose(1);
    const landing = rig.pose(1.24);
    expect(landing.stance).toBe("stand");
    expect(landing.sy).toBeLessThan(1);
  });

  it("costs well under a millisecond a frame (a 60 fps budget is 16.7 ms)", () => {
    const rig = new ShibaRig(0, 3);
    rig.hold("walk", 0);
    rig.play("turnCircles", 0.5);
    const frames = 3000;
    const started = performance.now();
    for (let i = 0; i < frames; i += 1) shibaTransforms(rig.pose(i / 60));
    const perFrame = (performance.now() - started) / frames;
    expect(perFrame).toBeLessThan(0.5);
  });
});

describe("what the desktop Shiba plays", () => {
  it("maps every desktop clip it knows to one of its moves, and its menu moves to clips that end by themselves", () => {
    for (const [clip, move] of Object.entries(SHIBA_CLIP_MOVES)) {
      expect(isShibaMove(move), clip).toBe(true);
      expect(Object.hasOwn(CLIP_MS, clip), clip).toBe(true);
    }
    for (const clip of SHIBA_MENU_MOVES) {
      expect(isMoveClip(clip), clip).toBe(true);
      expect(shibaMoveFor(clip), clip).not.toBeNull();
    }
    expect(shibaMoveFor("hoot")).toBe("bark");
    expect(shibaMoveFor("celebrate")).toBe("turnCircles");
    expect(shibaMoveFor("tilt")).toBe("headTilt");
    expect(shibaMoveFor("nothing")).toBeNull();
    const entry = MASCOTS.find((candidate) => candidate.id === "shiba")!;
    expect(characterMoves({ character: "shiba" }).map((move) => move.clip)).toEqual([...entry.moves]);
    for (const key of Object.values(SHIBA_MOVE_LABELS)) {
      expect(en).toHaveProperty([key!]);
      expect(fr).toHaveProperty([key!]);
    }
  });

  it("holds the right activity for each state: walks, runs, sleeps, dangles, works, talks, sits up waiting", () => {
    expect(shibaHeldFor("walk", "idle")).toBe("walk");
    expect(shibaHeldFor("fly", "idle")).toBe("run");
    expect(shibaHeldFor("flyOut", "idle")).toBe("run");
    expect(shibaHeldFor("sleep", "idle")).toBe("sleep");
    expect(shibaHeldFor("drag", "idle")).toBe("drag");
    expect(shibaHeldFor("working", "idle")).toBe("work");
    expect(shibaHeldFor("idle", "speak")).toBe("talk");
    // waiting for an approval: it sits up, head tilted, attentive
    expect(shibaHeldFor("idle", "alert")).toBe("listen");
    expect(shibaHeldFor("idle", "idle")).toBeNull();
  });

  it("barks at a nudge, turns in circles for an achievement, gets excited at a message, naps when snoozed", () => {
    expect(cueClipFor("shiba", "nudge")).toBe("bark");
    expect(cueClipFor("shiba", "achievement")).toBe("turnCircles");
    expect(cueClipFor("shiba", "message")).toBe("excited");
    expect(cueClipFor("shiba", "snooze")).toBe("lieDown");
    expect(at("lieDown", 1.6).expression).toBe("sleepy");
    // the other characters keep their own life
    for (const character of ["owl", "shape", "trombi", "bunbu"] as const) expect(cueClipFor(character, "nudge")).toBeNull();
  });
});

describe("Shiba's bark sound", () => {
  it("is off by default, and synthesizes a short bark when on", async () => {
    const { readFloatingBotPrefs, setFloatingBarkSound } = await import("@/lib/floating-bots");
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    expect(readFloatingBotPrefs(storage).barkSound).toBe(false);
    setFloatingBarkSound(true, storage);
    expect(readFloatingBotPrefs(storage).barkSound).toBe(true);
    const { playShibaBark, BARK_SCORE } = await import("@/lib/shiba-bark");
    const started: string[] = [];
    const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 });
    const node = (name: string) => ({ connect: (next: unknown) => next, start: () => started.push(name), stop() {}, frequency: param(), gain: param(), type: "", buffer: null });
    const fake = {
      state: "running",
      currentTime: 0,
      sampleRate: 8000,
      destination: {},
      resume: () => Promise.resolve(),
      createOscillator: () => node("tone"),
      createGain: () => node("gain"),
      createBiquadFilter: () => node("filter"),
      createBufferSource: () => node("noise"),
      createBuffer: (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) }),
    };
    expect(playShibaBark(() => fake as unknown as AudioContext)).toBe(true);
    expect(started.sort()).toEqual(["noise", "tone"]);
    expect(BARK_SCORE.length).toBeLessThan(0.2);
    expect(playShibaBark(() => null)).toBe(false);
  });
});
