import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  CHROME_FOR_TESTING_VERSION,
  CHROME_LINUX_PLATFORMS,
  CHROME_LINUX_SHA256,
  chromePlatformFromArch,
  chromePlatformsFromCatalog,
  chromeZipSha256,
  chromeZipUrl,
} from "./chrome-linux-arch.mjs";

const dockerfile = readFileSync(join(import.meta.dirname, "..", "Dockerfile"), "utf8");

describe("Chrome for Testing on both Linux architectures", () => {
  it("builds a pinned zip URL for linux64 and linux-arm64", () => {
    expect(CHROME_LINUX_PLATFORMS).toEqual(["linux64", "linux-arm64"]);
    expect(chromeZipUrl(CHROME_FOR_TESTING_VERSION, "linux64")).toBe(
      `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_FOR_TESTING_VERSION}/linux64/chrome-linux64.zip`,
    );
    expect(chromeZipUrl(CHROME_FOR_TESTING_VERSION, "linux-arm64")).toBe(
      `https://storage.googleapis.com/chrome-for-testing-public/${CHROME_FOR_TESTING_VERSION}/linux-arm64/chrome-linux-arm64.zip`,
    );
    expect(chromePlatformFromArch("arm64")).toBe("linux-arm64");
    expect(chromeZipSha256("linux64")).toBe(CHROME_LINUX_SHA256.linux64);
    expect(chromeZipSha256("linux-arm64")).toHaveLength(64);
    expect(() => chromeZipUrl("latest", "linux-arm64")).toThrow(/pinned/);
    expect(() => chromeZipUrl(CHROME_FOR_TESTING_VERSION, "win64")).toThrow(/Linux/);
  });

  it("reads both Linux platforms out of a catalog fixture", () => {
    const platforms = chromePlatformsFromCatalog({
      channels: {
        Stable: {
          version: CHROME_FOR_TESTING_VERSION,
          downloads: {
            chrome: [
              { platform: "linux-arm64", url: chromeZipUrl(CHROME_FOR_TESTING_VERSION, "linux-arm64") },
              { platform: "linux64", url: chromeZipUrl(CHROME_FOR_TESTING_VERSION, "linux64") },
              { platform: "mac-arm64", url: "https://example.invalid/mac" },
            ],
          },
        },
      },
    });
    expect(platforms).toEqual(expect.arrayContaining(["linux64", "linux-arm64"]));
  });

  it("installs the same browser on every architecture and refuses the Debian fallback", () => {
    expect(dockerfile).toContain("install-chrome-for-testing.mjs");
    expect(dockerfile).not.toContain("agent-browser install");
    expect(dockerfile).not.toMatch(/apt-get install -y --no-install-recommends chromium/);
    expect(dockerfile).toContain("test ! -e /usr/bin/chromium");
    expect(dockerfile).toContain("chrome --headless --disable-gpu --no-sandbox --version");
    expect(dockerfile).not.toMatch(/if \[ "\$TARGETARCH" = "arm64" \]/);
  });
});
