// Ogre's moves: the table, each timeline's shape (where it starts and ends,
// the walk's keys and contacts, the laugh's belly), the rig's blending, and
// what the desktop plays for each clip and pose.
import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { CLIP_MS } from "./floating-bots/clips";
import { cueClipFor, MASCOTS } from "./floating-bots/mascots";
import { OGRE_BODY, OGRE_EXPRESSIONS, OGRE_STANCES } from "./ogre-art";
import {
  blendFrame,
  blinkAt,
  blinkTimes,
  loopSpline,
  OGRE_CLIP_MOVES,
  OGRE_GENERIC_MOVES,
  OGRE_MENU_CLIPS,
  OGRE_MOVE_TIMING,
  OGRE_MOVES,
  OGRE_OWN_MOVES,
  ogreDesktopAction,
  ogreDesktopShot,
  ogreMoveFor,
  ogreMoveFrame,
  ogreMoveWeight,
  OgreRig,
  reducedFace,
  WALK_CONTACTS,
  WALK_CYCLE,
  WALK_KEYS,
  type OgreMove,
} from "./ogre-moves";
import { headPoint, ogreFrameLayers, ogreFrameSvg, restFrame, type OgreFrame } from "./ogre-rig";

const finite = (frame: OgreFrame) => {
  const numbers = [frame.x, frame.y, frame.rot, frame.sx, frame.sy, frame.bodyY, frame.bodyRot, frame.look, frame.lookY, frame.bulge, frame.blink, frame.mouthOpen, frame.shake, frame.belly.sx, frame.belly.sy, frame.belly.y, frame.head.x, frame.head.y, frame.head.rot, frame.head.scale, frame.ears.l, frame.ears.r, frame.ears.back, ...frame.hands.l, ...frame.hands.r, ...frame.feet.l, ...frame.feet.r];
  return numbers.every(Number.isFinite);
};
const near = (a: readonly [number, number], b: readonly [number, number], within: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= within;

describe("Ogre's moves table", () => {
  it("plays the fourteen moves every character plays, then twelve of its own", () => {
    expect([...OGRE_GENERIC_MOVES]).toEqual(["idle", "blink", "look", "nod", "shake", "bounce", "wave", "think", "celebrate", "sleep", "alert", "talk", "listen", "work"]);
    expect([...OGRE_OWN_MOVES]).toEqual(["walk", "laugh", "crossArms", "roar", "flex", "earWiggle", "stomp", "stretch", "chomp", "drag"]);
    expect([...OGRE_MOVES]).toEqual([...OGRE_GENERIC_MOVES, ...OGRE_OWN_MOVES]);
    expect(Object.keys(OGRE_MOVE_TIMING)).toEqual([...OGRE_MOVES]);
  });

  it("holds the activities that last (walk, sleep, arms crossed, talk, listen, work, drag) and plays the rest once", () => {
    const held = OGRE_MOVES.filter((move) => OGRE_MOVE_TIMING[move].loop);
    expect(held).toEqual(["idle", "sleep", "talk", "listen", "work", "walk", "crossArms", "drag"]);
    for (const move of OGRE_MOVES) expect(OGRE_MOVE_TIMING[move].duration, move).toBeGreaterThan(0);
    expect(OGRE_MOVE_TIMING.walk.duration).toBe(WALK_CYCLE);
  });

  it("gives every move a whole frame at every moment: numbers, a stance, one of the sixteen faces", () => {
    for (const move of OGRE_MOVES) {
      const d = OGRE_MOVE_TIMING[move].duration;
      for (let k = 0; k <= 12; k += 1) {
        const frame = ogreMoveFrame(move, (k / 12) * d * 1.5);
        expect(finite(frame), `${move} ${k}`).toBe(true);
        expect(OGRE_STANCES, move).toContain(frame.stance);
        expect(OGRE_EXPRESSIONS, move).toContain(frame.expression);
        expect(frame.shake, move).toBeGreaterThanOrEqual(0);
        expect(ogreFrameSvg(frame, { size: 120, uid: "t" }), move).toMatch(/^<svg /);
      }
    }
  });

  it("starts and ends its one-shots with the hands and boots back at rest, so nothing pops", () => {
    for (const move of OGRE_MOVES) {
      const { duration, loop } = OGRE_MOVE_TIMING[move];
      if (loop || move === "stretch") continue;
      for (const t of [0, duration]) {
        const frame = ogreMoveFrame(move, t);
        if (frame.stance !== "stand") continue;
        const rest = restFrame("stand");
        expect(near(frame.hands.l, rest.hands.l, 4), `${move} ${t} left hand`).toBe(true);
        expect(near(frame.hands.r, rest.hands.r, 4), `${move} ${t} right hand`).toBe(true);
        expect(near(frame.feet.l, rest.feet.l, 3), `${move} ${t} left boot`).toBe(true);
        expect(near(frame.feet.r, rest.feet.r, 3), `${move} ${t} right boot`).toBe(true);
      }
    }
    // the stretch gets up from the log first
    expect(ogreMoveFrame("stretch", 0).stance).toBe("log");
    expect(ogreMoveFrame("stretch", OGRE_MOVE_TIMING.stretch.duration).stance).toBe("stand");
  });

  it("shows a move's face, still, under reduced motion (none for the small ones)", () => {
    expect(reducedFace("roar")).toEqual({ stance: "stand", expression: "angry", mouth: "roar" });
    expect(reducedFace("sleep")?.stance).toBe("log");
    expect(reducedFace("walk")).toBeNull();
    expect(reducedFace("blink")).toBeNull();
  });
});

describe("the heavy walk", () => {
  it("has eight keys a stride pair on every track, and loops without a seam", () => {
    for (const [track, keys] of Object.entries(WALK_KEYS)) expect(keys, track).toHaveLength(8);
    const a = ogreMoveFrame("walk", 0);
    const b = ogreMoveFrame("walk", WALK_CYCLE);
    expect(b.bodyY).toBeCloseTo(a.bodyY, 6);
    expect(b.feet.l[1]).toBeCloseTo(a.feet.l[1], 6);
    // the spline passes through its keys
    expect(loopSpline([0, 1, 2, 3], 0.25)).toBeCloseTo(1, 6);
  });

  it("drops the body on each landing, lifts one boot at a time, and swings the arms against the legs", () => {
    const at = (p: number) => ogreMoveFrame("walk", p * WALK_CYCLE);
    // down (key 1 and 5) is lower than up (key 3 and 7)
    expect(at(1 / 8).bodyY).toBeGreaterThan(at(3 / 8).bodyY + 2);
    expect(at(5 / 8).bodyY).toBeGreaterThan(at(7 / 8).bodyY + 2);
    // passing: the right boot up while the left is planted, then the other way
    expect(at(2 / 8).feet.r[1]).toBeLessThan(OGRE_BODY.footR[1] - 5);
    expect(at(2 / 8).feet.l[1]).toBeCloseTo(OGRE_BODY.footL[1], 6);
    expect(at(6 / 8).feet.l[1]).toBeLessThan(OGRE_BODY.footL[1] - 5);
    // the left hand swings back while the left boot steps forward
    expect(Math.sign(at(0).hands.l[0] - OGRE_BODY.handL[0])).toBe(-Math.sign(at(0).feet.l[0] - OGRE_BODY.footL[0]));
  });

  it("lets the belly, the head and the trumpets follow a beat late, and shakes the ground on each contact only", () => {
    // the belly is still stretching after the body passed its lowest point
    const lowest = ogreMoveFrame("walk", (1 / 8) * WALK_CYCLE);
    const after = ogreMoveFrame("walk", (1.6 / 8) * WALK_CYCLE);
    expect(after.belly.sy).toBeGreaterThan(lowest.belly.sy - 0.002);
    for (const contact of WALK_CONTACTS) expect(ogreMoveFrame("walk", contact * WALK_CYCLE + 0.02).shake, String(contact)).toBeGreaterThan(0.5);
    expect(ogreMoveFrame("walk", 0.25 * WALK_CYCLE).shake).toBe(0);
    expect(ogreMoveFrame("walk", 0.02).props.some((prop) => prop.kind === "dust")).toBe(true);
  });
});

describe("Ogre's own moves", () => {
  it("laughs from the belly: the hands on it, the belly bouncing, the head thrown back", () => {
    const frames = Array.from({ length: 24 }, (_, i) => ogreMoveFrame("laugh", 0.5 + i * 0.05));
    const squash = frames.map((frame) => frame.belly.sy);
    expect(Math.max(...squash) - Math.min(...squash)).toBeGreaterThan(0.05);
    expect(frames.every((frame) => frame.hands.l[0] > 30 && frame.hands.r[0] < 70)).toBe(true);
    expect(frames.every((frame) => frame.lookY < 0)).toBe(true);
    expect(frames.some((frame) => frame.mouth === "laugh")).toBe(true);
  });

  it("roars after a crouch, its trumpets flat back and the air shaking", () => {
    const crouch = ogreMoveFrame("roar", 0.3);
    const roar = ogreMoveFrame("roar", 0.9);
    expect(crouch.sy).toBeLessThan(1);
    expect(roar.mouth).toBe("roar");
    expect(roar.ears.back).toBe(1);
    expect(roar.shake).toBeGreaterThan(0.3);
    expect(roar.props.some((prop) => prop.kind === "shock")).toBe(true);
  });

  it("flexes both arms, the biceps swelling once the fists are up", () => {
    expect(ogreMoveFrame("flex", 0.05).bulge).toBe(0);
    const up = ogreMoveFrame("flex", 1);
    expect(up.bulge).toBeGreaterThan(0.5);
    expect(up.hands.l[1]).toBeLessThan(45);
    expect(up.hands.r[1]).toBeLessThan(45);
  });

  it("crosses its arms while it waits, the right forearm over the left", () => {
    const frame = ogreMoveFrame("crossArms", 1);
    expect(frame.hands.l[0]).toBeGreaterThan(50);
    expect(frame.hands.r[0]).toBeLessThan(50);
    expect(frame.hands.front).toBe("r");
  });

  it("scratches its head when it thinks, the hand at the side of the head", () => {
    const frame = ogreMoveFrame("think", 1.2);
    const temple = headPoint(frame, [86, 40]);
    expect(Math.hypot(frame.hands.r[0] - temple[0], frame.hands.r[1] - temple[1])).toBeLessThan(12);
    expect(frame.expression).toBe("curious");
  });

  it("naps on its log, the snore bubble swelling under the nose and popping", () => {
    const loop = OGRE_MOVE_TIMING.sleep.duration;
    const swelling = ogreMoveFrame("sleep", loop * 0.5);
    const popped = ogreMoveFrame("sleep", loop * 0.58);
    expect(swelling.stance).toBe("log");
    const bubble = swelling.props.find((prop) => prop.kind === "bubble");
    expect(bubble && bubble.kind === "bubble" ? bubble.r : 0).toBeGreaterThan(4);
    expect(popped.props.some((prop) => prop.kind === "bubble")).toBe(false);
    expect(popped.props.some((prop) => prop.kind === "crumb")).toBe(true);
    expect(swelling.props.some((prop) => prop.kind === "z")).toBe(true);
  });

  it("wiggles its trumpets for a nudge, left and right in turn, settling", () => {
    const ears = Array.from({ length: 10 }, (_, i) => ogreMoveFrame("earWiggle", i * 0.05).ears);
    expect(ears.some((e) => e.l > 4)).toBe(true);
    expect(ears.some((e) => e.l < -4)).toBe(true);
    expect(Math.abs(ogreMoveFrame("earWiggle", 1.05).ears.l)).toBeLessThan(2);
  });

  it("stomps around a circle with its fists up, and eats an arriving message in three bites", () => {
    const stomp = Array.from({ length: 16 }, (_, i) => ogreMoveFrame("stomp", 0.2 + i * 0.17));
    expect(Math.max(...stomp.map((frame) => frame.x)) - Math.min(...stomp.map((frame) => frame.x))).toBeGreaterThan(20);
    expect(new Set(stomp.map((frame) => frame.facing)).size).toBe(2);
    expect(stomp.some((frame) => frame.shake > 0.5)).toBe(true);
    const chomp = Array.from({ length: 20 }, (_, i) => ogreMoveFrame("chomp", i * 0.1));
    expect(chomp.some((frame) => frame.mouth === "chomp")).toBe(true);
    expect(chomp.some((frame) => frame.props.some((prop) => prop.kind === "letter" && prop.bite === 2))).toBe(true);
    expect(ogreMoveFrame("chomp", 2.1).props.some((prop) => prop.kind === "letter")).toBe(false);
  });
});

describe("the rig", () => {
  it("blends a move in and out over a fraction of a second", () => {
    expect(ogreMoveWeight("roar", 0)).toBe(0);
    expect(ogreMoveWeight("roar", 0.5)).toBe(1);
    expect(ogreMoveWeight("roar", OGRE_MOVE_TIMING.roar.duration + 0.11)).toBeGreaterThan(0);
    expect(ogreMoveWeight("roar", OGRE_MOVE_TIMING.roar.duration + 0.3)).toBe(0);
    const a = restFrame("stand");
    const b = ogreMoveFrame("flex", 1);
    const half = blendFrame(a, b, 0.5);
    expect(half.hands.l[1]).toBeCloseTo((a.hands.l[1] + b.hands.l[1]) / 2, 6);
    expect(blendFrame(a, b, 0)).toBe(a);
    expect(blendFrame(a, b, 1)).toBe(b);
  });

  it("composes the idle life, a held activity and a one-shot, and rests when nothing plays", () => {
    const rig = new OgreRig(0, 3);
    expect(rig.busy(0)).toBe(false);
    rig.hold("walk", 1);
    expect(rig.busy(1.5)).toBe(true);
    expect(rig.frame(1.5).expression).toBe("attentive");
    rig.play("roar", 2);
    expect(rig.frame(2.9).mouth).toBe("roar");
    rig.hold(null, 3);
    expect(rig.playing(3)).toBe(true);
    expect(rig.playing(4.1)).toBe(false);
    // the walk lets go over a short blend, then the idle life alone
    rig.frame(4.2);
    expect(rig.busy(4.2)).toBe(false);
  });

  it("lands a change of stance with a squash", () => {
    const rig = new OgreRig(0, 3);
    rig.frame(0.5);
    rig.hold("sleep", 1);
    rig.frame(1.2);
    const landing = rig.frame(1.32);
    expect(landing.stance).toBe("log");
    expect(landing.sy).toBeLessThan(1);
  });

  it("blinks on its own seeded rhythm, slowly", () => {
    const times = blinkTimes(5, 60);
    expect(times).toEqual(blinkTimes(5, 60));
    expect(times.length).toBeGreaterThan(8);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(0.29);
    expect(blinkAt(times[0] + 0.1, times)).toBeCloseTo(1, 6);
    expect(blinkAt(times[0] - 0.5, times)).toBe(0);
  });

  it("draws a frame as groups: the whole, the limbs, the body and its belly, the head with its trumpets and face", () => {
    const [whole] = ogreFrameLayers(ogreMoveFrame("wave", 1), { size: 160 });
    const keys = (whole.children ?? []).map((layer) => layer.key);
    expect(keys).toEqual(["log", "legL", "legR", "body", "armL", "armR", "head", "props"]);
    const head = whole.children?.find((layer) => layer.key === "head");
    expect(head?.children?.map((layer) => layer.key)).toEqual(["earL", "earR", "skull", "face", "extras"]);
    // the arm in front comes last
    const crossed = ogreFrameLayers({ ...ogreMoveFrame("crossArms", 1), hands: { ...ogreMoveFrame("crossArms", 1).hands, front: "l" } }, { size: 160 });
    expect(crossed[0].children?.map((layer) => layer.key).slice(4, 6)).toEqual(["armR", "armL"]);
  });
});

describe("Ogre on the desktop", () => {
  it("plays a move for every clip it knows, and its own moves by name", () => {
    for (const [clip, move] of Object.entries(OGRE_CLIP_MOVES)) {
      expect(Object.hasOwn(CLIP_MS, clip), clip).toBe(true);
      expect(OGRE_MOVES, clip).toContain(move);
    }
    expect(ogreMoveFor("celebrate")).toBe("flex");
    expect(ogreMoveFor("sad")).toBe("roar");
    expect(ogreMoveFor("love")).toBe("laugh");
    expect(ogreMoveFor("roar")).toBe("roar");
    expect(ogreMoveFor("hoot")).toBe("roar");
    expect(ogreMoveFor("nonsense")).toBeNull();
    expect(ogreMoveFor(null)).toBeNull();
  });

  it("holds an activity for the clip and the brain's pose", () => {
    const cases: [string, string, OgreMove | null][] = [
      ["walk", "idle", "walk"],
      ["fly", "idle", "walk"],
      ["sleep", "idle", "sleep"],
      ["drag", "idle", "drag"],
      ["working", "think", "work"],
      ["idle", "alert", "crossArms"],
      ["idle", "speak", "talk"],
      ["idle", "think", "think"],
      ["idle", "idle", null],
      ["idle", "celebrate", null],
    ];
    for (const [activity, pose, move] of cases) expect(ogreDesktopAction(activity, pose), `${activity} ${pose}`).toBe(move);
  });

  it("plays a one-shot when the clip changes, a held clip aside", () => {
    expect(ogreDesktopShot("celebrate", { activity: "working" })).toBe("flex");
    expect(ogreDesktopShot("sad", { activity: "working" })).toBe("roar");
    expect(ogreDesktopShot("petted", { activity: "idle" })).toBe("earWiggle");
    expect(ogreDesktopShot("dance", { activity: "idle" })).toBe("stomp");
    expect(ogreDesktopShot("peck", { activity: "idle" })).toBe("chomp");
    expect(ogreDesktopShot("walk", { activity: "idle" })).toBeNull();
    expect(ogreDesktopShot("wave", { activity: "wave" })).toBeNull();
  });

  it("answers the desktop's cues: a nudge, an achievement, a message, a snooze", () => {
    expect(ogreMoveFor(cueClipFor("ogre", "nudge"))).toBe("earWiggle");
    expect(ogreMoveFor(cueClipFor("ogre", "achievement"))).toBe("stomp");
    expect(ogreMoveFor(cueClipFor("ogre", "message"))).toBe("chomp");
    expect(ogreMoveFor(cueClipFor("ogre", "snooze"))).toBe("sleep");
  });

  it("offers its moves in the Moves menu with their own names, in English and French", () => {
    const entry = MASCOTS.find((item) => item.id === "ogre");
    expect(entry?.moves).toEqual([...OGRE_MENU_CLIPS]);
    const played = OGRE_MENU_CLIPS.map((clip) => ogreMoveFor(clip));
    expect(new Set(played).size).toBe(OGRE_MENU_CLIPS.length);
    for (const clip of OGRE_MENU_CLIPS) {
      expect(Object.hasOwn(CLIP_MS, clip), clip).toBe(true);
      const label = entry?.moveLabels?.[clip] ?? `floatingBots.move.${clip}`;
      expect(en, clip).toHaveProperty([label]);
      expect(fr, clip).toHaveProperty([label]);
    }
  });
});
