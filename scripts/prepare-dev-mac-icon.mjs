#!/usr/bin/env node
// Unpackaged dev runs launch node_modules/electron/dist/Electron.app, whose
// bundle carries Electron's own icon. A runtime app.dock.setIcon() PNG
// replaces it in the Dock but is a flat bitmap: macOS 26 cannot apply the
// light, dark, clear or tinted icon styles to it. Compiling build/icon.icon
// into that bundle (Assets.car + CFBundleIconName) lets the OS render the
// dev app exactly like the packaged one. No-op off macOS or without actool.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, copyFileSync, rmSync, mkdtempSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iconSource = path.join(root, "build/icon.icon");
const appBundle = path.join(root, "node_modules/electron/dist/Electron.app");
const resources = path.join(appBundle, "Contents/Resources");
const infoPlist = path.join(appBundle, "Contents/Info.plist");
const ICON_NAME = "PulsaBotIcon";

function run(command, args) {
  return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function plistValue(key) {
  try {
    return run("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, infoPlist]).trim();
  } catch {
    return null;
  }
}

function setPlistValue(key, value) {
  if (plistValue(key) === null) run("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, infoPlist]);
  else run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, infoPlist]);
}

function main() {
  if (process.platform !== "darwin") return;
  if (!existsSync(appBundle) || !existsSync(iconSource)) return;
  try {
    run("xcrun", ["--find", "actool"]);
  } catch {
    console.warn("[dev-mac-icon] actool not found (install Xcode 26); the dev Dock icon stays flat.");
    return;
  }

  const out = mkdtempSync(path.join(tmpdir(), "pulsa-dev-icon-"));
  try {
    // actool names the compiled icon after the .icon folder, so stage it
    // under a name no Electron resource already uses.
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
    mkdirSync(resources, { recursive: true });
    copyFileSync(path.join(out, "Assets.car"), path.join(resources, "Assets.car"));
    copyFileSync(path.join(out, `${ICON_NAME}.icns`), path.join(resources, `${ICON_NAME}.icns`));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }

  setPlistValue("CFBundleIconName", ICON_NAME);
  setPlistValue("CFBundleIconFile", `${ICON_NAME}.icns`);
  // Editing the bundle breaks Electron's ad-hoc seal; re-seal it the same way.
  run("codesign", ["--force", "--deep", "--sign", "-", appBundle]);
  const now = new Date();
  utimesSync(appBundle, now, now);
  try {
    run("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", ["-f", appBundle]);
  } catch {
    // LaunchServices picks the change up on its own, just later.
  }
}

main();
