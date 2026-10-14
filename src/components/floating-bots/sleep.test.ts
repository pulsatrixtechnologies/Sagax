// The mascot asleep reads at a glance (closed eyes, a slow breath, floating
// "z Z", a little dimmed).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CRAB_PX, crabEyeDraw } from "@/components/crab-art";
import { CrabMascot, crabExpressionForMood } from "@/components/CrabMascot";
import { crabMoveAt, crabReducedFace, crabTransforms } from "@/components/crab-moves";
import { FloatingBotView } from "./FloatingBotView";
import { mascotFields, type FloatingSnapshot } from "./protocol";
import { mascotAsleep } from "./sleep";

const mover = { coords: "screen" as const, moveBy: () => undefined, moved: () => undefined };
const CRAB = { character: "crab", skins: { crab: "plain" } } as const;

function snapshot(over: Partial<FloatingSnapshot> = {}): FloatingSnapshot {
  return {
    v: 1, id: "bot_a", name: "Orion", label: "Orion", color: "green", skin: "none", avatar: null, pose: "idle", reduced: false, retro: false,
    sparkle: 0, locale: "fr", menu: [], balloon: null, ...mascotFields({}), mascot: CRAB, hints: { mood: "", working: "", call: "Appeler Orion" }, ...over,
  } as FloatingSnapshot;
}
const render = (snap: FloatingSnapshot, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(createElement(FloatingBotView, { snapshot: snap, onEvent: () => undefined, mover, ...extra }));

describe("asleep, for every mascot", () => {
  it("is its own nap, or the brain's sleep pose while it rests", () => {
    expect(mascotAsleep("sleep", "idle")).toBe(true);
    expect(mascotAsleep("idle", "sleep")).toBe(true);
    expect(mascotAsleep("idle", "idle")).toBe(false);
    expect(mascotAsleep("yawn", "idle")).toBe(false);
    // carried or flying: awake, whatever the pose
    for (const activity of ["drag", "walk", "fly", "flyOut", "return", "wake"] as const) expect(mascotAsleep(activity, "sleep")).toBe(false);
  });

  it("marks the stage asleep and floats the z Z glyphs beside the head", () => {
    const html = render(snapshot({ pose: "sleep" }));
    expect(html).toContain("data-asleep");
    expect(html).toContain("data-sleep-glyphs");
    expect(html).toMatch(/<span>z<\/span><span>z<\/span><span>Z<\/span>/);
    const awake = render(snapshot({ pose: "idle" }));
    expect(awake).not.toContain("data-asleep");
    expect(awake).not.toContain("data-sleep-glyphs");
  });

  it("under reduced motion keeps the glyphs and the closed eyes (static)", () => {
    const html = render(snapshot({ pose: "sleep", reduced: true }));
    expect(html).toContain("data-reduced");
    expect(html).toContain("data-sleep-glyphs");
    expect(html).toContain('data-expression="asleep"');
  });

  it("draws the desktop crab with closed eyes", () => {
    expect(render(snapshot({ pose: "sleep" }))).toContain('data-expression="asleep"');
  });
});

describe("the crab asleep", () => {
  it("closes its eyes: a 4x1 dash on the eye's lower row, never a squint, a lid or nothing", () => {
    const shut = crabEyeDraw("asleep");
    const open = crabEyeDraw("neutral");
    for (const side of [0, 1] as const) {
      expect(shut.pupils[side].h).toBe(CRAB_PX);
      expect(shut.pupils[side].w).toBe(4 * CRAB_PX);
      expect(shut.pupils[side].y).toBe(open.pupils[side].y + CRAB_PX);
    }
    for (const face of ["happy", "sleepy"]) expect(crabEyeDraw(face).pupils[0].w).toBeLessThan(shut.pupils[0].w);
    expect(crabExpressionForMood("sleeping")).toBe("asleep");
  });

  it("breathes slowly, one whole cell, with the eyes drawn closed and never blinked away", () => {
    const ys = new Set<string>();
    for (let t = 0; t <= 4.2; t += 0.1) {
      const pose = crabMoveAt("sleep", t, true);
      expect(pose.expression).toBe("asleep");
      const transforms = crabTransforms({ ...pose, blink: 1 });
      expect(transforms.eyeL).toContain("scale(1 1.000)");
      ys.add(/translate\(0 (-?\d+)\)/.exec(transforms.whole)?.[1] ?? "?");
    }
    expect([...ys].sort()).toEqual([String(-CRAB_PX), "0"].sort());
    expect(crabReducedFace("sleep")?.expression).toBe("asleep");
  });

  it("shows the closed eyes on the app's avatars too (the CSS idle, sleeping)", () => {
    const html = renderToStaticMarkup(createElement(CrabMascot, { color: "orange", size: 64, mood: "sleeping" }));
    expect(html).toContain("crab-mood-sleeping");
    expect(html).toContain('data-expression="asleep"');
  });
});
