import { describe, expect, it } from "vitest";
import {
  APP_ICON_TEMPLATES,
  appIconMaskPath,
  appIconPlatform,
  artworkRect,
  continuousRectPath,
  flattenPath,
  insideMask,
  pathToSvg,
} from "./app-icon-template";
import { appIconHintKey, appIconTargets, APP_ICON_CHOICES, DEFAULT_APP_ICON_ID, primaryBotChoice, UPLOAD_APP_ICON } from "../src/lib/app-icon-choices";

const bounds = (points: Array<[number, number]>) => ({
  minX: Math.min(...points.map((p) => p[0])),
  maxX: Math.max(...points.map((p) => p[0])),
  minY: Math.min(...points.map((p) => p[1])),
  maxY: Math.max(...points.map((p) => p[1])),
});

describe("macOS icon template (Big Sur and later)", () => {
  const mac = APP_ICON_TEMPLATES.macos;
  const mask = appIconMaskPath(mac);

  it("uses Apple's grid: a 1024 canvas, an 824 body, a 100 px margin", () => {
    expect(mac).toMatchObject({ canvas: 1024, body: 824, inset: 100 });
    expect(mac.inset * 2 + mac.body).toBe(mac.canvas);
    expect(mac.radius).toBeCloseTo(185.4, 1);
    expect(mac.sizes).toEqual([1024]);
    expect(mac.shadow).not.toBeNull();
  });

  it("keeps the body inside the margin, edge to edge on the grid", () => {
    const box = bounds(flattenPath(mask));
    expect(box.minX).toBeCloseTo(100, 6);
    expect(box.minY).toBeCloseTo(100, 6);
    expect(box.maxX).toBeCloseTo(924, 6);
    expect(box.maxY).toBeCloseTo(924, 6);
  });

  it("masks the corners and the margin, keeps the centre and the edges' middles", () => {
    expect(insideMask(mask, 512, 512)).toBe(true);
    for (const [x, y] of [[101, 512], [923, 512], [512, 101], [512, 923]]) expect(insideMask(mask, x, y)).toBe(true);
    for (const [x, y] of [[50, 512], [512, 50], [980, 512], [512, 990]]) expect(insideMask(mask, x, y)).toBe(false);
    // the corners are cut: the body's own corner pixels are outside
    for (const [x, y] of [[104, 104], [920, 104], [104, 920], [920, 920]]) expect(insideMask(mask, x, y)).toBe(false);
  });

  it("draws a continuous corner, not a circular arc", () => {
    // The straight edge stops ~1.53 radii from the corner (a circle's would
    // stop at exactly one radius), so the curve eases in without a step.
    const [move, edge] = mask;
    expect(move).toMatchObject({ op: "M", y: 100 });
    expect(edge.op).toBe("L");
    if (edge.op !== "L") return;
    expect(924 - edge.x).toBeCloseTo(1.52866 * 185.4, 1);
    // at 45° it runs close to a circular arc of the same radius
    const r = 185.4;
    const arcX = 924 - r + r * Math.SQRT1_2;
    const arcY = 100 + r - r * Math.SQRT1_2;
    expect(insideMask(mask, arcX - 12, arcY + 12)).toBe(true);
    expect(insideMask(mask, arcX + 12, arcY - 12)).toBe(false);
    // and is symmetric about the diagonal
    expect(insideMask(mask, 920, 140)).toBe(insideMask(mask, 884, 104));
  });

  it("scales to any size and writes an SVG path", () => {
    const half = bounds(flattenPath(appIconMaskPath(mac, 512)));
    expect(half.minX).toBeCloseTo(50, 6);
    expect(half.maxX).toBeCloseTo(462, 6);
    expect(pathToSvg(mask)).toMatch(/^M[\d.]+ 100L.*Z$/);
  });

  it("never lets an oversized radius cross the edges", () => {
    const pill = flattenPath(continuousRectPath(0, 0, 100, 100, 999));
    const box = bounds(pill);
    expect(box.minX).toBeGreaterThanOrEqual(-1e-9);
    expect(box.maxX).toBeLessThanOrEqual(100 + 1e-9);
  });

  it("centres a mascot with a margin and lets a photo fill the body", () => {
    const art = artworkRect(mac, 1024, { width: 310, height: 380 }, "contain");
    expect(art.x + art.width / 2).toBeCloseTo(512, 6);
    expect(art.y + art.height / 2).toBeCloseTo(512, 6);
    expect(art.height).toBeLessThan(mac.body);
    const photo = artworkRect(mac, 1024, { width: 1600, height: 900 }, "cover");
    expect(photo.height).toBeCloseTo(mac.body, 6);
    expect(photo.width).toBeGreaterThan(mac.body);
  });
});

describe("platform branching", () => {
  it("maps Electron platforms to templates and sizes", () => {
    expect(appIconPlatform("darwin")).toBe("macos");
    expect(appIconPlatform("win32")).toBe("windows");
    expect(appIconPlatform("linux")).toBe("linux");
    expect(appIconTargets("darwin").sizes).toEqual([1024]);
    // the .ico holds every size the Windows shell asks for, up to 256
    expect(appIconTargets("win32").sizes).toEqual([16, 20, 24, 32, 40, 48, 64, 256]);
    expect(appIconTargets("win32").template.inset).toBe(0);
    expect(appIconTargets("linux").sizes).toEqual([512]);
  });

  it("explains on macOS that Finder and Launchpad keep the bundle icon", () => {
    expect(appIconHintKey("darwin")).toBe("settings.appIcon.hintMac");
    expect(appIconHintKey("win32")).toBe("settings.appIcon.hintWindows");
    expect(appIconHintKey("linux")).toBe("settings.appIcon.hintLinux");
  });
});

describe("app icon choices", () => {
  it("starts with the default and offers owl skins, a shape and Trombi", () => {
    expect(APP_ICON_CHOICES[0].id).toBe(DEFAULT_APP_ICON_ID);
    const kinds = new Set(APP_ICON_CHOICES.map((choice) => choice.art.kind));
    for (const kind of ["default", "owl", "shape", "trombi"]) expect(kinds.has(kind as never)).toBe(true);
    const ids = APP_ICON_CHOICES.map((choice) => choice.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of [...ids, UPLOAD_APP_ICON.id, "primary"]) expect(id).toMatch(/^[a-z0-9][a-z0-9:._-]{0,63}$/);
  });

  it("adds the Primary Bot only when there is one", () => {
    expect(primaryBotChoice(null)).toBeNull();
    expect(primaryBotChoice({ id: "b1" })).toMatchObject({ id: "primary", art: { kind: "primary", botId: "b1" } });
  });
});
