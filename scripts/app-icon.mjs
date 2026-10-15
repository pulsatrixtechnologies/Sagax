// The Pulsatrix app icon: how the official owl mark sits on its night blue
// tile, and the pure helpers behind scripts/generate-app-icon.mjs (kept free
// of Electron so tests can load them).
//
// The mark is read from public/brand/pulsatrix-owl-mark-color-tight.svg (the
// official vector: white outline, blue eyes and heartbeat line). Every SVG
// source of the icon is composed from it here, so they never drift:
//   build/icon-pulsatrix.svg  the master (rounded tile, full canvas)
//   build/icon.svg            the same, for Linux (electron-builder)
//   public/app-icon.svg       the same, for the web, favicon and About
//   ios/AppStore/app-icon-ios.svg  square, opaque (iOS masks the corners)
//   build/icon.icon/Assets/*.svg   the macOS 26 Icon Composer layers
//
// Small sizes (16 to 64 px) use a variant with a slightly larger mark and
// thickened outline, eyes and pulse line, so the heartbeat stays legible;
// 128 px and up use the master as drawn.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import path from "node:path";

export const MARK_SOURCE = "public/brand/pulsatrix-owl-mark-color-tight.svg";

/** The tight mark's viewBox (28 x 21.8). */
export const MARK_BOX = Object.freeze({ width: 28, height: 21.8 });

/** Night blue tile, a touch lighter at the top. */
export const TILE = Object.freeze({ top: "#0A1A44", bottom: "#020818", radius: 230.4 });

export const COLORS = Object.freeze({ outline: "#FFFFFF", accent: "#3466DC", shade: "#204CB6" });

/** Mark width as a fraction of the 1024 canvas, and its vertical centre. */
export const LARGE = Object.freeze({ width: 0.6, centerY: 0.515, outlineStroke: 0, accentStroke: 0 });
/**
 * 16 to 64 px: a bigger mark, and strokes (in mark units) that thicken the
 * thin parts. The 0.75 unit pulse line is a fifth of a pixel at 16 px.
 */
export const SMALL = Object.freeze({ width: 0.7, centerY: 0.52, outlineStroke: 0.55, accentStroke: 0.85 });
export const SMALL_MAX = 64;

export const ICONSET = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

export const ICO_SIZES = [16, 24, 32, 48, 64, 256];

/** The three paths of the official mark: outline, accent (eyes, pulse), shade. */
export function readMark(root) {
  const svg = readFileSync(path.join(root, MARK_SOURCE), "utf8");
  const paths = [...svg.matchAll(/<path\b([^>]*)\/>/g)].map(([, attrs]) => ({
    fill: /fill="([^"]+)"/.exec(attrs)?.[1],
    d: /\sd="([^"]+)"/.exec(attrs)?.[1],
  }));
  const pick = (fill) => {
    const found = paths.filter((p) => p.fill === fill);
    if (found.length !== 1 || !found[0].d) throw new Error(`${MARK_SOURCE}: expected one path filled ${fill}, found ${found.length}`);
    return found[0].d;
  };
  return { outline: pick("currentColor"), accent: pick(COLORS.accent), shade: pick(COLORS.shade) };
}

const round = (value) => Math.round(value * 10000) / 10000;

/** Where the mark lands on the 1024 canvas for a placement (LARGE or SMALL). */
export function markTransform(placement = LARGE) {
  const scale = (1024 * placement.width) / MARK_BOX.width;
  return `translate(512 ${round(1024 * placement.centerY)}) scale(${round(scale)}) translate(${-MARK_BOX.width / 2} ${-MARK_BOX.height / 2})`;
}

function markPaths(mark, placement, { outline = true, accent = true, colors = COLORS } = {}) {
  const stroke = (color, width) => (width ? ` stroke="${color}" stroke-width="${width}" stroke-linejoin="round"` : "");
  const parts = [];
  if (outline) parts.push(`<path fill="${colors.outline}" fill-rule="evenodd"${stroke(colors.outline, placement.outlineStroke)} d="${mark.outline}"/>`);
  if (accent) {
    parts.push(`<path fill="${colors.accent}" fill-rule="evenodd"${stroke(colors.accent, placement.accentStroke)} d="${mark.accent}"/>`);
    parts.push(`<path fill="${colors.shade}" d="${mark.shade}"/>`);
  }
  return `<g transform="${markTransform(placement)}">${parts.join("")}</g>`;
}

