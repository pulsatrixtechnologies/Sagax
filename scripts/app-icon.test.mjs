import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ICO_SIZES, ICONSET, OWL_TRANSFORM, SVG_SOURCES, buildIco, syncSources } from "./app-icon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function pngSize(buffer) {
  expect(buffer.subarray(1, 4).toString("latin1")).toBe("PNG");
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

describe("owl app icon", () => {
  it("draws the owl upright, with the same placement in every SVG source", () => {
    expect(OWL_TRANSFORM).not.toMatch(/rotate/);
    for (const rel of SVG_SOURCES) {
      const svg = fs.readFileSync(path.join(root, rel), "utf8");
      expect(svg, rel).not.toMatch(/rotate\(/);
      expect(svg, rel).toContain(`<g transform="${OWL_TRANSFORM}">`);
    }
    expect(syncSources(root, { check: true })).toEqual([]);
  });

  it("keeps the Icon Composer glass groups pointing at the regenerated layers", () => {
    const icon = JSON.parse(fs.readFileSync(path.join(root, "build/icon.icon/icon.json"), "utf8"));
    const layers = icon.groups.flatMap((group) => group.layers.map((layer) => layer.name));
    expect(layers).toEqual(["eye", "details", "face", "plumage"]);
    for (const group of icon.groups) {
      for (const layer of group.layers) {
        expect(SVG_SOURCES).toContain(`build/icon.icon/Assets/${layer["image-name"]}`);
      }
    }
  });

  it("ships raster outputs at the sizes the platforms read", () => {
    expect(pngSize(fs.readFileSync(path.join(root, "build/icon-1024.png")))).toEqual([1024, 1024]);
    expect(fs.readFileSync(path.join(root, "electron/resources/app-icon.png"))).toEqual(
      fs.readFileSync(path.join(root, "build/icon-1024.png")),
    );
    for (const [name, size] of ICONSET) {
      expect(pngSize(fs.readFileSync(path.join(root, "build/icon.iconset", name))), name).toEqual([size, size]);
    }
    const ico = fs.readFileSync(path.join(root, "build/icon.ico"));
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(ICO_SIZES.length);
    expect(fs.readFileSync(path.join(root, "build/icon.icns")).subarray(0, 4).toString("latin1")).toBe("icns");
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

  it("rewrites a stale owl placement and reports the file", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omb-app-icon-"));
    temporaryDirectories.push(directory);
    for (const rel of SVG_SOURCES) {
      fs.mkdirSync(path.dirname(path.join(directory, rel)), { recursive: true });
      fs.writeFileSync(path.join(directory, rel), `<svg><g transform="${OWL_TRANSFORM}"><path/></g></svg>`);
    }
    const stale = '<svg><g transform="translate(560 440) rotate(-14) scale(5.7) translate(-156.56 -79.72)"><path/></g></svg>';
    fs.writeFileSync(path.join(directory, "build/icon.svg"), stale);
    expect(syncSources(directory, { check: true })).toEqual(["build/icon.svg"]);
    expect(fs.readFileSync(path.join(directory, "build/icon.svg"), "utf8")).toBe(stale);
    expect(syncSources(directory)).toEqual(["build/icon.svg"]);
    expect(fs.readFileSync(path.join(directory, "build/icon.svg"), "utf8")).toContain(OWL_TRANSFORM);
    expect(syncSources(directory, { check: true })).toEqual([]);
  });
});
