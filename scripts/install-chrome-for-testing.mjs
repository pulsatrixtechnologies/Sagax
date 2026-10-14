#!/usr/bin/env node
// Install the pinned Chrome for Testing build into the server image.
// agent-browser 0.38.2 still refuses the linux-arm64 zip even though that
// zip is published; this script downloads the official archive for the
// build architecture and places chrome where the image already looks.
//
//   HOME=/opt/openmausbot-browser node scripts/install-chrome-for-testing.mjs
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
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

function extractZip(zipPath, dest) {
  const result = spawnSync(
    "python3",
    ["-c", "import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])", zipPath, dest],
    { stdio: "inherit" },
  );
  if (result.status !== 0) throw new Error("chrome archive extract failed");
}

export async function installChromeForTesting({
  arch = process.arch,
  home = chromeHome(),
  version = CHROME_FOR_TESTING_VERSION,
  sha256,
  fetchZip = downloadZip,
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
    extractZip(zipPath, scratch);
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
