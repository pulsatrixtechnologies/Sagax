import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AnimationClip, AnimationMixer, Bone, Group, LoopRepeat, Quaternion, QuaternionKeyframeTrack, Vector3 } from "three";
import { OWL_REFERENCE } from "@/lib/owl/owl-art";
import { CLIP_MS } from "../clips";
import { mascotStage } from "../fit";
import { fitOwlCamera, PIVOT_MODEL, sphereInView } from "./fit3d";
import { clipSpeed, createOverlay, facingYaw, FACE_YAW, GAZE_HEAD_MAX, OWL_CLIP_FOR, OWL_CLIPS, partColors } from "./Owl3D";

const here = dirname(fileURLToPath(import.meta.url));

interface GltfJson {
  nodes: { name?: string; extras?: Record<string, unknown> }[];
  meshes: { name: string; primitives: { material: number; targets?: unknown[] }[]; extras?: { targetNames?: string[] } }[];
  materials: { name: string }[];
  skins: { joints: number[] }[];
  animations: { name: string; channels: { target: { node: number; path: string } }[] }[];
  extensionsUsed?: string[];
}

function readGlb() {
  const glb = readFileSync(join(here, "owl.glb"));
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString()) as GltfJson;
  return { glb, json };
}

describe("the 3D owl model", () => {
  const { glb, json } = readGlb();

  it("ships as a compressed, skinned glb of our own, under 800 KB", () => {
    expect(glb.subarray(0, 4).toString()).toBe("glTF");
    expect(glb.length).toBeLessThan(800 * 1024);
    expect(json.extensionsUsed).toContain("EXT_meshopt_compression");
    // one skeleton: every part's skin binds the same joints
    expect(json.skins.length).toBeGreaterThan(0);
    for (const skin of json.skins) expect(skin.joints).toEqual(json.skins[0].joints);
  });

  it("is a modeled owl: every part, a material per palette region, a full rig", () => {
    const meshes = json.meshes.map((mesh) => mesh.name);
    for (const part of ["head", "body", "wings", "tufts", "beak", "eyeball", "iris", "pupil", "highlight", "lids", "feet", "tail", "spots"]) expect(meshes).toContain(part);
    const materials = json.materials.map((material) => material.name).sort();
    expect(materials).toEqual(Object.keys(partColors(OWL_REFERENCE)).sort());
    const joints = json.skins[0].joints.map((index) => json.nodes[index].name);
    for (const bone of ["root", "hips", "spine", "chest", "neck", "head", "tuft.L", "tuft.R", "eye.L", "eye.R", "wing.L", "wing_mid.L", "wing_tip.L", "wing.R", "wing_mid.R", "wing_tip.R", "leg.L", "foot.L", "leg.R", "foot.R", "tail"]) {
      expect(joints).toContain(bone);
    }
  });

  it("has shape keys for the blink, the expressions and the beak", () => {
    const lids = json.meshes.find((mesh) => mesh.name === "lids");
    expect(lids?.extras?.targetNames).toEqual(["blink", "happy", "sad", "sleepy", "surprised", "squint"]);
    expect(json.meshes.find((mesh) => mesh.name === "beak")?.extras?.targetNames).toEqual(["open"]);
  });

  it("carries every clip, each moving bones and shape keys in place", () => {
    const names = json.animations.map((clip) => clip.name);
    expect([...names].sort()).toEqual([...OWL_CLIPS].sort());
    const root = json.nodes.findIndex((node) => node.name === "owl");
    for (const clip of json.animations) {
      expect(clip.channels.some((channel) => channel.target.path === "rotation")).toBe(true);
      // the window moves the mascot: no clip moves the model's own node
      expect(clip.channels.some((channel) => channel.target.node === root)).toBe(false);
    }
  });
});

