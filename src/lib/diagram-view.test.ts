import { describe, expect, it } from "vitest";
import {
  DIAGRAM_MAX_HEIGHT_PX,
  DIAGRAM_ZOOM_MAX,
  clampZoom,
  exportFileName,
  exportableMermaidSource,
  fitTransform,
  inlineDiagramMaxHeight,
  inlineDiagramSize,
  standaloneSvg,
  svgSize,
  zoomAt,
} from "./diagram-view";

const MERMAID = '<svg id="m1" width="100%" xmlns="http://www.w3.org/2000/svg" style="max-width: 812.5px;" viewBox="0 0 812.5 300" role="graphics-document"><g/></svg>';

describe("svgSize", () => {
  it("reads the viewBox first", () => {
    expect(svgSize(MERMAID)).toEqual({ width: 812.5, height: 300 });
  });
  it("falls back to numeric width and height, never percentages", () => {
    expect(svgSize('<svg width="120px" height="40"></svg>')).toEqual({ width: 120, height: 40 });
    expect(svgSize('<svg width="100%" height="40"></svg>')).toBeNull();
    expect(svgSize("<div></div>")).toBeNull();
    expect(svgSize('<svg viewBox="0 0 0 10"></svg>')).toBeNull();
  });
});

describe("inlineDiagramSize", () => {
  it("scales a wide diagram down to the column width, keeping the ratio", () => {
    const size = inlineDiagramSize({ width: 1600, height: 400 }, 800, 600);
    expect(size).toMatchObject({ width: 800, height: 200, scale: 0.5 });
  });
  it("caps a tall diagram's height and shrinks its width with it", () => {
    const size = inlineDiagramSize({ width: 400, height: 2000 }, 800, 500);
    expect(size.height).toBe(500);
    expect(size.width).toBe(100);
    expect(size.scale).toBe(0.25);
  });
  it("never upscales a small diagram past its natural size", () => {
    expect(inlineDiagramSize({ width: 200, height: 100 }, 900, 600)).toEqual({ width: 200, height: 100, scale: 1, cramped: false });
  });
  it("flags a fit that makes the text too small to read", () => {
    expect(inlineDiagramSize({ width: 3000, height: 500 }, 600, 600).cramped).toBe(true);
    expect(inlineDiagramSize({ width: 900, height: 500 }, 600, 600).cramped).toBe(false);
  });
  it("follows the container when it narrows (sidebar, side panel, window)", () => {
    const natural = { width: 1000, height: 500 };
    const wide = inlineDiagramSize(natural, 1000, 800);
    const narrow = inlineDiagramSize(natural, 500, 800);
    expect(wide.width).toBe(1000);
    expect(narrow.width).toBe(500);
    expect(narrow.height).toBe(250);
  });
  it("handles an empty diagram and an unmeasured container", () => {
    expect(inlineDiagramSize({ width: 0, height: 0 }, 500, 500)).toMatchObject({ width: 0, height: 0 });
    expect(inlineDiagramSize({ width: 300, height: 100 }, 0, 0)).toMatchObject({ width: 300, height: 100, scale: 1 });
  });
});

describe("inlineDiagramMaxHeight", () => {
  it("is 60 % of the window height, at least 200 px, with a fallback", () => {
    expect(inlineDiagramMaxHeight(1000)).toBe(600);
    expect(inlineDiagramMaxHeight(200)).toBe(200);
    expect(inlineDiagramMaxHeight(undefined)).toBe(DIAGRAM_MAX_HEIGHT_PX);
  });
});

describe("pan and zoom", () => {
  it("fits and centers the diagram in the viewport", () => {
    const view = fitTransform({ width: 1000, height: 500 }, { width: 1048, height: 800 }, 24);
    expect(view.scale).toBe(1);
    expect(view.x).toBe(24);
    expect(view.y).toBe(150);
  });
  it("zooms around the pointer so that point stays put", () => {
    const view = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 });
    expect(view).toEqual({ scale: 2, x: -100, y: -50 });
    // the point under the pointer maps to the same content point
    expect((100 - view.x) / view.scale).toBe(100);
  });
  it("clamps the zoom", () => {
    expect(clampZoom(100)).toBe(DIAGRAM_ZOOM_MAX);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe("export", () => {
  it("writes a standalone SVG with its natural size", () => {
    const out = standaloneSvg(MERMAID);
    expect(out.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(out).toContain('width="812.5" height="300"');
    expect(out).not.toContain("100%");
    expect(out).not.toContain("max-width");
    expect(out.match(/xmlns="/g)).toHaveLength(1);
    expect(standaloneSvg('<svg viewBox="0 0 10 10"><use xlink:href="#a"/></svg>')).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
  });
  it("turns HTML labels off for the PNG render, after any front matter", () => {
    expect(exportableMermaidSource("graph TD\nA-->B")).toMatch(/^%%\{init: \{"htmlLabels": false/);
    const front = exportableMermaidSource("---\ntitle: Flux\n---\ngraph TD\nA-->B");
    expect(front.startsWith("---\ntitle: Flux\n---\n%%{init:")).toBe(true);
    expect(front.endsWith("graph TD\nA-->B")).toBe(true);
  });
  it("names files safely", () => {
    expect(exportFileName("a/b:c", "png")).toBe("a_b_c.png");
    expect(exportFileName("  ", "svg")).toBe("diagram.svg");
  });
});
