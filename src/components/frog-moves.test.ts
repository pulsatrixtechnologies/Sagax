// Frog's moves: the table (the fourteen every character plays, then the
// frog's own), the shape of the key moves (a real jump arc, the throat puff,
// the tongue, one lid at a time, the pond, the pad), the rig's layering and
// the desktop's state mapping.
import { describe, expect, it } from "vitest";
import { CLIP_MS } from "./floating-bots/clips";
import { FROG_EXPRESSIONS } from "./frog-art";
import {
  FLY_AT,
  FROG_CLIP_MOVES,
  FROG_GENERIC_MOVES,
  FROG_GROUPS,
  FROG_MOVES,
  FROG_REST,
  FROG_TRACKS,
  FrogRig,
  frogCueFor,
  frogHeldFor,
  frogIdlePose,
  frogMoveAt,
  frogMoveFor,
  frogMoveWeight,
  frogReducedFace,
  frogTransforms,
  layerPose,
  lidSlide,
  type FrogMove,
} from "./frog-moves";

const sample = (move: FrogMove, steps = 120) => Array.from({ length: steps + 1 }, (_, i) => frogMoveAt(move, (i / steps) * FROG_TRACKS[move].duration, false));

describe("Frog's moves table", () => {
  it("plays the fourteen moves every character plays, then its own", () => {
    expect([...FROG_GENERIC_MOVES]).toEqual(["idle", "blink", "look", "nod", "shake", "bounce", "wave", "think", "celebrate", "sleep", "alert", "talk", "listen", "work"]);
    for (const own of ["hop", "longJump", "puff", "tongue", "blinkOne", "smugNod", "sink", "lilyNap", "legStretch", "croak", "shiver", "sideEye"] as const) expect(FROG_MOVES).toContain(own);
    expect(Object.keys(FROG_TRACKS)).toEqual([...FROG_MOVES]);
  });

  it("keys every track in order, from 0 to 1, with known faces", () => {
    for (const move of FROG_MOVES) {
      const { keys, duration } = FROG_TRACKS[move];
      expect(duration, move).toBeGreaterThan(0);
      expect(keys[0].at, move).toBe(0);
      expect(keys.at(-1)?.at, move).toBe(1);
      for (let i = 1; i < keys.length; i += 1) expect(keys[i].at, `${move} key ${i}`).toBeGreaterThan(keys[i - 1].at);
      for (const key of keys) if (key.face) expect(FROG_EXPRESSIONS, move).toContain(key.face);
    }
  });

  it("returns every one-shot to rest at its end, so nothing pops", () => {
    for (const move of FROG_MOVES) {
      if (FROG_TRACKS[move].loop) continue;
      const end = frogMoveAt(move, FROG_TRACKS[move].duration, false);
      for (const [name, rest] of Object.entries(FROG_REST)) expect(end[name as keyof typeof FROG_REST], `${move} ${name}`).toBeCloseTo(rest, 3);
    }
  });

  it("shakes no faster than 4 Hz", () => {
    for (const move of FROG_MOVES) {
      const shake = FROG_TRACKS[move].shake;
      if (shake) expect(shake.hz, move).toBeLessThanOrEqual(4);
    }
  });
});

