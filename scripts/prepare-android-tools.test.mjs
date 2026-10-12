import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PLATFORM_TOOLS_PINS, PLATFORM_TOOLS_VERSION, platformToolsUrl } from "./prepare-android-tools.mjs";

const source = readFileSync(new URL("./prepare-android-tools.mjs", import.meta.url), "utf8");

describe("android platform-tools pin", () => {
  it("fetches the pinned r37.0.1 archive and never platform-tools-latest", () => {
    expect(source).not.toContain("platform-tools-latest");
    expect(PLATFORM_TOOLS_VERSION).toBe("37.0.1");
    for (const [platform, pin] of Object.entries(PLATFORM_TOOLS_PINS)) {
      expect(pin.sha256, platform).toMatch(/^[a-f0-9]{64}$/);
      const url = platformToolsUrl(platform);
      expect(url).toContain(`platform-tools_r${PLATFORM_TOOLS_VERSION}-`);
      expect(url).not.toContain("latest");
    }
    expect(platformToolsUrl("win32")).toBe(
      "https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip",
    );
    expect(platformToolsUrl("linux")).toContain("platform-tools_r37.0.1-linux.zip");
    expect(platformToolsUrl("darwin")).toContain("platform-tools_r37.0.1-darwin.zip");
  });
});
