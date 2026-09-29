import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OwlAvatar, type OwlAvatarProps } from "./OwlAvatar";
import { MAUS_COLORS } from "@/lib/mascot";
import {
  OWL_BLACK_PALETTE,
  OWL_BLACK_RIM,
  OWL_DETAIL_MIN_SIZE,
  OWL_REFERENCE,
  OWL_WHITE_PALETTE,
  OWL_TRACE,
  wingTransform,
  gazeToOffset,
  owlPalette,
  owlPose,
  poseTransforms,
  shade,
} from "@/lib/owl/owl-art";
import { createOwlController, runningOwlCount, type OwlRigElements } from "@/lib/owl/owl-loop";

const render = (props: Partial<OwlAvatarProps>) =>
  renderToStaticMarkup(createElement(OwlAvatar, { color: "green", animated: false, ...props }));

/** The fills of every <path> inside a data-part group (first match). */
function partFills(markup: string, part: string): string[] {
  const start = markup.indexOf(`data-part="${part}"`);
  expect(start).toBeGreaterThan(-1);
  const chunk = markup.slice(start, markup.indexOf("</g>", start));
  return [...chunk.matchAll(/<path fill="([^"]+)"/g)].map((m) => m[1]);
}

describe("OwlAvatar", () => {
  it("paints the plumage in the bot's own color, flat, with the vivid wing and socket", () => {
    const markup = render({ color: "blue" });
    const blue = MAUS_COLORS.blue;
    expect(partFills(markup, "body")[0]).toBe(blue);
    expect(partFills(markup, "nearWing")).toEqual([shade(blue, 0.3)]);
    expect(partFills(markup, "socket")).toEqual([shade(blue, 0.7)]);
    // flat fills only
    expect(markup).not.toContain("Gradient");
    expect(markup).not.toContain("<stop");
    expect(markup).not.toContain("filter");
  });

  it("accepts a hex as well as a color name", () => {
    expect(partFills(render({ color: "#D94B52" }), "body")[0]).toBe("#D94B52");
  });

  it("gives the white bot its own light-grey palette so the face still reads", () => {
    const markup = render({ color: "white" });
    expect(partFills(markup, "body")[0]).toBe(OWL_WHITE_PALETTE.plumage);
    expect(partFills(markup, "nearWing")).toEqual([OWL_WHITE_PALETTE.wingNear]);
    expect(partFills(markup, "socket")).toEqual([OWL_WHITE_PALETTE.socket]);
    expect(markup).not.toContain(`fill="${MAUS_COLORS.white}"`);
    expect(owlPalette(MAUS_COLORS.white)).toMatchObject(OWL_WHITE_PALETTE);
  });

  it("gives the black bot its charcoal palette and a rim light; no other color gets a rim", () => {
    const markup = render({ color: "black", size: 112 });
    expect(partFills(markup, "body")[0]).toBe(OWL_BLACK_PALETTE.plumage);
    expect(markup).toContain('data-part="rim"');
    expect(markup).toContain(`stroke="${OWL_BLACK_RIM}"`);
    // the eye stays the reference yellow so it reads on the dark plumage
    expect(markup).toContain(`fill="${OWL_REFERENCE.iris}"`);
    expect(render({ color: "green" })).not.toContain("data-part=\"rim\"");
    expect(render({ color: "white" })).not.toContain("stroke=");
  });

  it("rests with the wings folded: the far wing hidden and the near wing where it was traced", () => {
    const markup = render({ size: 112 });
    expect(markup).toMatch(/data-part="farWing" style="transform:[^"]*;opacity:0"/);
    expect(markup).toContain(`data-part="nearWing" style="transform:${wingTransform(0)}"`);
  });

  it("can pin the wings open for a preview", () => {
    const markup = render({ size: 112, wings: 1 });
    expect(markup).toMatch(/data-part="farWing" style="transform:[^"]*;opacity:1"/);
    expect(markup).toContain(`data-part="nearWing" style="transform:${wingTransform(0, 1)}"`);
  });

  it("gives every instance its own clip-path id and points each lid at its own", () => {
    const markup = renderToStaticMarkup(
      createElement(
        Fragment,
        null,
        createElement(OwlAvatar, { color: "green", animated: false }),
        createElement(OwlAvatar, { color: "green", animated: false }),
      ),
    );
    const ids = [...markup.matchAll(/<clipPath id="([^"]+)"/g)].map((m) => m[1]);
    const refs = [...markup.matchAll(/clip-path="url\(#([^)]+)\)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(refs).toEqual(ids);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("draws the resting pose once when animated=false and joins no loop", () => {
    const markup = render({ state: "sleepy", size: 72 });
    const pose = owlPose("sleepy", 0);
    const still = poseTransforms(pose, gazeToOffset(pose.gaze));
    expect(markup).toContain(`transform:${still.lids}`);
    expect(markup).toContain(`transform:${still.rig}`);
    expect(runningOwlCount()).toBe(0);
  });

  it("lets the hop overflow its box", () => {
    expect(render({})).toContain("overflow:visible");
  });

  it("drops the belly spots below the detail size and keeps them above", () => {
    expect(render({ size: OWL_DETAIL_MIN_SIZE - 1 })).not.toContain('data-part="spots"');
    expect(render({ size: OWL_DETAIL_MIN_SIZE })).toContain('data-part="spots"');
  });

  it("is decorative without a label and an image with one", () => {
    expect(render({})).toContain('aria-hidden="true"');
    const labelled = render({ label: "Atlas" });
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Atlas"');
  });
});

describe("OwlAvatar skins", () => {
  it("adds nothing for none, and reads an unknown skin as none", () => {
    const plain = render({ size: 112 });
    expect(plain).not.toContain("data-owl-skin");
    expect(plain).not.toContain("owl-fx");
    expect(render({ size: 112, skin: "plasma" })).toBe(plain);
  });

  it("dresses a large owl in lightning: arcs, a flash, glowing eyes, live effects", () => {
    const markup = render({ color: "black", skin: "lightning", size: 112, skinAnimated: true });
    expect(markup).toContain('data-owl-skin="lightning"');
    expect(markup).toContain('data-owl-fx="live"');
    expect(markup.match(/class="owl-fx-crackle"/g)?.length).toBeGreaterThanOrEqual(6);
    expect(markup).toContain('class="owl-fx-flash"');
    expect(markup).toContain('data-part="eyeGlow"');
    // the shape is the same owl: the plumage path is untouched
    expect(markup).toContain(`d="${OWL_TRACE.layers[0].d[0]}"`);
  });

  it("keeps small avatars to a tint and an aura, still", () => {
    const markup = render({ skin: "lightning", size: OWL_DETAIL_MIN_SIZE - 8, skinAnimated: true });
    expect(markup).toContain('data-owl-fx="still"');
    expect(markup).toContain("-aura)");
    expect(markup).not.toContain("owl-fx-crackle");
    expect(markup).not.toContain('data-part="eyeGlow"');
  });

  it("holds the effects still under reduced motion or when not animated", () => {
    expect(render({ skin: "inferno", size: 112, skinAnimated: true, reducedMotion: true })).toContain('data-owl-fx="still"');
    expect(render({ skin: "inferno", size: 112 })).toContain('data-owl-fx="still"');
  });

  it.each(["gold", "neon", "inferno", "frost", "carbon"] as const)("renders %s at full size", (skin) => {
    const markup = render({ skin, size: 112 });
    expect(markup).toContain(`data-owl-skin="${skin}"`);
    expect(markup).toContain('data-part="skinBack"');
  });
});

describe("the shared owl loop", () => {
  const frames: FrameRequestCallback[] = [];
  const el = (): SVGGElement => ({ style: { transform: "" } }) as unknown as SVGGElement;
  const rig = (): OwlRigElements => ({ rig: el(), nearWing: el(), eyes: el(), pupil: el(), lids: el() });
  const step = (ms: number) => {
    const cb = frames.shift();
    cb?.(ms);
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    frames.length = 0;
  });

  it("drives many owls from one requestAnimationFrame and stops when the last leaves", () => {
    const raf = vi.fn((cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const a = createOwlController(rig(), { reducedMotion: false });
    const b = createOwlController(rig(), { reducedMotion: false });
    expect(runningOwlCount()).toBe(2);
    expect(raf).toHaveBeenCalledTimes(1);
    a.destroy();
    b.destroy();
    expect(runningOwlCount()).toBe(0);
  });

  it("plays success once and settles back to the resting state", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const els = rig();
    const c = createOwlController(els, { reducedMotion: false });
    c.play("success");
    step(1000);
    step(1300); // mid-hop: the rig is lifted
    expect(els.rig.style.transform).toMatch(/^translate\(0\.00px,-\d/);
    step(2200); // done
    step(4000); // idle again: feet planted
    expect(els.rig.style.transform).toMatch(/^translate\(0\.00px,0\.00px\)/);
    c.destroy();
  });

  it("keeps only the blinks under reduced motion", () => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const els = rig();
    const c = createOwlController(els, { state: "working", reducedMotion: true });
    step(1000);
    c.blink();
    step(1050); // the blink starts on this frame
    step(1110); // and is part-way closed on this one
    expect(els.rig.style.transform).toBe("");
    expect(els.nearWing.style.transform).toBe("");
    expect(els.lids.style.transform).toContain("scale(1,");
    expect(els.lids.style.transform).not.toContain("scale(1,0.000)");
    c.destroy();
  });
});
