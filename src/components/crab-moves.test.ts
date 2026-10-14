// Crab's moves: the table, the scuttle's opposite legs, a hop with a squash,
// the rig's layering and the desktop's state mapping.
import { describe, expect, it } from "vitest";
import {
  CRAB_GROUPS,
  CRAB_MOVES,
  CRAB_REST,
  CRAB_TRACKS,
  CrabRig,
  crabHeldFor,
  crabIdlePose,
  crabMoveAt,
  crabMoveFor,
  crabMoveWeight,
  crabReducedFace,
  crabTransforms,
  layerPose,
  type CrabMove,
} from "./crab-moves";

const sample = (move: CrabMove, steps = 120) => Array.from({ length: steps + 1 }, (_, i) => crabMoveAt(move, (i / steps) * CRAB_TRACKS[move].duration, false));

describe("Crab's moves table", () => {
  it("keys every track in order, from 0 to 1", () => {
    expect(Object.keys(CRAB_TRACKS)).toEqual([...CRAB_MOVES]);
    for (const move of CRAB_MOVES) {
      const { keys, duration } = CRAB_TRACKS[move];
      expect(duration, move).toBeGreaterThan(0);
      expect(keys[0].at, move).toBe(0);
      expect(keys.at(-1)?.at, move).toBe(1);
      for (let i = 1; i < keys.length; i += 1) expect(keys[i].at, `${move} key ${i}`).toBeGreaterThan(keys[i - 1].at);
    }
  });

  it("returns every one-shot to rest at its end, so nothing pops", () => {
    for (const move of CRAB_MOVES) {
      if (CRAB_TRACKS[move].loop) continue;
      const end = crabMoveAt(move, CRAB_TRACKS[move].duration, false);
      for (const [name, rest] of Object.entries(CRAB_REST)) expect(end[name as keyof typeof CRAB_REST], `${move} ${name}`).toBeCloseTo(rest, 3);
    }
  });
});

describe("the crab's own moves", () => {
  it("hops with a crouch squash, a lift, and a landing squash", () => {
    const frames = sample("hop");
    const ys = frames.map((p) => p.y);
    const apex = ys.indexOf(Math.min(...ys));
    expect(Math.min(...ys)).toBeLessThan(-15);
    expect(apex).toBeGreaterThan(0);
    expect(apex).toBeLessThan(frames.length - 1);
    const sy = frames.map((p) => p.sy);
    expect(Math.min(...sy)).toBeLessThan(0.94);
    expect(Math.max(...sy)).toBeGreaterThan(1.02);
  });

  it("scuttles on opposite leg pairs", () => {
    const a = crabMoveAt("walk", 0, true);
    const b = crabMoveAt("walk", CRAB_TRACKS.walk.duration / 2, true);
    expect(a.leg0).toBeLessThan(-5);
    expect(a.leg2).toBeLessThan(-5);
    expect(a.leg1).toBeCloseTo(0, 5);
    expect(a.leg3).toBeCloseTo(0, 5);
    expect(b.leg1).toBeLessThan(-5);
    expect(b.leg3).toBeLessThan(-5);
    expect(b.leg0).toBeCloseTo(0, 5);
    expect(b.leg2).toBeCloseTo(0, 5);
  });

  it("the menu scuttle is a one-shot that steps side to side then rests", () => {
    expect(CRAB_TRACKS.scuttle.loop).toBe(false);
    expect(CRAB_TRACKS.scuttle.duration).toBe(1.44);
    const frames = sample("scuttle");
    expect(Math.max(...frames.map((p) => p.x))).toBeGreaterThan(2);
    expect(Math.min(...frames.map((p) => p.x))).toBeLessThan(-2);
    expect(frames[0].x).toBeCloseTo(0, 3);
    expect(frames.at(-1)?.x).toBeCloseTo(0, 3);
  });

  it("waves the right arm", () => {
    const frames = sample("wave");
    expect(Math.min(...frames.map((p) => p.armRRot))).toBeLessThan(-40);
    expect(Math.max(...frames.map((p) => p.clawR))).toBeGreaterThan(0.5);
    expect(frames.every((p) => p.armLRot === 0 || Math.abs(p.armLRot) < 1)).toBe(true);
  });

  it("celebrates with a Clawd clap: claws up and sparkles", () => {
    const frames = sample("celebrate");
    expect(Math.min(...frames.map((p) => p.armLRot))).toBeLessThan(-40);
    expect(Math.max(...frames.map((p) => p.armRRot))).toBeGreaterThan(40);
    expect(Math.max(...frames.map((p) => p.spark))).toBeGreaterThan(0.5);
    expect(frames.some((p) => p.expression === "happy")).toBe(true);
  });
});