describe("the frog's own moves", () => {
  it("hops in a real arc: a crouch, a push with the legs out, a rise that slows, a fall that speeds up, a landing squash", () => {
    expect(FROG_TRACKS.hop.keys.length).toBeGreaterThanOrEqual(8);
    const frames = sample("hop");
    const ys = frames.map((p) => p.y);
    const apex = ys.indexOf(Math.min(...ys));
    expect(Math.min(...ys)).toBeLessThan(-25);
    // up before the apex, down after it
    for (let i = 1; i <= apex; i += 1) expect(ys[i], `rise ${i}`).toBeLessThanOrEqual(ys[i - 1] + 1e-9);
    for (let i = apex + 1; i < ys.length && ys[i - 1] < -0.5; i += 1) expect(ys[i], `fall ${i}`).toBeGreaterThanOrEqual(ys[i - 1] - 1e-9);
    // squash before the take-off and at the landing, stretch in the air
    const sy = frames.map((p) => p.sy);
    expect(Math.min(...sy.slice(0, apex))).toBeLessThan(0.86);
    expect(Math.min(...sy.slice(apex))).toBeLessThan(0.86);
    expect(Math.max(...sy)).toBeGreaterThan(1.08);
    // the legs push out, then fold in the air
    expect(Math.max(...frames.map((p) => p.legs))).toBeGreaterThan(0.95);
    expect(frames.at(-1)?.legs).toBeCloseTo(0, 5);
  });

  it("jumps longer and higher in the long jump than in the hop", () => {
    const high = (move: FrogMove) => Math.min(...sample(move).map((p) => p.y));
    expect(high("longJump")).toBeLessThan(high("hop"));
    expect(FROG_TRACKS.longJump.duration).toBeGreaterThan(FROG_TRACKS.hop.duration);
  });

  it("puffs the throat to full and back while thinking, the face curious", () => {
    const frames = sample("puff");
    expect(Math.max(...frames.map((p) => p.puff))).toBeCloseTo(1, 2);
    expect(frames[0].puff).toBe(0);
    expect(frames[30].expression).toBe("curious");
    // a croak goes past full
    expect(Math.max(...sample("croak").map((p) => p.puff))).toBeGreaterThan(1.2);
  });

  it("flicks the tongue to the fly, reels it in caught, and gulps with both eyes", () => {
    const frames = sample("tongue", 260);
    const reach = frames.map((p) => p.tongue);
    expect(Math.max(...reach)).toBeCloseTo(1, 2);
    const caught = frames.findIndex((p) => p.caught > 0.5);
    expect(caught).toBeGreaterThan(reach.indexOf(Math.max(...reach)) - 3);
    // the fly is gone once swallowed, the eyes shut for the gulp
    expect(frames.at(-1)?.fly).toBe(0);
    expect(Math.max(...frames.slice(caught).map((p) => Math.min(p.blinkL, p.blinkR)))).toBeGreaterThan(0.95);
    expect(frames.some((p) => p.mouth === "open")).toBe(true);
    expect(FLY_AT[1]).toBeLessThan(40);
  });

  it("blinks one eye at a time", () => {
    const frames = sample("blinkOne");
    expect(frames.some((p) => p.blinkL > 0.95 && p.blinkR < 0.05)).toBe(true);
    expect(frames.some((p) => p.blinkR > 0.95 && p.blinkL < 0.05)).toBe(true);
    expect(frames.every((p) => p.blinkL < 0.5 || p.blinkR < 0.5)).toBe(true);
  });

  it("sinks until the lower third is under water while waiting, and naps afloat on a lily pad", () => {
    expect(frogMoveAt("sink", 1, true).water).toBe(67);
    expect(FROG_TRACKS.sink.loop).toBe(true);
    const nap = frogMoveAt("lilyNap", 2, true);
    expect(nap.pad).toBe(1);
    expect(nap.expression).toBe("sleepy");
    expect(FROG_TRACKS.lilyNap.loop).toBe(true);
  });

  it("nods slowly and smugly, stretches its legs, shivers, croaks with a shake and side-eyes", () => {
    expect(FROG_TRACKS.smugNod.duration).toBeGreaterThanOrEqual(1.5);
    expect(sample("smugNod")[40].expression).toBe("proud");
    expect(Math.max(...sample("legStretch").map((p) => p.legs))).toBeGreaterThanOrEqual(1);
    expect(Math.max(...sample("shiver").map((p) => Math.abs(p.x)))).toBeGreaterThan(0.5);
    expect(Math.max(...sample("croak").map((p) => Math.abs(p.x)))).toBeGreaterThan(0.3);
    const side = sample("sideEye");
    expect(side[60].expression).toBe("suspicious");
    expect(side[60].headRot).toBeGreaterThan(3);
  });

  it("waves with one hand raised beside the head", () => {
    const frames = sample("wave");
    expect(Math.min(...frames.map((p) => p.handRY))).toBeLessThan(-30);
    expect(Math.max(...frames.map((p) => p.handRX))).toBeGreaterThan(15);
    expect(frames.every((p) => p.handLY === 0)).toBe(true);
  });
});

