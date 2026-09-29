#!/usr/bin/env node
// Launches the unpackaged desktop app (`pnpm dev:desktop`).
//
// On macOS, `electron .` runs node_modules/electron/dist/Electron.app: the
// Dock calls it "Electron" (the bundle folder name) and shows Electron's
// icon. A runtime app.dock.setIcon() PNG is a flat bitmap that macOS 26
// cannot restyle (light, dark, clear, tinted). So dev runs use a clone of
// that bundle named "Pulsa Bot.app" with build/icon.icon compiled into it
// (Assets.car + CFBundleIconName), rendered by the OS like the packaged app.
// The npm bundle itself is never modified. Without Xcode's actool, or off
// macOS, this falls back to plain `electron .`.
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconSource = path.join(root, "build/icon.icon");
const devDir = path.join(root, "node_modules/.cache/pulsa-dev");
const devBundle = path.join(devDir, "Pulsa Bot.app");
const stampFile = path.join(devDir, "stamp.json");
const APP_NAME = "Pulsa Bot";
const ICON_NAME = "PulsaBotIcon";

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function setPlistValue(infoPlist, key, value) {
  try {
    run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} "${value}"`, infoPlist]);
  } catch {
    run("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string "${value}"`, infoPlist]);
  }
}

function newestMtime(dir) {
  let newest = statSync(dir).mtimeMs;
  for (const entry of run("find", [dir, "-type", "f"]).split("\n").filter(Boolean)) {
    newest = Math.max(newest, statSync(entry).mtimeMs);
  }
  return newest;
}

function buildDevBundle(electronBundle) {
  const stamp = JSON.stringify({ electron: electronBundle, electronMtime: statSync(electronBundle).mtimeMs, icon: newestMtime(iconSource) });
  if (existsSync(devBundle) && existsSync(stampFile) && readFileSync(stampFile, "utf8") === stamp) return;

  rmSync(devBundle, { recursive: true, force: true });
  mkdirSync(devDir, { recursive: true });
  // APFS clone: instant and takes no extra space until a file changes.
  run("cp", ["-cR", electronBundle, devBundle]);

  const resources = path.join(devBundle, "Contents/Resources");
  const infoPlist = path.join(devBundle, "Contents/Info.plist");
  const out = mkdtempSync(path.join(tmpdir(), "pulsa-dev-icon-"));
  try {
    // actool names the compiled icon after the .icon folder.
    const staged = path.join(out, `${ICON_NAME}.icon`);
    cpSync(iconSource, staged, { recursive: true });
    run("xcrun", [
      "actool", staged,
      "--compile", out,
      "--app-icon", ICON_NAME,
      "--enable-on-demand-resources", "NO",
      "--development-region", "en",
      "--target-device", "mac",
      "--platform", "macosx",
      "--minimum-deployment-target", "12.0",
      "--output-partial-info-plist", path.join(out, "partial.plist"),
    ]);
    copyFileSync(path.join(out, "Assets.car"), path.join(resources, "Assets.car"));
    copyFileSync(path.join(out, `${ICON_NAME}.icns`), path.join(resources, `${ICON_NAME}.icns`));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }

  setPlistValue(infoPlist, "CFBundleName", APP_NAME);
  setPlistValue(infoPlist, "CFBundleDisplayName", APP_NAME);
  setPlistValue(infoPlist, "CFBundleIconName", ICON_NAME);
  setPlistValue(infoPlist, "CFBundleIconFile", `${ICON_NAME}.icns`);
  for (const locale of ["en", "fr"]) {
    const dir = path.join(resources, `${locale}.lproj`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "InfoPlist.strings"), `CFBundleDisplayName = "${APP_NAME}";\nCFBundleName = "${APP_NAME}";\n`);
  }
  // Editing the bundle breaks Electron's ad-hoc seal; re-seal it the same way.
  run("codesign", ["--force", "--deep", "--sign", "-", devBundle]);
  const now = new Date();
  utimesSync(devBundle, now, now);
  try {
    run("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", devBundle]);
  } catch {
    // LaunchServices picks the bundle up on its own, just later.
  }
  writeFileSync(stampFile, stamp);
}

function executable() {
  const electronExecutable = require("electron");
  if (process.platform !== "darwin" || !existsSync(iconSource)) return electronExecutable;
  try {
    run("xcrun", ["--find", "actool"]);
  } catch {
    console.warn("[dev-desktop] actool not found (install Xcode 26); running plain Electron with a flat Dock icon.");
    return electronExecutable;
  }
  const electronBundle = electronExecutable.slice(0, electronExecutable.indexOf(".app/") + ".app".length);
  try {
    buildDevBundle(electronBundle);
    return path.join(devBundle, "Contents/MacOS", path.basename(electronExecutable));
  } catch (error) {
    console.warn(`[dev-desktop] could not prepare the Pulsa Bot dev bundle, running plain Electron: ${error.message}`);
    return electronExecutable;
  }
}

const child = spawn(executable(), [root, ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
