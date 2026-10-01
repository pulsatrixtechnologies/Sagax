import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AnimationClip, NumberKeyframeTrack, QuaternionKeyframeTrack } from "three";
import { OWL_REFERENCE } from "@/lib/owl/owl-art";
import { mascotStage } from "../fit";
import { fitOwlCamera, PIVOT_MODEL, sphereInView } from "./fit3d";
import { cutClip, partColors } from "./Owl3D";

const here = dirname(fileURLToPath(import.meta.url));

describe("the 3D owl", () => {
  it("ships as a small skinned glb of our own", () => {
    const glb = readFileSync(join(here, "owl.glb"));
    expect(glb.subarray(0, 4).toString()).toBe("glTF");
    expect(glb.length).toBeLessThan(500 * 1024);
    const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString());
    expect(json.skins?.length).toBeGreaterThan(0);
    const names = json.nodes.map((node: { name?: string }) => node.name);
    for (const part of ["plumage", "cream", "wingNear", "wingFar", "beak", "iris", "pupil", "highlight", "lid"]) expect(names).toContain(part);
    for (const bone of ["rootBone", "spineBone", "headBone", "wingNearBone", "wingNearTipBone", "wingFarBone", "tailBone", "legNearBone", "legFarBone", "tuftNearBone", "tuftFarBone"]) expect(names).toContain(bone);
    const owl = json.nodes.find((node: { name?: string }) => node.name === "owl");
    for (const clip of ["idle", "walk", "turn", "hop", "fly", "land", "spin", "backflip", "wave", "stretch", "petted", "dance", "sad", "sleep", "wake", "startled", "celebrate"]) {
      expect(owl.extras.clips[clip]).toHaveLength(2);
    }
  });

  it("wears the bot's palette part by part, as the 2D owl does", () => {
    const colors = partColors({ ...OWL_REFERENCE, plumage: "#123456" });
    expect(colors.plumage).toBe("#123456");
    expect(colors.lid).toBe("#123456");
    expect(colors.iris).toBe(OWL_REFERENCE.iris);
    expect(colors.cream).toBe(OWL_REFERENCE.cream);
  });

  it("cuts a clip out of the baked timeline, exactly on its frames", () => {
    const timeline = new AnimationClip("timeline", 1, [
      new NumberKeyframeTrack("lid.morphTargetInfluences", [0, 0.5, 1], [0, 1, 0]),
      new QuaternionKeyframeTrack("rootBone.quaternion", [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    const clip = cutClip(timeline, "blink", [5, 10], 10);
    expect(clip.name).toBe("blink");
    expect(clip.duration).toBeCloseTo(0.5);
    const lid = clip.tracks[0];
    expect(Array.from(lid.values)).toEqual([1, 0.8, 0.6, 0.4, 0.2, 0].map((v) => expect.closeTo(v, 5)) as unknown as number[]);
  });

  it("frames the camera so the owl sits where the flat owl does, and no turn or flip leaves the view", () => {
    const size = 120;
    const stage = mascotStage(size);
    const fit = fitOwlCamera(stage, size, 28);
    // the owl box's pivot, in stage px, back to model units, is the model's pivot
    const pivotPx = { x: stage.left + 0.5 * size, y: stage.top + 0.62 * size };
    expect(fit.target.x + (pivotPx.x - stage.width / 2) * fit.unitsPerPx).toBeCloseTo(PIVOT_MODEL.x, 5);
    expect(fit.target.y - (pivotPx.y - stage.height / 2) * fit.unitsPerPx).toBeCloseTo(PIVOT_MODEL.y, 5);
    // a sphere wrapping the whole art box (2.56 units square) around the pivot, turning any way
    const reach = Math.hypot(0.5, 0.62) * 2.56;
    expect(sphereInView(fit, stage, 28, PIVOT_MODEL, reach * 0.95)).toBe(true);
    expect(sphereInView(fit, stage, 28, PIVOT_MODEL, reach * 1.6)).toBe(false);
  });
});
