// The owl app icon placement and the pure helpers behind
// scripts/generate-app-icon.mjs (kept free of Electron so tests can load it).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Upright owl: the eye (156.56, 79.72 in owl coordinates) is the pivot, the
// crop scale stays 5.7, and there is no rotation.
export const OWL_TRANSFORM = "translate(512 440) scale(5.7) translate(-156.56 -79.72)";

export const OWL_GROUP = /<g transform="[^"]*translate\(-156\.56 -79\.72\)">/g;

export const SVG_SOURCES = [
  "public/app-icon.svg",
  "build/icon.svg",
  "build/icon.icon/Assets/plumage.svg",
  "build/icon.icon/Assets/face.svg",
  "build/icon.icon/Assets/details.svg",
  "build/icon.icon/Assets/eye.svg",
];

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

export function syncSources(root, { check = false } = {}) {
  const stale = [];
  for (const rel of SVG_SOURCES) {
    const file = path.join(root, rel);
    const svg = readFileSync(file, "utf8");
    const matches = svg.match(OWL_GROUP) ?? [];
    if (matches.length !== 1) throw new Error(`${rel}: expected one owl group, found ${matches.length}`);
    const next = svg.replace(OWL_GROUP, `<g transform="${OWL_TRANSFORM}">`);
    if (next === svg) continue;
    stale.push(rel);
    if (!check) writeFileSync(file, next);
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
