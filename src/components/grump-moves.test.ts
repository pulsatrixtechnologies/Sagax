// Grump's moves: the table (the fourteen every character plays and the
// cat's own), the walk's keyframes, the blending, the rig, the desktop clips.
import { describe, expect, it } from "vitest";
import { GRUMP_GROUND, GRUMP_LEGS, grumpPalette, legIK, TAIL_JOINTS } from "./grump-art";
import {
  GRUMP_CLIP_MOVES,
  GRUMP_HELD_CLIPS,
  GRUMP_MOVE_TIMING,
  GRUMP_MOVES,
  GrumpRig,
  WALK_KEYS,
  WALK_PHASE,
  blendGrumpPose,
  grumpHipsAt,
  grumpMoveAt,
  grumpMoveFor,
  grumpMovePose,
  grumpMoveWeight,
  grumpPoseSvg,
  grumpReducedFace,
  grumpRestPose,
  grumpTransforms,
  isGrumpMove,
  tailWave,
  walkKey,
} from "./grump-moves";
import { CLIP_MS } from "./floating-bots/clips";

const GENERIC = ["idle", "blink", "look", "nod", "shake", "bounce", "wave", "think", "celebrate", "sleep", "alert", "talk", "listen", "work"];
const CAT = ["walk", "stalk", "sitUp", "loaf", "stretch", "groom", "tailFlick", "earsFlat", "slowBlink", "knead", "pounce", "ledge", "curl", "yawn", "hiss", "bonk"];

const finite = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finite);
  if (value && typeof value === "object") return Object.values(value).every(finite);
  return true;
};

