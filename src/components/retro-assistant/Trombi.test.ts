import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Trombi, TROMBI_ASPECT } from "./Trombi";
import { POSE_SHAPES, TROMBI_POSES, type TrombiPose } from "./trombi-art";

const draw = (pose: TrombiPose, extra: Record<string, unknown> = {}) => renderToStaticMarkup(createElement(Trombi, { pose, ...extra }));

describe("Trombi", () => {
  it("draws every pose with the same parts: paper, wire, eyes and brows", () => {
    for (const pose of TROMBI_POSES) {
      const markup = draw(pose);
      expect(markup, pose).toContain(`data-pose="${pose}"`);
      expect(markup, pose).toContain(`r98t-pose-${pose}`);
      for (const part of ["paper", "body", "wire", "face", "eyes", "eye-L", "eye-R", "brows", "brow-L", "brow-R"]) {
        expect(markup, `${pose} ${part}`).toContain(`data-part="${part}"`);
      }
    }
  });

  it("moves the pupils and the brows per state", () => {
    const idle = draw("idle");
    const think = draw("think");
    expect(idle).toContain(`translate(${POSE_SHAPES.idle.pupil[0]} ${POSE_SHAPES.idle.pupil[1]})`);
    expect(think).toContain(`translate(${POSE_SHAPES.think.pupil[0]} ${POSE_SHAPES.think.pupil[1]})`);
    expect(think).toContain(POSE_SHAPES.think.browL);
    expect(POSE_SHAPES.think.browL).not.toBe(POSE_SHAPES.idle.browL);
    expect(new Set(TROMBI_POSES.map((pose) => POSE_SHAPES[pose].pupil.join(","))).size).toBe(TROMBI_POSES.length);
  });

  it("adds each state's own extras and nothing else", () => {
    expect(draw("idle")).not.toContain('data-part="fx"');
    expect(draw("speak")).not.toContain('data-part="fx"');
    expect(draw("think")).toContain("r98t-dot");
    expect(draw("sleep")).toContain("r98t-z");
    expect(draw("celebrate")).toContain("r98t-spark");
    const send = draw("send");
    expect(send).toContain("r98t-envelope");
    expect(send).toContain("r98t-sheet");
  });

  it("freezes on a still frame when motion is reduced", () => {
    expect(draw("celebrate", { still: true })).toContain("r98t-still");
    expect(draw("celebrate")).not.toContain("r98t-still");
    const css = readFileSync(new URL("./trombi.css", import.meta.url), "utf8");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.r98-trombi \*[^}]*\{\s*animation: none !important;/);
    expect(css).toMatch(/\.r98t-still \*\s*\{\s*animation: none !important;/);
  });

  it("keeps two copies on one page from sharing gradient ids", () => {
    const markup = renderToStaticMarkup(createElement("div", null, createElement(Trombi, { pose: "idle" }), createElement(Trombi, { pose: "idle" })));
    const ids = [...markup.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is labelled, or hidden from assistive tech when drawn as decoration", () => {
    expect(draw("idle")).toContain('role="img" aria-label="Trombi"');
    const hidden = draw("idle", { label: null });
    expect(hidden).toContain('aria-hidden="true"');
    expect(hidden).not.toContain("role=");
  });

  it("keeps the drawing's proportions at any width", () => {
    const markup = draw("idle", { size: 110 });
    expect(markup).toContain('width="110"');
    expect(markup).toContain(`height="${Math.round(110 / TROMBI_ASPECT)}"`);
  });
});
