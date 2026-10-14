import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  ICO_SIZES,
  ICONSET,
  IOS_VARIANTS,
  LARGE,
  MARK_SOURCE,
  SMALL,
  SVG_SOURCES,
  buildIco,
  composeIconSvg,
  encodeRgbPng,
  markTransform,
  readMark,
  syncSources,
} from "./app-icon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

/** Width, height and PNG colour type (2 RGB, 6 RGBA). */
function pngInfo(buffer) {
  expect(buffer.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { size: [buffer.readUInt32BE(16), buffer.readUInt32BE(20)], colourType: buffer.readUInt8(25) };
}

describe("Pulsatrix app icon", () => {
  const mark = readMark(root);

  it("composes every SVG source from the official Pulsatrix mark", () => {
    const brand = fs.readFileSync(path.join(root, MARK_SOURCE), "utf8");
    for (const d of [mark.outline, mark.accent, mark.shade]) expect(brand).toContain(d);
    expect(SVG_SOURCES).toEqual(
      expect.arrayContaining(["build/icon-pulsatrix.svg", "build/icon.svg", "public/app-icon.svg", "ios/AppStore/app-icon-ios.svg"]),
    );
    expect(syncSources(root, { check: true })).toEqual([]);
    const master = fs.readFileSync(path.join(root, "build/icon-pulsatrix.svg"), "utf8");
    expect(master).toContain(mark.outline);
    expect(master).toContain('fill="#FFFFFF"');
    expect(master).toContain('fill="#3466DC"');
    expect(master).toMatch(/<rect width="1024" height="1024" rx="230.4"/);
    expect(fs.readFileSync(path.join(root, "build/icon.svg"), "utf8")).toBe(master);
    expect(fs.readFileSync(path.join(root, "public/app-icon.svg"), "utf8")).toBe(master);
    // iOS masks the corners itself: a full, opaque square
    const ios = fs.readFileSync(path.join(root, "ios/AppStore/app-icon-ios.svg"), "utf8");
    expect(ios).not.toMatch(/rx=/);
    expect(ios).toContain(mark.accent);
  });

  it("no longer draws the Sagax owl as the default, and keeps it for the picker", () => {
    for (const rel of ["build/icon-pulsatrix.svg", "build/icon.svg", "public/app-icon.svg"]) {
      expect(fs.readFileSync(path.join(root, rel), "utf8"), rel).not.toContain("156.56");
    }
    const owl = fs.readFileSync(path.join(root, "public/brand/sagax-owl-app-icon.svg"), "utf8");
    expect(owl).toContain("translate(-156.56 -79.72)");
  });

  it("thickens the mark only at small sizes, without changing the large drawing", () => {
    const large = composeIconSvg(mark);
    const small = composeIconSvg(mark, { small: true });
    expect(large).not.toContain("stroke-width");
    expect(large).toContain(markTransform(LARGE));
    expect(small).toContain(`stroke-width="${SMALL.outlineStroke}"`);
    expect(small).toContain(`stroke-width="${SMALL.accentStroke}"`);
    expect(SMALL.width).toBeGreaterThan(LARGE.width);
  });

  it("keeps the Icon Composer groups pointing at the generated layers", () => {
    const icon = JSON.parse(fs.readFileSync(path.join(root, "build/icon.icon/icon.json"), "utf8"));
    const layers = icon.groups.flatMap((group) => group.layers.map((layer) => layer.name));
    expect(layers).toEqual(["accent", "outline"]);
    for (const group of icon.groups) {
      for (const layer of group.layers) expect(SVG_SOURCES).toContain(`build/icon.icon/Assets/${layer["image-name"]}`);
    }
    expect(fs.readdirSync(path.join(root, "build/icon.icon/Assets")).sort()).toEqual(["accent.svg", "outline.svg"]);
    expect(icon.fill.solid).toMatch(/^srgb:/);
  });

  it("ships raster outputs at the sizes the platforms read", () => {
    expect(pngInfo(fs.readFileSync(path.join(root, "build/icon-1024.png"))).size).toEqual([1024, 1024]);
    expect(fs.readFileSync(path.join(root, "electron/resources/app-icon.png"))).toEqual(fs.readFileSync(path.join(root, "build/icon-1024.png")));
    for (const [name, size] of ICONSET) {
      expect(pngInfo(fs.readFileSync(path.join(root, "build/icon.iconset", name))).size, name).toEqual([size, size]);
    }
    const ico = fs.readFileSync(path.join(root, "build/icon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(ICO_SIZES.length);
    expect(fs.readFileSync(path.join(root, "build/icon.icns")).subarray(0, 4).toString("latin1")).toBe("icns");
    for (const size of [192, 512]) expect(pngInfo(fs.readFileSync(path.join(root, `public/app-icon-${size}.png`))).size).toEqual([size, size]);
  });

  it("ships the iOS and apple-touch icons opaque, without an alpha channel", () => {
    expect(pngInfo(fs.readFileSync(path.join(root, "public/apple-touch-icon.png")))).toEqual({ size: [180, 180], colourType: 2 });
    const catalog = JSON.parse(fs.readFileSync(path.join(root, "ios/App/Assets.xcassets/AppIcon.appiconset/Contents.json"), "utf8"));
    expect(catalog.images.map((image) => image.filename).sort()).toEqual(Object.keys(IOS_VARIANTS).sort());
    for (const name of Object.keys(IOS_VARIANTS)) {
      expect(pngInfo(fs.readFileSync(path.join(root, "ios/App/Assets.xcassets/AppIcon.appiconset", name))), name).toEqual({ size: [1024, 1024], colourType: 2 });
    }
  });

  it("encodes RGBA pixels as an RGB PNG", () => {
    const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 8, 7, 255]);
    const png = encodeRgbPng(2, 2, rgba);
    expect(pngInfo(png)).toEqual({ size: [2, 2], colourType: 2 });
    const idatLength = png.readUInt32BE(33);
    expect(png.toString("latin1", 37, 41)).toBe("IDAT");
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect([...raw]).toEqual([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 9, 8, 7]);
    expect(() => encodeRgbPng(2, 2, Buffer.alloc(3))).toThrow();
  });

  it("packs PNG entries into an ico directory", () => {
    const png = (size) => {
      const buffer = Buffer.alloc(24);
      Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(buffer);
      buffer.writeUInt32BE(size, 16);
      buffer.writeUInt32BE(size, 20);
      return buffer;
    };
    const ico = buildIco([{ size: 16, png: png(16) }, { size: 256, png: png(256) }]);
    expect(ico.readUInt16LE(4)).toBe(2);
    expect(ico.readUInt8(6)).toBe(16);
    expect(ico.readUInt8(6 + 16)).toBe(0);
    expect(ico.readUInt32LE(6 + 12)).toBe(6 + 32);
    expect(ico.readUInt32LE(6 + 16 + 12)).toBe(6 + 32 + 24);
    expect(ico.length).toBe(6 + 32 + 48);
  });

  it("rewrites a stale source and reports it", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omb-app-icon-"));
    temporaryDirectories.push(directory);
    fs.mkdirSync(path.join(directory, path.dirname(MARK_SOURCE)), { recursive: true });
    fs.copyFileSync(path.join(root, MARK_SOURCE), path.join(directory, MARK_SOURCE));
    expect(syncSources(directory, { check: true })).toEqual([...SVG_SOURCES]);
    expect(fs.existsSync(path.join(directory, "build/icon.svg"))).toBe(false);
    expect(syncSources(directory)).toEqual([...SVG_SOURCES]);
    expect(syncSources(directory, { check: true })).toEqual([]);
    fs.writeFileSync(path.join(directory, "build/icon.svg"), "<svg/>");
    expect(syncSources(directory, { check: true })).toEqual(["build/icon.svg"]);
    expect(syncSources(directory)).toEqual(["build/icon.svg"]);
    expect(fs.readFileSync(path.join(directory, "build/icon.svg"), "utf8")).toBe(fs.readFileSync(path.join(root, "build/icon.svg"), "utf8"));
  });
});
