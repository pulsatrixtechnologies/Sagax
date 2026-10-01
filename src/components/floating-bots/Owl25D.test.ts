import { describe, expect, it } from "vitest";
import { lidTransform, rigTransform } from "@/lib/owl/owl-art";
import { mascotMotion } from "./behavior";
import { REST_FRAME } from "./owl3d/owl-model";
import { owl25dTransforms } from "./Owl25D";

const at = (activity: Parameters<typeof mascotMotion>[0]["activity"], elapsed: number) =>
  owl25dTransforms(mascotMotion({ activity, since: 0, facing: 1 }, { now: elapsed, pose: "idle", reduced: false, gaze: null }));

describe("the desktop owl in 2.5D: owl-art's own rig, driven by the mascot", () => {
  it("rests exactly as the avatar's art: no turn, folded wings, open eyes", () => {
    const rest = owl25dTransforms(REST_FRAME);
    expect(rest.rig).toBe(rigTransform({ x: 0, y: 0, tilt: 0, sx: 1, sy: 1 }));
    expect(rest.farWingOpacity).toBe(0);
    expect(rest.lids).toBe(lidTransform(0));
    expect(rest.turn).toContain("rotateY(0.00deg)");
  });

  it("opens its wings while dragged and turns around in a spin", () => {
    expect(at("drag", 100).farWingOpacity).toBe(1);
    expect(at("spin", 550).turn).toMatch(/rotateY\(1[5-9]\d\.\d+deg\)/);
  });

  it("shuts its eyes asleep", () => {
    expect(at("sleep", 400).lids).toBe(lidTransform(1));
  });
});
