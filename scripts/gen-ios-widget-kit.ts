#!/usr/bin/env -S node --experimental-strip-types
/**
 * Writes ios/Sources/CompanionCore/WidgetKit.generated.swift from the web's
 * widget kit (src/lib/widget-kit.ts): the stylesheet every widget document
 * carries and the theme rule as a template, so the phone draws a widget
 * exactly as the desktop does. The theme template holds one placeholder per
 * app token (SAGAXTOKEN_<name>_END); the phone writes its skin's colors in.
 * src/lib/page-theme.test.ts fails when the file is stale.
 * Usage: node --experimental-strip-types scripts/gen-ios-widget-kit.ts [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { iosWidgetKitSource } from "../src/lib/page-theme-ios.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "ios", "Sources", "CompanionCore", "WidgetKit.generated.swift");
const next = iosWidgetKitSource();
if (process.argv.includes("--check")) {
  const current = readFileSync(target, "utf8");
  if (current !== next) {
    console.error("WidgetKit.generated.swift is stale: run node --experimental-strip-types scripts/gen-ios-widget-kit.ts");
    process.exit(1);
  }
} else {
  writeFileSync(target, next);
  console.log(`wrote ${target}`);
}
