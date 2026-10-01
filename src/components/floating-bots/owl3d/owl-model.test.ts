import { describe, expect, it } from "vitest";
import { Color, Mesh, MeshToonMaterial } from "three";
import { mascotMotion } from "../behavior";
import { buildOwl, owlHex, poseOwl, REST_FRAME } from "./owl-model";

describe("the 3D owl", () => {
  it("is built from primitives with two eyes, two wings, and parts to click", () => {
    const rig = buildOwl("blue");
    expect(rig.eyes).toHaveLength(2);
    expect(rig.wings).toHaveLength(2);
    expect(rig.solids.length).toBeGreaterThan(20);
    rig.dispose();
  });

  it("wears the bot's colour as its plumage, like the 2D owl", () => {
    expect(owlHex("blue")).toBe("#377FE6");
    expect(owlHex("#123456")).toBe("#123456");
    expect(owlHex("nonsense")).toBe("#009957");
    const rig = buildOwl("red");
    const torso = rig.solids[0] as Mesh;
    const expected = new Color("#D94B52");
    expect((torso.material as MeshToonMaterial).color.getHex()).toBe(expected.getHex());
    rig.dispose();
  });

  it("moves its parts as the frame says: lids, wings, head and spin", () => {
    const rig = buildOwl("green");
    const open = rig.eyes[0].lid.rotation.x;
    poseOwl(rig, { ...REST_FRAME, lid: 1, wing: 1, headYaw: 0.5, spin: Math.PI });
    expect(rig.eyes[0].lid.rotation.x).toBeGreaterThan(open);
    expect(rig.wings[0].rotation.z).toBeLessThan(-1);
    expect(rig.wings[1].rotation.z).toBeGreaterThan(1);
    expect(rig.head.rotation.y).toBeCloseTo(0.5);
    expect(rig.root.rotation.y).toBeCloseTo(Math.PI);
    poseOwl(rig, mascotMotion({ activity: "sleep", since: 0, facing: 1 }, { now: 500, pose: "idle", reduced: false, gaze: null }));
    expect(rig.eyes[1].lid.rotation.x).toBeCloseTo(Math.PI / 2);
    rig.dispose();
  });
});
