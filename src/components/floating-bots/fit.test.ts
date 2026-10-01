import { describe, expect, it } from "vitest";
import { insideStage, MAX_LIFT, mascotStage, PIVOT, WING_REACH } from "./fit";

describe("the mascot's stage fits every pose", () => {
  const size = 128;
  const stage = mascotStage(size);
  const corners = [
    { x: -PIVOT.x * size, y: -PIVOT.y * size },
    { x: (1 - PIVOT.x) * size, y: -PIVOT.y * size },
    { x: -PIVOT.x * size, y: (1 - PIVOT.y) * size },
    { x: (1 - PIVOT.x) * size, y: (1 - PIVOT.y) * size },
  ];

  it("keeps the box's corners inside at any angle of a spin or a backflip, even mid-jump", () => {
    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg * Math.PI) / 180;
      for (const c of corners) {
        const turned = { x: c.x * Math.cos(a) - c.y * Math.sin(a), y: c.x * Math.sin(a) + c.y * Math.cos(a) - MAX_LIFT * size };
        expect(insideStage(stage, size, turned)).toBe(true);
      }
    }
  });

  it("keeps spread wings inside on both sides", () => {
    const reach = (0.5 + WING_REACH) * size;
    expect(insideStage(stage, size, { x: reach, y: 0 })).toBe(true);
    expect(insideStage(stage, size, { x: -reach, y: 0 })).toBe(true);
  });

  it("centers the owl horizontally and grows with it", () => {
    expect(stage.left + size / 2).toBe(Math.round(stage.width / 2));
    expect(mascotStage(200).width).toBeGreaterThan(stage.width);
  });
});
