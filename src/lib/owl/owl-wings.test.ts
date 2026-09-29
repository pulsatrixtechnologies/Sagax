import { afterEach, describe, expect, it, vi } from "vitest";

import {
  OWL_BLACK_PALETTE,
  OWL_BLACK_RIM,
  OWL_WING_MOVES,
  OWL_WING_MOVE_MS,
  farWingOpacity,
  isBlackOwlColor,
  owlPalette,
  owlPose,
  owlRim,
  owlWingPose,
  wingTransform,
} from "./owl-art";
import { createOwlController, type OwlRigElements } from "./owl-loop";
import { MAUS_COLORS, MAUS_COLOR_NAMES } from "@/lib/mascot";

describe("the black owl", () => {
  it("has its own charcoal palette and keeps the cream face and yellow eye", () => {
    const palette = owlPalette(MAUS_COLORS.black);
    expect(palette).toMatchObject(OWL_BLACK_PALETTE);
    expect(palette.cream).toBe("#F6F1E8");
    expect(palette.iris).toBe("#F8CA48");
    expect(owlPalette(MAUS_COLORS.black, "dark")).toMatchObject(OWL_BLACK_PALETTE);
  });

  it("is the only bot color with a rim light", () => {
    expect(isBlackOwlColor(MAUS_COLORS.black)).toBe(true);
    expect(owlRim(MAUS_COLORS.black)).toBe(OWL_BLACK_RIM);
    for (const name of MAUS_COLOR_NAMES.filter((color) => color !== "black")) {
      expect(owlRim(MAUS_COLORS[name])).toBeNull();
    }
  });
});

describe("wing moves", () => {
  it("rests folded: every state's pose keeps the wings closed", () => {
    for (const state of ["idle", "thinking", "working", "success", "alert", "sleepy"] as const) {
      expect(owlPose(state, 0.4).open).toBe(0);
    }
  });

  it("keeps the folded near wing on the exact transform the traced art always had", () => {
    expect(wingTransform(0, 0)).toBe(wingTransform(0));
    expect(wingTransform(0)).toBe("translate(104.8px,131.7px) rotate(0.00deg) translate(-104.8px,-131.7px)");
    expect(farWingOpacity(0)).toBe(0);
  });

  it.each(OWL_WING_MOVES)("%s opens the wings, then folds them and finishes", (move) => {
    const end = OWL_WING_MOVE_MS[move] / 1000;
    const peak = Math.max(...Array.from({ length: 60 }, (_, i) => owlWingPose(move, (end * i) / 60).open));
    expect(peak).toBeGreaterThan(0.25);
    expect(peak).toBeLessThanOrEqual(1);
    expect(owlWingPose(move, 0).open).toBeLessThan(0.05);
    expect(owlWingPose(move, end - 0.001).open).toBeLessThan(0.05);
    expect(owlWingPose(move, end).done).toBe(true);
  });

  it("spreads fully open and takes off above the ground", () => {
    expect(owlWingPose("spread", 0.8).open).toBeGreaterThan(0.95);
    expect(owlWingPose("takeoff", 1.1).y).toBeLessThan(-20);
    // small avatars rise less
    expect(owlWingPose("takeoff", 1.1, 0.35).y).toBeGreaterThan(owlWingPose("takeoff", 1.1).y);
  });
});

describe("wings in the shared loop", () => {
  const frames: FrameRequestCallback[] = [];
  const el = (): SVGGElement => ({ style: { transform: "", opacity: "" } }) as unknown as SVGGElement;
  const rig = (): OwlRigElements => ({
    rig: el(),
    nearWing: el(),
    eyes: el(),
    pupil: el(),
    lids: el(),
    farWing: el(),
    nearWingBack: el(),
  });
  const step = (ms: number) => frames.shift()?.(ms);

  afterEach(() => {
    vi.unstubAllGlobals();
    frames.length = 0;
  });

  it("opens both wings during a move and folds them again after", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const els = rig();
    const c = createOwlController(els, { reducedMotion: false });
    step(1000);
    c.flourish("spread");
    step(1100); // the move starts on this frame
    step(1900); // wide open
    expect(els.farWing!.style.opacity).toBe("1");
    expect(els.nearWing.style.transform).toContain("scale(");
    expect(els.nearWingBack!.style.transform).toBe(els.nearWing.style.transform);
    step(3200); // done
    step(3300);
    expect(els.farWing!.style.opacity).toBe("0");
    expect(els.nearWing.style.transform).toBe(wingTransform(0));
    c.destroy();
  });

  it("keeps the wings folded under reduced motion", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const els = rig();
    const c = createOwlController(els, { reducedMotion: true });
    step(1000);
    c.flourish("takeoff");
    step(1100);
    step(1800);
    expect(els.nearWing.style.transform).toBe("");
    expect(els.rig.style.transform).toBe("");
    expect(els.farWing!.style.opacity).not.toBe("1");
    c.destroy();
  });
});
