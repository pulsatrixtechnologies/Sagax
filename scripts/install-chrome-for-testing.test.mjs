import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CHROME_FOR_TESTING_VERSION,
  CHROME_LINUX_SHA256,
  chromePlatformFromArch,
  chromeZipSha256,
} from "./chrome-linux-arch.mjs";
import { chromeInstallDir, installChromeForTesting } from "./install-chrome-for-testing.mjs";

const dockerfile = readFileSync(join(import.meta.dirname, "..", "Dockerfile"), "utf8");

function zipWithChrome(platform) {
  const dir = mkdtempSync(join(tmpdir(), "chrome-zip-"));
  const inner = join(dir, `chrome-${platform}`);
  mkdirSync(inner, { recursive: true });
  writeFileSync(join(inner, "chrome"), "#!/bin/sh\necho chrome-fixture\n", { mode: 0o755 });
  // The published zip carries Unix modes: the crash handler and the setuid
  // sandbox helper are executables, the rest is data.
  writeFileSync(join(inner, "chrome_crashpad_handler"), "#!/bin/sh\n", { mode: 0o755 });
  writeFileSync(join(inner, "chrome_sandbox"), "#!/bin/sh\n", { mode: 0o755 });
  chmodSync(join(inner, "chrome_sandbox"), 0o4755);
  writeFileSync(join(inner, "resources.pak"), "data", { mode: 0o644 });
  const zipPath = join(dir, `${platform}.zip`);
  const made = spawnSync(
    "python3",
    [
      "-c",
      "import os, sys, zipfile\nz = zipfile.ZipFile(sys.argv[1], 'w')\nroot = sys.argv[2]\nfor dp, _ds, files in os.walk(root):\n    for name in files:\n        full = os.path.join(dp, name)\n        z.write(full, os.path.relpath(full, os.path.dirname(root)))\n",
      zipPath,
      inner,
    ],
    { encoding: "utf8" },
  );
  if (made.status !== 0) throw new Error(made.stderr || "fixture zip failed");
  const bytes = readFileSync(zipPath);
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

describe("install Chrome for Testing", () => {
  it("maps Linux architectures onto the published zip names", () => {
    expect(chromePlatformFromArch("arm64")).toBe("linux-arm64");
    expect(chromePlatformFromArch("aarch64")).toBe("linux-arm64");
    expect(chromePlatformFromArch("x64")).toBe("linux64");
    expect(chromePlatformFromArch("amd64")).toBe("linux64");
    expect(chromeZipSha256("linux64")).toBe(CHROME_LINUX_SHA256.linux64);
    expect(chromeZipSha256("linux-arm64")).toBe(CHROME_LINUX_SHA256["linux-arm64"]);
    expect(() => chromePlatformFromArch("wasm32")).toThrow(/Linux/);
  });

  it("unpacks the published zip layout and refuses a hash mismatch", async () => {
    const home = mkdtempSync(join(tmpdir(), "chrome-home-"));
    const bytes = zipWithChrome("linux-arm64");
    await expect(
      installChromeForTesting({
        arch: "arm64",
        home,
        fetchZip: async () => bytes,
      }),
    ).rejects.toThrow(/hash mismatch/);

    const installed = await installChromeForTesting({
      arch: "arm64",
      home,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      fetchZip: async () => bytes,
    });
    expect(installed.platform).toBe("linux-arm64");
    expect(installed.dest).toBe(chromeInstallDir(home, CHROME_FOR_TESTING_VERSION));
    expect(readFileSync(installed.binary, "utf8")).toContain("chrome-fixture");
    rmSync(home, { recursive: true, force: true });
  });

  it("keeps the zip's executable bits so Chrome can start its crash handler", async () => {
    // Python's zipfile.extractall drops Unix modes: chrome_crashpad_handler
    // came out 0644 and every launch logged FATAL posix_spawn ... Permission
    // denied (13) (Sagax 0.5.2 and 0.5.3 images, 2026-10-15).
    const home = mkdtempSync(join(tmpdir(), "chrome-home-"));
    const bytes = zipWithChrome("linux64");
    const installed = await installChromeForTesting({
      arch: "x64",
      home,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      fetchZip: async () => bytes,
    });
    const mode = (name) => statSync(join(installed.dest, name)).mode & 0o7777;
    expect(mode("chrome")).toBe(0o755);
    expect(mode("chrome_crashpad_handler")).toBe(0o755);
    // Never a setuid root helper in the image: the bit is dropped.
    expect(mode("chrome_sandbox")).toBe(0o755);
    expect(mode("resources.pak")).toBe(0o644);
    rmSync(home, { recursive: true, force: true });
  });

  it("refuses an install whose crash handler is not executable", async () => {
    const home = mkdtempSync(join(tmpdir(), "chrome-home-"));
    const bytes = zipWithChrome("linux64");
    await expect(
      installChromeForTesting({
        arch: "x64",
        home,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        fetchZip: async () => bytes,
        extract: (_zipPath, dest) => {
          const inner = join(dest, "chrome-linux64");
          mkdirSync(inner, { recursive: true });
          writeFileSync(join(inner, "chrome"), "", { mode: 0o755 });
          writeFileSync(join(inner, "chrome_crashpad_handler"), "", { mode: 0o644 });
        },
      }),
    ).rejects.toThrow(/chrome_crashpad_handler is not executable/);
    rmSync(home, { recursive: true, force: true });
  });

  it("installs Chrome from the pinned zip in the image and refuses the Debian fallback", () => {
    expect(dockerfile).toContain("install-chrome-for-testing.mjs");
    expect(dockerfile).toContain("chrome-linux-arch.mjs");
    expect(dockerfile).not.toContain("agent-browser install");
    expect(dockerfile).not.toMatch(/apt-get install -y --no-install-recommends chromium/);
    expect(dockerfile).toContain("test ! -e /usr/bin/chromium");
    expect(dockerfile).toContain("chrome --headless --disable-gpu --no-sandbox --version");
    // The build starts Chrome as agent-browser does and fails on a crash
    // handler FATAL or a missing DevToolsActivePort.
    expect(dockerfile).toContain("chrome-launch-check.mjs /opt/openmausbot-browser/chrome");
    expect(dockerfile).not.toMatch(/if \[ "\$TARGETARCH" = "arm64" \]/);
  });
});
