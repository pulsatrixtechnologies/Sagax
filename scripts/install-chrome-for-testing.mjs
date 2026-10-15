#!/usr/bin/env node
// Install the pinned Chrome for Testing build into the server image.
// agent-browser 0.38.2 still refuses the linux-arm64 zip even though that
// zip is published; this script downloads the official archive for the
// build architecture and places chrome where the image already looks.
//
//   HOME=/opt/openmausbot-browser node scripts/install-chrome-for-testing.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, chmodSync, constants, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";

import {
  CHROME_FOR_TESTING_VERSION,
  chromePlatformFromArch,
  chromeZipSha256,
  chromeZipUrl,
} from "./chrome-linux-arch.mjs";

export function chromeHome(env = process.env) {
  const home = String(env.HOME ?? "").trim();
  if (!home) throw new Error("HOME is required");
  return home;
}

export function chromeInstallDir(home, version = CHROME_FOR_TESTING_VERSION) {
  return join(home, ".agent-browser", "browsers", `chrome-${version}`);
}

async function downloadZip(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`chrome download failed: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// zipfile.extractall drops the Unix modes the zip stores: the 0.5.2 image
// shipped chrome_crashpad_handler 0644, and every Chrome launch logged
// FATAL posix_spawn .../chrome_crashpad_handler: Permission denied (13).
// Apply each entry's permission bits (never setuid, setgid or sticky).
const EXTRACT_WITH_MODES = [
  "import os, sys, zipfile",
  "z = zipfile.ZipFile(sys.argv[1])",
  "for info in z.infolist():",
  "    path = z.extract(info, sys.argv[2])",
  "    mode = (info.external_attr >> 16) & 0o777",
  "    if mode and not info.is_dir():",
  "        os.chmod(path, mode)",
].join("\n");

function extractZip(zipPath, dest) {
  const result = spawnSync("python3", ["-c", EXTRACT_WITH_MODES, zipPath, dest], { stdio: "inherit" });
  if (result.status !== 0) throw new Error("chrome archive extract failed");
}

// Chrome spawns this helper at every start; without the execute bit it
// logs a FATAL and runs with no crash reporting.
export const CHROME_EXECUTABLES = ["chrome", "chrome_crashpad_handler"];

function assertExecutable(dest) {
  for (const name of CHROME_EXECUTABLES) {
    try { accessSync(join(dest, name), constants.X_OK); }
    catch { throw new Error(`${name} is not executable after extract`); }
  }
}

export async function installChromeForTesting({
  arch = process.arch,
  home = chromeHome(),
  version = CHROME_FOR_TESTING_VERSION,
  sha256,
  fetchZip = downloadZip,
  extract = extractZip,
} = {}) {
  const platform = chromePlatformFromArch(arch);
  const url = chromeZipUrl(version, platform);
  const expectedSha = sha256 ?? chromeZipSha256(platform);
  const dest = chromeInstallDir(home, version);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), "chrome-for-testing-"));
  try {
    const zipPath = join(scratch, `chrome-${platform}.zip`);
    const bytes = await fetchZip(url);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== expectedSha) throw new Error("chrome archive hash mismatch");
    await writeFile(zipPath, bytes);
    extract(zipPath, scratch);
    const unpacked = join(scratch, `chrome-${platform}`);
    const entries = readdirSync(unpacked);
    if (entries.length === 0) throw new Error("chrome archive layout is not the published zip");
    for (const name of entries) {
      renameSync(join(unpacked, name), join(dest, name));
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const binary = join(dest, "chrome");
  chmodSync(binary, 0o755);
  assertExecutable(dest);
  return { platform, version, dest, binary };
}

async function main() {
  const installed = await installChromeForTesting();
  console.log(`[chrome] ${installed.platform} ${installed.version} -> ${installed.binary}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[chrome] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
