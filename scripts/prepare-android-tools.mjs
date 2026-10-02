// Stage Google's official Android Platform Tools beside the packaged app so
// USB phone support works on a clean machine without Homebrew or an SDK.
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const platformNames = { darwin: "darwin", linux: "linux", win32: "win32" };
const archiveNames = { darwin: "darwin", linux: "linux", win32: "windows" };
// SAGAX_ANDROID_TOOLS_PLATFORM=win32 stages the Windows tools from macOS or
// Linux for an electron-builder cross build.
const targetPlatform = process.env.SAGAX_ANDROID_TOOLS_PLATFORM || process.platform;
const platform = platformNames[targetPlatform];
const archive = archiveNames[targetPlatform];
if (!platform || !archive) throw new Error(`Android Platform Tools are unsupported on ${targetPlatform}`);
const adbName = targetPlatform === "win32" ? "adb.exe" : "adb";

const finalDir = join(root, "dist-native", "android-platform-tools", platform);
const override = process.env.SAGAX_ANDROID_PLATFORM_TOOLS_SOURCE;
const temporary = mkdtempSync(join(tmpdir(), "openmaus-android-tools-"));
const staged = join(temporary, platform);

try {
  if (override) {
    if (!existsSync(join(override, adbName))) {
      throw new Error(`SAGAX_ANDROID_PLATFORM_TOOLS_SOURCE has no adb: ${override}`);
    }
    cpSync(override, staged, { recursive: true });
  } else {
    const url = `https://dl.google.com/android/repository/platform-tools-latest-${archive}.zip`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`could not download Android Platform Tools: HTTP ${response.status}`);
    const zip = join(temporary, basename(new URL(url).pathname));
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
    const extraction = join(temporary, "extracted");
    mkdirSync(extraction);
    // A bare "tar" is Windows' bundled bsdtar (zip-capable) in cmd/PowerShell
    // but git-bash puts GNU tar (cannot read .zip) ahead of it on PATH, so
    // name the System32 binary absolutely — it extracts zips and understands
    // C:\ paths from any shell. unzip is the fallback for the rare Windows
    // without System32 tar, and the norm everywhere else.
    const systemTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
    const extractors = process.platform === "win32"
      ? [[systemTar, ["-xf", zip, "-C", extraction]], ["unzip", ["-q", zip, "-d", extraction]]]
      : [["unzip", ["-q", zip, "-d", extraction]]];
    // spawnSync leaves stdout/stderr undefined when the binary itself is
    // missing (ENOENT) — report result.error instead of crashing on .trim().
    const describeFailure = (r) => r.error?.message ?? (`${r.stderr || r.stdout || ""}`.trim() || `exit status ${r.status}`);
    let result;
    for (const [command, args] of extractors) {
      result = spawnSync(command, args, { encoding: "utf8" });
      if (result.status === 0) break;
      console.error(`${command} failed: ${describeFailure(result)} — trying next`);
    }
    if (result.status !== 0) throw new Error(`could not extract Android Platform Tools: ${describeFailure(result)}`);
    cpSync(join(extraction, "platform-tools"), staged, { recursive: true });
  }

  const adb = join(staged, adbName);
  if (!existsSync(adb)) throw new Error("Downloaded Android Platform Tools do not contain adb");
  mkdirSync(dirname(finalDir), { recursive: true });
  rmSync(finalDir, { recursive: true, force: true });
  cpSync(staged, finalDir, { recursive: true });
  console.log(`staged Android Platform Tools at ${finalDir}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
