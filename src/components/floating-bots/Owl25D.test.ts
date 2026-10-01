import { describe, expect, it } from "vitest";
import { lidTransform, rigTransform } from "@/lib/owl/owl-art";
import { mascotMotion } from "./behavior";
import { REST_FRAME } from "./owl3d/owl-model";
import { FLAT_MIN_WIDTH, flatTurn, owl25dTransforms } from "./Owl25D";

const at = (activity: Parameters<typeof mascotMotion>[0]["activity"], elapsed: number) =>
  owl25dTransforms(mascotMotion({ activity, since: 0, facing: 1 }, { now: elapsed, pose: "idle", reduced: false, gaze: null }));

describe("the desktop owl in 2.5D: owl-art's own rig, driven by the mascot", () => {
  it("rests exactly as the avatar's art: no turn, folded wings, open eyes", () => {
    const rest = owl25dTransforms(REST_FRAME);
    expect(rest.rig).toBe(rigTransform({ x: 0, y: 0, tilt: 0, sx: 1, sy: 1 }));
    expect(rest.farWingOpacity).toBe(0);
    expect(rest.lids).toBe(lidTransform(0));
    expect(rest.turn).toBe("translateY(0.00px) scale(1.0000, 1.0000)");
  });

  it("opens its wings while dragged", () => {
    expect(at("drag", 100).farWingOpacity).toBe(1);
  });

  it("never turns in depth: no spin, flip or roll, never thinner than a squashed owl", () => {
    for (const clip of ["spin", "backflip", "headSpin", "lookBack", "fly", "celebrate"] as const) {
      for (let ms = 0; ms < 2000; ms += 50) {
        const t = at(clip, ms);
        expect(t.turn).not.toMatch(/rotate[XYZ]?\(/);
        expect(t.rig).not.toMatch(/rotate\((-?1[6-9]|-?[2-9]\d|-?\d{3})/);
      }
    }
    for (let face = -1; face <= 1; face += 0.05) expect(Math.abs(flatTurn(face).sx)).toBeGreaterThanOrEqual(FLAT_MIN_WIDTH);
  });

  it("faces the other way only through a quick squash, mirrored, not edge-on", () => {
    expect(flatTurn(1)).toEqual({ sx: 1, sy: 1, lift: 0 });
    expect(flatTurn(-1).sx).toBe(-1);
    expect(flatTurn(0.05).sy).toBeLessThan(0.9);
  });

  it("shuts its eyes asleep", () => {
    expect(at("sleep", 400).lids).toBe(lidTransform(1));
  });
});
