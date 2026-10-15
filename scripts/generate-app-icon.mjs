// Regenerates every app icon output: the Pulsatrix owl mark on a night blue
// tile (JC, 2026-10-14; the Sagax owl stays in the picker as "Owl").
//
// Run with `pnpm icons:generate` (it runs under Electron, which the repo
// already ships, so Chromium rasterises the SVGs; no extra image tooling).
//
// 1. Composes every SVG source from the official mark (scripts/app-icon.mjs):
//    build/icon-pulsatrix.svg (master), build/icon.svg, public/app-icon.svg,
//    ios/AppStore/app-icon-ios.svg and the Icon Composer layers in
//    build/icon.icon/Assets/ (the macOS 26 Liquid Glass icon).
// 2. Rasterises:
//    macOS grid (824 tile inset 100, soft shadow): build/icon-1024.png,
//      electron/resources/app-icon.png (Dock in dev, startup screen, tray),
//      build/icon.iconset/*.png and build/icon.icns (iconutil, macOS only);
//    full bleed: build/icon.ico (16 to 256), public/app-icon-192.png and
//      app-icon-512.png (web manifest);
//    square and opaque, RGB without alpha: public/apple-touch-icon.png and
//      the iOS AppIcon (default, dark, tinted).
//    16 to 64 px use the thickened small variant.
//
// The Android launcher (android/...) is a different artwork, not produced here.
// Pass --check to only verify the SVG sources match the composition (no writes).

import { app, BrowserWindow } from "electron";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ICO_SIZES, ICONSET, IOS_VARIANTS, SMALL_MAX, buildIco, composeIconSvg, encodeRgbPng, readMark, syncSources } from "./app-icon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// macOS (pre-26 Dock, Finder, dmg, runtime Dock image in dev) expects the
// Big Sur grid: an 824 tile inset 100 on a 1024 canvas with a soft drop
// shadow. Windows, Linux and the web take the tile full bleed.
const MAC_GRID = { inset: 100, tile: 824, shadow: { color: "rgba(0, 0, 0, 0.31)", blur: 24, offsetY: 12 } };

// Draws the SVG into a canvas at `size` and returns a PNG buffer, or the raw
// RGBA pixels with `raw` (for the opaque RGB PNGs).
async function rasterise(win, svg, size, { grid = null, raw = false } = {}) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const result = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
    const img = new Image(${size}, ${size});
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = ${size};
      canvas.height = ${size};
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      const grid = ${JSON.stringify(grid)};
      if (grid) {
        const k = ${size} / 1024;
        ctx.shadowColor = grid.shadow.color;
        ctx.shadowBlur = grid.shadow.blur * k;
        ctx.shadowOffsetY = grid.shadow.offsetY * k;
        ctx.drawImage(img, grid.inset * k, grid.inset * k, grid.tile * k, grid.tile * k);
      } else {
        ctx.drawImage(img, 0, 0, ${size}, ${size});
      }
      if (${raw}) {
        const data = ctx.getImageData(0, 0, ${size}, ${size}).data;
        let binary = "";
        for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode.apply(null, data.subarray(i, i + 0x8000));
        resolve(btoa(binary));
      } else {
        resolve(canvas.toDataURL("image/png").split(",")[1]);
      }
    };
    img.onerror = () => reject(new Error("svg failed to load"));
    img.src = ${JSON.stringify(src)};
  })`);
  const buffer = Buffer.from(result, "base64");
  return raw ? encodeRgbPng(size, size, buffer) : buffer;
}

async function main() {
  const check = process.argv.includes("--check");
  const stale = syncSources(root, { check });
  if (check) {
    if (stale.length) {
      console.error(`App icon sources out of date: ${stale.join(", ")}. Run pnpm icons:generate.`);
      return 1;
    }
    console.log("App icon SVG sources match the Pulsatrix mark.");
    return 0;
  }
  const mark = readMark(root);
  const svgFor = (size, options = {}) => composeIconSvg(mark, { ...options, small: size <= SMALL_MAX });
  const page = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: true, sandbox: true } });
  const out = new Map();
  try {
    await page.loadURL("data:text/html,<!doctype html><title>icon</title>");
    const mac = new Map();
    for (const size of new Set([...ICONSET.map(([, size]) => size), 1024])) mac.set(size, await rasterise(page, svgFor(size), size, { grid: MAC_GRID }));
    out.set("build/icon-1024.png", mac.get(1024));
    out.set("electron/resources/app-icon.png", mac.get(1024));
    for (const [name, size] of ICONSET) out.set(`build/icon.iconset/${name}`, mac.get(size));

    const ico = [];
    for (const size of ICO_SIZES) ico.push({ size, png: await rasterise(page, svgFor(size), size) });
    out.set("build/icon.ico", buildIco(ico));
    for (const size of [192, 512]) out.set(`public/app-icon-${size}.png`, await rasterise(page, svgFor(size), size));

    out.set("public/apple-touch-icon.png", await rasterise(page, svgFor(180, { shape: "square" }), 180, { raw: true }));
    for (const [name, variant] of Object.entries(IOS_VARIANTS)) {
      out.set(`ios/App/Assets.xcassets/AppIcon.appiconset/${name}`, await rasterise(page, svgFor(1024, { shape: "square", ...variant }), 1024, { raw: true }));
    }
  } finally {
    page.destroy();
  }

  mkdirSync(path.join(root, "build/icon.iconset"), { recursive: true });
  for (const [rel, buffer] of out) writeFileSync(path.join(root, rel), buffer);
  if (process.platform === "darwin") {
    execFileSync("iconutil", ["-c", "icns", path.join(root, "build/icon.iconset"), "-o", path.join(root, "build/icon.icns")], { stdio: "inherit" });
  } else {
    console.warn("iconutil is macOS only; build/icon.icns was not regenerated.");
  }
  console.log(`Updated ${stale.length} SVG source(s) and ${out.size} raster output(s).`);
  return 0;
}

app.disableHardwareAcceleration();
app.whenReady().then(main).then(
  (code) => app.exit(code),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
