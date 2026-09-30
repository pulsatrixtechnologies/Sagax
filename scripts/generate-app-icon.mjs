// Regenerates every owl app icon output from one placement of the owl trace.
//
// Run with `pnpm icons:generate` (it runs under Electron, which the repo
// already ships, so Chromium rasterises the SVGs; no extra image tooling).
//
// The owl bust is drawn in owl coordinates and placed on the 1024 tile by
// OWL_TRANSFORM. The script rewrites that transform in every SVG source:
//   public/app-icon.svg, build/icon.svg and the Icon Composer layers in
//   build/icon.icon/Assets/*.svg (the macOS 26 Liquid Glass icon; its
//   icon.json groups, fills and glass settings are left untouched),
// then rasterises build/icon.svg into:
//   build/icon-1024.png, electron/resources/app-icon.png,
//   build/icon.iconset/*.png and build/icon.icns (iconutil, macOS only),
//   all on the macOS icon grid, and build/icon.ico (full bleed, 16 to 256).
//
// The iOS and Android launcher icons (ios/AppStore/app-icon-ios.svg,
// android/...) are a different artwork and are not produced here.
//
// The placement and the pure helpers live in scripts/app-icon.mjs.
// Pass --check to only verify the sources carry OWL_TRANSFORM (no writes).

import { app, BrowserWindow } from "electron";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ICO_SIZES, ICONSET, buildIco, syncSources } from "./app-icon.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// macOS (pre-26 Dock, Finder, dmg, runtime Dock image in dev) expects the
// Big Sur grid: an 824 tile inset 100 on a 1024 canvas with a soft drop
// shadow. Windows takes the tile full bleed.
const MAC_GRID = { inset: 100, tile: 824, shadow: { color: "rgba(0, 0, 0, 0.31)", blur: 24, offsetY: 12 } };

// Draws the SVG into a canvas at each size (Chromium rasterises the vector
// per size, so small icons stay crisp) and returns PNG buffers by size.
async function rasterise(win, svg, sizes, grid = null) {
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const out = new Map();
  for (const size of sizes) {
    const dataUrl = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
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
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("svg failed to load"));
      img.src = ${JSON.stringify(src)};
    })`);
    out.set(size, Buffer.from(dataUrl.split(",")[1], "base64"));
  }
  return out;
}

async function main() {
  const check = process.argv.includes("--check");
  const stale = syncSources(root, { check });
  if (check) {
    if (stale.length) {
      console.error(`Owl transform out of date in: ${stale.join(", ")}. Run pnpm icons:generate.`);
      return 1;
    }
    console.log("Owl icon sources carry OWL_TRANSFORM.");
    return 0;
  }
  const svg = readFileSync(path.join(root, "build/icon.svg"), "utf8");
  const page = new BrowserWindow({ show: false, width: 64, height: 64, webPreferences: { offscreen: true, sandbox: true } });
  let mac;
  let windows;
  try {
    await page.loadURL("data:text/html,<!doctype html><title>icon</title>");
    mac = await rasterise(page, svg, [...new Set([...ICONSET.map(([, size]) => size), 1024])], MAC_GRID);
    windows = await rasterise(page, svg, ICO_SIZES);
  } finally {
    page.destroy();
  }

  writeFileSync(path.join(root, "build/icon-1024.png"), mac.get(1024));
  writeFileSync(path.join(root, "electron/resources/app-icon.png"), mac.get(1024));
  const iconset = path.join(root, "build/icon.iconset");
  mkdirSync(iconset, { recursive: true });
  for (const [name, size] of ICONSET) writeFileSync(path.join(iconset, name), mac.get(size));
  writeFileSync(path.join(root, "build/icon.ico"), buildIco(ICO_SIZES.map((size) => ({ size, png: windows.get(size) }))));
  if (process.platform === "darwin") {
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", path.join(root, "build/icon.icns")], { stdio: "inherit" });
  } else {
    console.warn("iconutil is macOS only; build/icon.icns was not regenerated.");
  }
  console.log(`Updated ${stale.length} SVG source(s) and every raster output.`);
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