describe("Crab's rig", () => {
  it("lays a move over the idle life: the breath goes on under it", () => {
    const idle = crabIdlePose(1.2, []);
    expect(idle.y).toBeLessThan(0);
    const over = layerPose(idle, crabMoveAt("look", 0.4, false), 1);
    expect(over.lookX).toBeGreaterThan(3);
    expect(over.y).toBe(idle.y);
  });

  it("idles like Claude: a breath, a wandering look, a lean", () => {
    const a = crabIdlePose(0, []);
    const b = crabIdlePose(2.7, []);
    expect(a.y).not.toBeCloseTo(b.y, 2);
    expect(Math.abs(b.lookX) + Math.abs(b.lookY)).toBeGreaterThan(0.2);
    expect(Math.abs(b.legSy0 - 1) + Math.abs(b.legSy3 - 1)).toBeGreaterThan(0.01);
    expect(Math.abs(b.legRot0) + Math.abs(b.legRot3)).toBeGreaterThan(0.2);
  });

  it("plays a one-shot over a held activity and hands back to the idle life after both", () => {
    const rig = new CrabRig(0, 1);
    rig.hold("walk", 0);
    rig.play("wave", 1);
    expect(rig.pose(1.2).armRRot).toBeLessThan(-10);
    expect(rig.busy(2)).toBe(true);
    rig.hold(null, 3);
    expect(rig.busy(10)).toBe(false);
    expect(crabMoveWeight("hop", -1)).toBe(0);
    expect(crabMoveWeight("hop", 0.3)).toBe(1);
  });

  it("writes finite transforms for every group, at every frame of every move", () => {
    for (const move of CRAB_MOVES) {
      for (const pose of sample(move, 12)) {
        const transforms = crabTransforms(pose);
        expect(Object.keys(transforms)).toEqual([...CRAB_GROUPS]);
        for (const value of Object.values(transforms)) expect(value, move).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it("shows a move's face, still, under reduced motion", () => {
    expect(crabReducedFace("hop")).toBeNull();
    expect(crabReducedFace("wave")?.expression).toBe("happy");
    expect(crabReducedFace("sleep")?.blink).toBe(1);
  });
});

describe("Crab on the desktop", () => {
  it("has a move for every desktop clip it is asked to play", () => {
    expect(crabMoveFor("hop")).toBe("hop");
    expect(crabMoveFor("jump")).toBe("hop");
    expect(crabMoveFor("wave")).toBe("wave");
    expect(crabMoveFor("dance")).toBe("celebrate");
    expect(crabMoveFor("walk")).toBe("walk");
    expect(crabMoveFor("scuttle")).toBe("scuttle");
    expect(crabMoveFor(null)).toBeNull();
    expect(crabMoveFor("nonsense")).toBeNull();
  });

  it("keeps doing what the desktop's state asks", () => {
    expect(crabHeldFor("walk", "idle")).toBe("walk");
    expect(crabHeldFor("fly", "idle")).toBe("hop");
    expect(crabHeldFor("sleep", "idle")).toBe("sleep");
    expect(crabHeldFor("drag", "idle")).toBe("drag");
    expect(crabHeldFor("working", "think")).toBe("work");
    expect(crabHeldFor("idle", "speak")).toBe("talk");
    expect(crabHeldFor("idle", "alert")).toBe("listen");
    expect(crabHeldFor("idle", "idle")).toBeNull();
  });
});
