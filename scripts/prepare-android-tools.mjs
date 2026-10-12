// Stage Google's official Android Platform Tools beside the packaged app so
// USB phone support works on a clean machine without Homebrew or an SDK.
// The archive is a pinned release, checked against its SHA-256. The moving
// "latest" archive is not used: it has no digest.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PLATFORM_TOOLS_VERSION = "37.0.1";
const PLATFORM_TOOLS_BASE = "https://dl.google.com/android/repository/";

/** Archive name and SHA-256 of platform-tools_r37.0.1. Windows is `win`, not `windows`. */
export const PLATFORM_TOOLS_PINS = {
  darwin: {
    archive: "darwin",
    sha256: "ee39ad5967e95c2a07f04dbcbde96b1a0c916ba376096db5d2f498b7727a5d1d",
  },
  linux: {
    archive: "linux",
    sha256: "d230f13842f60f782a8645f9c813f8f845bf36089ea7289f28c48f17979313f1",
  },
  win32: {
    archive: "win",
    sha256: "45f4d63113e895ebde0c90f194099a4676b6ac653bd28d54314a9e022bbc1a99",
  },
};

export function platformToolsUrl(platform) {
  const pin = PLATFORM_TOOLS_PINS[platform];
  if (!pin) throw new Error(`Android Platform Tools are unsupported on ${platform}`);
  return `${PLATFORM_TOOLS_BASE}platform-tools_r${PLATFORM_TOOLS_VERSION}-${pin.archive}.zip`;
}

function digestMatches(buffer, expected) {
  return createHash("sha256").update(buffer).digest("hex") === expected;
}

const platformNames = { darwin: "darwin", linux: "linux", win32: "win32" };

export async function stagePlatformTools() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  // SAGAX_ANDROID_TOOLS_PLATFORM=win32 stages the Windows tools from macOS or
  // Linux for an electron-builder cross build.
  const targetPlatform = process.env.SAGAX_ANDROID_TOOLS_PLATFORM || process.platform;
  const platform = platformNames[targetPlatform];
  const pin = PLATFORM_TOOLS_PINS[targetPlatform];
  if (!platform || !pin) throw new Error(`Android Platform Tools are unsupported on ${targetPlatform}`);
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
      const url = platformToolsUrl(targetPlatform);
      const response = await fetch(url, { redirect: "error" });
      if (!response.ok) throw new Error(`could not download Android Platform Tools: HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!digestMatches(bytes, pin.sha256)) {
        throw new Error(`Android Platform Tools digest does not match the pin for ${PLATFORM_TOOLS_VERSION} (${targetPlatform})`);
      }
      const zip = join(temporary, basename(new URL(url).pathname));
      writeFileSync(zip, bytes);
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
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await stagePlatformTools();
