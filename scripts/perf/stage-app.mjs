#!/usr/bin/env node
// Builds a runnable Sagax.app from this checkout for the interaction bench,
// without electron-builder: an APFS clone of an installed Sagax.app (its
// Electron framework, natives, browser engine) whose UI, server and Electron
// main are replaced by this checkout's builds, then re-sealed ad hoc.
//
//   node scripts/perf/stage-app.mjs <out.app> [--template /Applications/Sagax.app] [--skip-build]
//
// The copy is only ever launched by interaction-bench.mjs with
// SAGAX_PERF_BENCH=1 (its own logs, no sagax:// registration, no updater)
// and a mock keychain; it never touches the installed app or its data.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { template: { type: "string", default: "/Applications/Sagax.app" }, "skip-build": { type: "boolean", default: false } },
});
const out = positionals[0] ? path.resolve(positionals[0]) : null;
if (!out || !out.endsWith(".app")) throw new Error("usage: stage-app.mjs <out.app> [--template APP] [--skip-build]");
if (process.platform !== "darwin") throw new Error("stage-app.mjs builds a macOS bundle");

// @electron/asar is electron-builder's own (no direct dependency to add).
const fromBuilder = createRequire(createRequire(path.join(root, "package.json")).resolve("electron-builder/package.json"));
const { createPackage } = createRequire(fromBuilder.resolve("app-builder-lib/package.json"))("@electron/asar");

const run = (command, args, options = {}) => execFileSync(command, args, { cwd: root, stdio: ["ignore", "inherit", "inherit"], ...options });

if (!values["skip-build"]) {
  run("npx", ["vite", "build", "--logLevel", "warn"]);
  run("pnpm", ["-s", "build:server"], { stdio: ["ignore", "ignore", "inherit"] });
}

rmSync(out, { recursive: true, force: true });
run("cp", ["-cR", values.template, out]);
const resources = path.join(out, "Contents/Resources");
for (const [from, to] of [["dist", "ui"], ["dist-server", "server"]]) {
  rmSync(path.join(resources, to), { recursive: true, force: true });
  cpSync(path.join(root, from), path.join(resources, to), { recursive: true });
}

// app.asar: electron/** without tests or dev-only helpers, and package.json,
// as electron-builder's `files` list ships them.
const stage = mkdtempSync(path.join(tmpdir(), "sagax-perf-asar-"));
try {
  cpSync(path.join(root, "electron"), path.join(stage, "electron"), {
    recursive: true,
    filter: (source) => !/\.test\.|[/\\]fixtures[/\\]update-feed|[/\\]resources[/\\](speech|recorder)-helper|[/\\]resources[/\\]Pulsa Bot (Speech|Recorder)\.app|node_modules/.test(path.relative(root, source)),
  });
  // package-fork.mjs ships the fork version as the app version.
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  writeFileSync(path.join(stage, "package.json"), JSON.stringify({ ...manifest, version: manifest.forkVersion ?? manifest.version }, null, 2));
  const asar = path.join(resources, "app.asar");
  rmSync(asar, { force: true });
  await createPackage(stage, asar);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
if (!existsSync(path.join(resources, "app.asar"))) throw new Error("app.asar was not written");

// A distinct bundle id, so LaunchServices never mistakes the copy for the
// installed app; then an ad hoc seal over the edited bundle.
run("/usr/libexec/PlistBuddy", ["-c", "Set :CFBundleIdentifier com.openmausbot.app.perfbench", path.join(out, "Contents/Info.plist")]);
run("codesign", ["--force", "--deep", "--sign", "-", out], { stdio: ["ignore", "ignore", "inherit"] });
console.log(out);