const head = (title, desc) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><title>${title}</title>${desc ? `<desc>${desc}</desc>` : ""}`;

/**
 * The icon as SVG: the mark on the night blue tile.
 * shape "rounded": the tile with Big Sur's corner (230.4 on 1024, 185.4 once
 * the macOS grid puts it at 824); "square": full bleed and opaque (iOS).
 * `tile` overrides the two tile colours, `colors` the mark's (iOS dark, tinted).
 */
export function composeIconSvg(mark, { shape = "rounded", small = false, title = "Sagax", tile = TILE, colors = COLORS } = {}) {
  const placement = small ? SMALL : LARGE;
  const plate = shape === "rounded" ? `<rect width="1024" height="1024" rx="${TILE.radius}" fill="url(#bg)"/>` : `<rect width="1024" height="1024" fill="url(#bg)"/>`;
  return (
    head(title, "The Pulsatrix owl mark: white outline, blue eyes and heartbeat line, on a night blue tile.") +
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tile.top}"/><stop offset="1" stop-color="${tile.bottom}"/></linearGradient></defs>` +
    plate +
    markPaths(mark, placement, { colors }) +
    `</svg>`
  );
}

/** One Icon Composer layer: part of the mark on a transparent 1024 canvas. */
export function composeLayerSvg(mark, layer) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">${markPaths(mark, LARGE, { outline: layer === "outline", accent: layer === "accent" })}</svg>`;
}

/** iOS appearances: the default, dark (deeper ground) and tinted (grayscale, the system tints it). */
export const IOS_VARIANTS = Object.freeze({
  "icon-1024.png": { tile: TILE, colors: COLORS },
  "icon-1024-dark.png": { tile: { top: "#061233", bottom: "#000000" }, colors: { outline: "#FFFFFF", accent: "#4A7BEA", shade: "#2E5CC8" } },
  "icon-1024-tinted.png": { tile: { top: "#000000", bottom: "#000000" }, colors: { outline: "#FFFFFF", accent: "#9A9A9A", shade: "#7A7A7A" } },
});

/** Every SVG source the generator owns, by repo path. */
export function svgSources(mark) {
  const rounded = composeIconSvg(mark);
  return {
    "build/icon-pulsatrix.svg": rounded,
    "build/icon.svg": rounded,
    "public/app-icon.svg": rounded,
    "ios/AppStore/app-icon-ios.svg": composeIconSvg(mark, { shape: "square" }),
    "build/icon.icon/Assets/outline.svg": composeLayerSvg(mark, "outline"),
    "build/icon.icon/Assets/accent.svg": composeLayerSvg(mark, "accent"),
  };
}

export const SVG_SOURCES = Object.freeze(Object.keys(svgSources({ outline: "", accent: "", shade: "" })));

/** Write (or with check, only list) the SVG sources that differ from the composition. */
export function syncSources(root, { check = false } = {}) {
  const stale = [];
  for (const [rel, svg] of Object.entries(svgSources(readMark(root)))) {
    const file = path.join(root, rel);
    let current = null;
    try {
      current = readFileSync(file, "utf8");
    } catch {
      // missing: stale
    }
    if (current === svg) continue;
    stale.push(rel);
    if (check) continue;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, svg);
  }
  return stale;
}

// Pack PNG buffers into a Windows .ico (PNG-compressed entries, Vista+).
export function buildIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, index) => {
    const at = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * An opaque RGB PNG (no alpha channel) from RGBA pixels. The App Store
 * refuses an iOS icon whose PNG carries alpha, even fully opaque; the
 * canvas only writes RGBA, so iOS pixels go through this.
 */
export function encodeRgbPng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error("encodeRgbPng: pixel buffer size mismatch");
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const to = row + 1 + x * 3;
      raw[to] = rgba[from];
      raw[to + 1] = rgba[from + 1];
      raw[to + 2] = rgba[from + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(2, 9); // colour type: RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