describe("Frog's rig", () => {
  it("lays a move over the idle life: the breath and the blinks go on under it", () => {
    const idle = frogIdlePose(1.45, [1.4]);
    expect(idle.blinkL).toBeGreaterThan(0.3);
    const over = layerPose(idle, frogMoveAt("sideEye", 1, false), 1);
    expect(over.blinkL).toBe(idle.blinkL);
    expect(over.headRot).toBeGreaterThan(3);
    // the water rises as high as either asks; the face switches at half way
    expect(layerPose(idle, frogMoveAt("sink", 1, true), 0.5).water).toBeCloseTo(83.5, 5);
    expect(layerPose(idle, frogMoveAt("sink", 1, true), 0.4).expression).toBe(null);
  });

  it("blinks the right eye a beat after the left at rest", () => {
    const t = 1.4 + 0.05;
    const pose = frogIdlePose(t, [1.4]);
    expect(pose.blinkL).toBeGreaterThan(pose.blinkR);
  });

  it("plays a one-shot over a held activity and hands back to the idle life after both", () => {
    const rig = new FrogRig(0, 1);
    rig.hold("sink", 0);
    rig.play("tongue", 1);
    expect(rig.pose(1.4).tongue).toBeGreaterThan(0.5);
    expect(rig.pose(1.4).water).toBeLessThan(70);
    expect(rig.busy(2)).toBe(true);
    rig.hold(null, 3);
    expect(rig.busy(10)).toBe(false);
    expect(rig.pose(10).water).toBe(100);
    expect(frogMoveWeight("hop", -1)).toBe(0);
    expect(frogMoveWeight("hop", 0.5)).toBe(1);
  });

  it("writes finite transforms for every group, at every frame of every move", () => {
    for (const move of FROG_MOVES) {
      for (const pose of sample(move, 12)) {
        const transforms = frogTransforms(pose, { u: 0.3 });
        expect(Object.keys(transforms)).toEqual([...FROG_GROUPS]);
        for (const value of Object.values(transforms)) expect(value, move).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it("slides the blink lids only past the face's own lid, and meets them a little under the middle", () => {
    const lid = { height: 18.8, rest: 0.5 };
    expect(lidSlide(0.3, lid)).toEqual({ upper: -22.8, lower: 22.8 });
    expect(lidSlide(1, lid).upper).toBeCloseTo(0, 5);
    expect(lidSlide(1, lid).lower).toBeCloseTo(0, 5);
  });

  it("shows a move's face, still, under reduced motion; the pond and the pad stay", () => {
    expect(frogReducedFace("hop")).toBeNull();
    expect(frogReducedFace("croak")?.expression).toBeTruthy();
    expect(frogReducedFace("sink")?.water).toBe(67);
    expect(frogReducedFace("lilyNap")?.pad).toBe(1);
  });
});

describe("Frog on the desktop", () => {
  it("has a move for every desktop clip it is asked to play, and knows its own", () => {
    for (const clip of Object.keys(CLIP_MS)) {
      const move = frogMoveFor(clip);
      if (move) expect(FROG_MOVES, clip).toContain(move);
    }
    for (const move of Object.values(FROG_CLIP_MOVES)) expect(FROG_MOVES).toContain(move);
    expect(frogMoveFor("croak")).toBe("croak");
    expect(frogMoveFor("hop")).toBe("hop");
    expect(frogMoveFor("celebrate")).toBe("smugNod");
    expect(frogMoveFor("wake")).toBe("legStretch");
    expect(frogMoveFor(null)).toBeNull();
    expect(frogMoveFor("nonsense")).toBeNull();
  });

  it("keeps doing what the desktop's state asks", () => {
    expect(frogHeldFor({ activity: "walk", pose: "idle" })).toBe("walk");
    expect(frogHeldFor({ activity: "fly", pose: "idle" })).toBe("longJump");
    expect(frogHeldFor({ activity: "sleep", pose: "idle" })).toBe("lilyNap");
    expect(frogHeldFor({ activity: "drag", pose: "sleep" })).toBe("drag");
    expect(frogHeldFor({ activity: "idle", pose: "alert", task: "waiting" })).toBe("sink");
    expect(frogHeldFor({ activity: "idle", pose: "alert", task: "error" })).toBeNull();
    expect(frogHeldFor({ activity: "working", pose: "think", task: "working" })).toBe("puff");
    expect(frogHeldFor({ activity: "idle", pose: "speak" })).toBe("talk");
    expect(frogHeldFor({ activity: "idle", pose: "idle" })).toBeNull();
  });

  it("plays a cue when the state changes: side-eye on an approval, shiver on a refusal, smug nod on success, stretch after a nap", () => {
    const idle = { activity: "idle", pose: "idle" as const, task: "idle" as const };
    expect(frogCueFor(idle, { ...idle, pose: "alert", task: "waiting" })).toBe("sideEye");
    expect(frogCueFor({ ...idle, pose: "alert", task: "waiting" }, { ...idle, pose: "alert", task: "waiting" })).toBeNull();
    expect(frogCueFor(idle, { ...idle, pose: "alert", task: "error" })).toBe("shiver");
    expect(frogCueFor(idle, { ...idle, pose: "celebrate" })).toBe("smugNod");
    expect(frogCueFor({ ...idle, activity: "sleep" }, { ...idle, activity: "wake" })).toBe("legStretch");
    expect(frogCueFor(idle, idle)).toBeNull();
  });
});

describe("Frog in the desktop machinery", () => {
  it("times its own clips as its tracks last, and gets its own idle actions only when it is a frog", async () => {
    for (const clip of ["croak", "tongue", "smugNod", "legStretch", "shiver", "sideEye", "blinkOne", "longJump"] as const) {
      expect(CLIP_MS[clip], clip).toBe(Math.round(FROG_TRACKS[clip].duration * 1000));
    }
    const { idleWeights, newSchedulerMemory } = await import("./floating-bots/scheduler");
    const options = { liveliness: "normal" as const, mood: 0.6, reduced: false, canMove: true, random: () => 0.5 };
    const weight = (frog: boolean, id: string) => idleWeights(newSchedulerMemory(), 0, { ...options, frog }).find((entry) => entry.action.id === id)?.weight ?? 0;
    for (const id of ["hopAbout", "leap", "blinkOne", "tongue", "smugNod", "croak"]) {
      expect(weight(true, id), id).toBeGreaterThan(0);
      expect(weight(false, id), id).toBe(0);
    }
  });

  it("croaks at a nudge, celebrates an achievement and catches a fly when a message lands", async () => {
    const { cueClipFor, mascotFor } = await import("./floating-bots/mascots");
    expect(cueClipFor("frog", "nudge")).toBe("croak");
    expect(cueClipFor("frog", "achievement")).toBe("celebrate");
    expect(cueClipFor("frog", "message")).toBe("tongue");
    expect(cueClipFor("frog", "snooze")).toBeNull();
    const entry = mascotFor({ character: "frog" });
    for (const move of entry.moves) expect(frogMoveFor(move), move).not.toBeNull();
    for (const move of entry.moves) expect(entry.moveLabels?.[move] ?? move, move).toBeTruthy();
  });
});
