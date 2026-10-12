import { describe, expect, it } from "vitest";
import {
  gazeNormForAvatar,
  hoverLean,
  leanTransform,
  pickSidebarReaction,
  pointerInRect,
  smoothGaze,
} from "./interaction";

function box(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

describe("sidebar-mascot interaction", () => {
  it("tracks gaze across a tall sidebar", () => {
    const avatar = box(100, 200, 36, 36);
    const sidebar = box(0, 0, 280, 800);
    const g = gazeNormForAvatar(avatar, 260, 218, sidebar);
    expect(g.x).toBeGreaterThan(0.25);
    expect(Math.abs(g.y)).toBeLessThan(0.05);
  });

  it("smooths gaze toward the target", () => {
    const a = smoothGaze({ x: 0, y: 0 }, { x: 1, y: -0.5 }, 0.05);
    expect(a.x).toBeGreaterThan(0.1);
    expect(a.y).toBeLessThan(0);
  });

  it("leans the rigid sprite toward the pointer", () => {
    const lean = hoverLean({ x: 0.8, y: 0 }, 1);
    expect(lean.sx).toBeGreaterThan(1);
    expect(lean.rot).toBeGreaterThan(0);
    expect(leanTransform(lean)).toContain("rotate");
  });

  it("picks a stable reaction per bot", () => {
    expect(pickSidebarReaction("alpha")).toBe(pickSidebarReaction("alpha"));
    expect(pickSidebarReaction("beta")).not.toBe(pickSidebarReaction("alpha"));
  });

  it("detects pointer inside padded rect", () => {
    const r = box(10, 10, 100, 40);
    expect(pointerInRect(5, 20, r, 8)).toBe(true);
    expect(pointerInRect(200, 20, r, 0)).toBe(false);
  });
});