describe("Grump's moves", () => {
  it("plays the fourteen moves every character plays, then the cat's own", () => {
    expect(GRUMP_MOVES.slice(0, 14)).toEqual(GENERIC);
    for (const move of CAT) expect(GRUMP_MOVES, move).toContain(move);
    expect(new Set(GRUMP_MOVES).size).toBe(GRUMP_MOVES.length);
    expect(Object.keys(GRUMP_MOVE_TIMING).sort()).toEqual([...GRUMP_MOVES].sort());
    expect(isGrumpMove("hiss")).toBe(true);
    expect(isGrumpMove("bark")).toBe(false);
  });

  it("gives every move a finite pose all through its length", () => {
    for (const move of GRUMP_MOVES) {
      const { duration } = GRUMP_MOVE_TIMING[move];
      expect(duration, move).toBeGreaterThan(0);
      for (let i = 0; i <= 24; i += 1) {
        const part = grumpMoveAt(move, (duration * i) / 24);
        expect(finite(part), `${move} ${i}`).toBe(true);
        if (part.tail) expect(part.tail, move).toHaveLength(TAIL_JOINTS);
      }
    }
  });

  it("starts and ends each one-shot near the rest, so it blends in and out without a pop", () => {
    for (const move of GRUMP_MOVES) {
      const { duration, loop } = GRUMP_MOVE_TIMING[move];
      if (loop) continue;
      expect(grumpMoveWeight(move, 0), move).toBe(0);
      if (duration < 0.3) continue;
      expect(grumpMoveWeight(move, duration / 2), move).toBe(1);
      expect(grumpMoveWeight(move, duration + 0.3), move).toBe(0);
    }
  });

  it("walks on eight keyframes in a cat's lateral sequence, the paws planted while they bear weight", () => {
    expect(WALK_KEYS.length).toBeGreaterThanOrEqual(8);
    // each leg a quarter cycle after the one before: hind, fore on one side, then the other
    expect(Object.values(WALK_PHASE).sort()).toEqual([0, 0.25, 0.5, 0.75]);
    // the curve passes through its keys and closes on itself
    for (let k = 0; k < WALK_KEYS.length; k += 1) {
      expect(walkKey(k / WALK_KEYS.length).x).toBeCloseTo(WALK_KEYS[k].x, 6);
      expect(walkKey(k / WALK_KEYS.length).lift).toBeCloseTo(WALK_KEYS[k].lift, 6);
    }
    expect(walkKey(1).x).toBeCloseTo(walkKey(0).x, 6);
    // at every moment at least two paws are on the ground
    for (let i = 0; i < 64; i += 1) {
      const pose = grumpMovePose("walk", (GRUMP_MOVE_TIMING.walk.duration * i) / 64);
      expect(pose.stance).toBe("stand");
      const hips = grumpHipsAt(pose);
      const down = GRUMP_LEGS.filter((leg) => legIK(leg, pose.legs[leg].x, pose.legs[leg].lift, hips[leg]).paw[1] > GRUMP_GROUND - 0.6);
      expect(down.length, String(i)).toBeGreaterThanOrEqual(2);
    }
    // the tail and the ears move with the stride (secondary motion)
    const a = grumpMovePose("walk", 0);
    const b = grumpMovePose("walk", GRUMP_MOVE_TIMING.walk.duration / 4);
    expect(a.tail).not.toEqual(b.tail);
    expect(a.earL).not.toBe(b.earL);
  });

  it("stretches the front first (chest down), then the back (a hind leg out behind)", () => {
    const front = grumpMovePose("stretch", 0.7);
    const back = grumpMovePose("stretch", 2.05);
    expect(front.bodyRot).toBeGreaterThan(10);
    expect(front.legs.frontNear.x).toBeGreaterThan(5);
    expect(front.mouth).toBe("yawn");
    expect(back.bodyRot).toBeLessThan(-4);
    expect(back.legs.backNear.x).toBeLessThan(-5);
    expect(back.legs.backNear.lift).toBeGreaterThan(1);
  });

  it("does what a cat does in each of its own moves", () => {
    expect(grumpMovePose("groom", 1).mouth).toBe("lick");
    expect(grumpMovePose("groom", 1).pawR.y).toBeLessThan(-20);
    expect(grumpMovePose("hiss", 0.7)).toMatchObject({ mouth: "hiss", expression: "angry" });
    expect(grumpMovePose("hiss", 0.7).earL).toBeGreaterThan(40);
    expect(grumpMovePose("earsFlat", 0.8).earR).toBeGreaterThan(40);
    expect(grumpMovePose("slowBlink", 0.75).blink).toBe(1);
    expect(grumpMovePose("pounce", 0.93).y).toBeLessThan(-10);
    expect(grumpMovePose("ledge", 1.5)).toMatchObject({ stance: "sit" });
    expect(grumpMovePose("ledge", 1.5).y).toBeLessThan(-10);
    expect(grumpMovePose("curl", GRUMP_MOVE_TIMING.curl.duration).stance).toBe("curl");
    expect(grumpMovePose("sleep", 1)).toMatchObject({ stance: "curl", expression: "sleepy" });
    expect(grumpMovePose("loaf", 1).stance).toBe("lie");
    expect(grumpMovePose("yawn", 0.8).mouth).toBe("yawn");
    expect(grumpMovePose("bonk", 0.34).headRot).toBeGreaterThan(10);
    expect(grumpMovePose("stalk", 0.4)).toMatchObject({ stance: "stand", expression: "suspicious" });
    expect(grumpMovePose("stalk", 0.4).bodyY).toBeGreaterThan(2.5);
    const knead = [0.2, 0.5].map((t) => grumpMovePose("knead", t));
    expect(knead[0].pawL.y).not.toBe(knead[1].pawL.y);
    const flick = grumpMovePose("tailFlick", 0.23).tail;
    expect(Math.abs(flick[3])).toBeGreaterThan(Math.abs(flick[0]));
  });

  it("blends a part over a pose: numbers in between, the stance and the face at half way", () => {
    const rest = grumpRestPose();
    const part = { y: -10, stance: "stand" as const, expression: "angry" as const, tail: [10, 10, 10, 10] };
    const quarter = blendGrumpPose(rest, part, 0.25);
    expect(quarter.y).toBeCloseTo(-2.5);
    expect(quarter.stance).toBe("sit");
    expect(quarter.tail[0]).toBeCloseTo(2.5);
    const most = blendGrumpPose(rest, part, 0.75);
    expect(most).toMatchObject({ stance: "stand", expression: "angry" });
    expect(blendGrumpPose(rest, part, 0)).toBe(rest);
  });

  it("waves the tail from the root to the tip", () => {
    const wave = tailWave(0.3, 10, 1);
    expect(wave).toHaveLength(TAIL_JOINTS);
    expect(Math.max(...tailWave(0.25, 10, 1, 0).map(Math.abs))).toBeCloseTo(12.5);
  });

  it("composes the idle life, a held activity and a one-shot on one clock, and hands back when done", () => {
    const rig = new GrumpRig(0, 3);
    expect(rig.busy(0)).toBe(false);
    rig.hold("walk", 0);
    expect(rig.pose(1).stance).toBe("stand");
    rig.play("hiss", 1);
    expect(rig.pose(1.7).mouth).toBe("hiss");
    rig.hold(null, 2);
    expect(rig.busy(2.1)).toBe(true);
    const after = rig.pose(4);
    expect(after.stance).toBe("sit");
    expect(rig.busy(4)).toBe(false);
    // the idle life blinks now and then: slowly
    const blinks = Array.from({ length: 400 }, (_, i) => new GrumpRig(0, 3).pose(i * 0.05).blink);
    expect(Math.max(...blinks)).toBeGreaterThan(0.5);
  });

  it("writes every group's transform, the torso only while standing", () => {
    const sitting = grumpTransforms(grumpRestPose());
    expect(sitting.torso).toBe("");
    for (const key of ["whole", "head", "earL", "earR", "brows", "mouth"] as const) expect(sitting[key]).toMatch(/translate|rotate|scale/);
    expect(grumpTransforms(grumpMovePose("stretch", 0.7)).torso).toMatch(/rotate\(15/);
    // a mirrored turn never collapses to nothing
    expect(grumpTransforms({ ...grumpRestPose(), turn: 0 }).whole).toMatch(/scale\(0\.06/);
  });

  it("renders any frame of a move as SVG with the same parts", () => {
    const svg = grumpPoseSvg(grumpMovePose("walk", 0.2), { palette: grumpPalette("#8B5E3C"), size: 200 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/NaN|undefined/);
    expect(svg.match(/<path/g)!.length).toBeGreaterThan(40);
  });

  it("shows a move's face, still, under reduced motion", () => {
    expect(grumpReducedFace("hiss")).toMatchObject({ mouth: "hiss", expression: "angry" });
    expect(grumpReducedFace("sleep")).toMatchObject({ stance: "curl", expression: "sleepy" });
    expect(grumpReducedFace("walk")).toBeNull();
    expect(grumpReducedFace("blink")).toBeNull();
  });

  it("maps every desktop clip it has a move for, and keeps the long clips as held activities", () => {
    for (const [clip, move] of Object.entries(GRUMP_CLIP_MOVES)) {
      expect(isGrumpMove(move), clip).toBe(true);
      expect(GRUMP_MOVE_TIMING[move].loop, clip).toBe(false);
    }
    // every timed desktop clip plays something on Grump
    for (const clip of Object.keys(CLIP_MS)) if (clip !== "turn") expect(grumpMoveFor(clip), clip).not.toBeNull();
    expect(GRUMP_HELD_CLIPS).toMatchObject({ walk: "walk", sleep: "sleep", drag: "drag" });
    for (const move of Object.values(GRUMP_HELD_CLIPS)) expect(GRUMP_MOVE_TIMING[move].loop).toBe(true);
    expect(grumpMoveFor("stretch")).toBe("stretch");
    expect(grumpMoveFor("hiss")).toBe("hiss");
    expect(grumpMoveFor("nope")).toBeNull();
    expect(grumpMoveFor(null)).toBeNull();
  });
});