describe("the 3D owl's clips", () => {
  it("has a clip of the model for every activity of behavior.ts", () => {
    const { json } = readGlb();
    const names = new Set(json.animations.map((clip) => clip.name));
    for (const [activity, clip] of Object.entries(OWL_CLIP_FOR)) expect(names.has(clip), `${activity} -> ${clip}`).toBe(true);
    for (const timed of Object.keys(CLIP_MS)) expect(OWL_CLIP_FOR).toHaveProperty(timed);
  });

  it("plays a timed clip in the time behavior.ts gives it, within reason", () => {
    expect(clipSpeed("wave", 1.6)).toBeCloseTo(1);
    expect(clipSpeed("hop", 0.7)).toBeCloseTo(1);
    expect(clipSpeed("spin", 2.0)).toBeLessThanOrEqual(2.2);
    expect(clipSpeed("walk", 0.6)).toBe(1);
  });

  it("turns in depth toward its side, further on the move", () => {
    expect(facingYaw(1, false)).toBeCloseTo(FACE_YAW.rest);
    expect(facingYaw(-1, true)).toBeCloseTo(-FACE_YAW.moving);
    expect(facingYaw(0, false)).toBe(0);
  });

  it("wears the bot's palette part by part, as the 2D owl does", () => {
    const colors = partColors({ ...OWL_REFERENCE, plumage: "#123456" });
    expect(colors.plumage).toBe("#123456");
    expect(colors.lid).toBe("#123456");
    expect(colors.iris).toBe(OWL_REFERENCE.iris);
    expect(colors.cream).toBe(OWL_REFERENCE.cream);
  });
});

describe("the gaze and blink layer", () => {
  function rig() {
    const owl = new Group();
    const neck = new Bone();
    const head = new Bone();
    head.position.y = 1;
    const eye = new Bone();
    eye.position.set(0.3, 0.2, 0.5);
    neck.add(head);
    head.add(eye);
    owl.add(neck);
    owl.updateMatrixWorld(true);
    return { owl, neck, head, eye };
  }

  it("never builds up: after many frames the head and eyes are where the clip put them", () => {
    const { owl, neck, head, eye } = rig();
    // the clip animates the neck only, so the mixer never rewrites the head or the eyes
    const sway = new QuaternionKeyframeTrack(".quaternion", [0, 1], [...new Quaternion().toArray(), ...new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.3).toArray()]);
    sway.name = `${neck.uuid}.quaternion`;
    const mixer = new AnimationMixer(owl);
    mixer.clipAction(new AnimationClip("sway", 1, [sway])).setLoop(LoopRepeat, Infinity).play();
    const influences = [0.2];
    const overlay = createOverlay({ head, eyes: [eye], lids: [{ influences, blink: 0 }] });
    const headRest = head.quaternion.clone();
    const eyeRest = eye.quaternion.clone();
    for (let i = 0; i < 600; i += 1) {
      mixer.update(1 / 60);
      const undo = overlay({ x: 1, y: -0.5 }, 1);
      expect(influences[0]).toBe(1);
      expect(head.quaternion.angleTo(headRest)).toBeCloseTo(GAZE_HEAD_MAX, 5);
      undo();
    }
    expect(head.quaternion.angleTo(headRest)).toBeLessThan(1e-9);
    expect(eye.quaternion.angleTo(eyeRest)).toBeLessThan(1e-9);
    expect(influences[0]).toBe(0.2);
  });

  it("clamps the gaze however far the pointer is", () => {
    const { head } = rig();
    const rest = head.quaternion.clone();
    const overlay = createOverlay({ head, eyes: [], lids: [] });
    const undo = overlay({ x: 40, y: 0 }, 0);
    expect(head.quaternion.angleTo(rest)).toBeCloseTo(GAZE_HEAD_MAX, 5);
    undo();
  });
});

describe("the 3D owl's camera", () => {
  it("frames the owl where the flat owl sits, and no turn or flip leaves the view", () => {
    const size = 120;
    const stage = mascotStage(size);
    const fit = fitOwlCamera(stage, size, 28);
    const pivotPx = { x: stage.left + 0.5 * size, y: stage.top + 0.62 * size };
    expect(fit.target.x + (pivotPx.x - stage.width / 2) * fit.unitsPerPx).toBeCloseTo(PIVOT_MODEL.x, 5);
    expect(fit.target.y - (pivotPx.y - stage.height / 2) * fit.unitsPerPx).toBeCloseTo(PIVOT_MODEL.y, 5);
    const reach = Math.hypot(0.5, 0.62) * 2.56;
    expect(sphereInView(fit, stage, 28, PIVOT_MODEL, reach * 0.95)).toBe(true);
    expect(sphereInView(fit, stage, 28, PIVOT_MODEL, reach * 1.6)).toBe(false);
  });
});
