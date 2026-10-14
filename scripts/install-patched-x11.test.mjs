import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(join(import.meta.dirname, "install-patched-x11.sh"), "utf8");

describe("install-patched-x11 pins", () => {
  it("pins the upstream commits that close the X11 HIGH findings, with sha256", () => {
    expect(script).toMatch(/LIBX11_COMMIT=6d4432b13c0b3b6a644c13de9c793a14db48d545/);
    expect(script).toMatch(/LIBX11_SHA256=88ea6ba3c1429f8bfc3385cd5e52ba24479d426fb4179ad6e6e51694228882bc/);
    expect(script).toMatch(/LIBXRENDER_COMMIT=0564bce5446550c1b1681f3d8a933c20ea1455f7/);
    expect(script).toMatch(/LIBXRENDER_SHA256=cb195bedd79c4e1a13933c34f83ddff79e940b1ed139d4b3e1d322b5edec0625/);
    expect(script).toContain("CVE-2026-88806");
    expect(script).toContain("CVE-2026-88807");
    expect(script).not.toMatch(/latest/);
    expect(script).toContain("gitlab.freedesktop.org/xorg/lib/libx11/-/archive/");
    expect(script).toContain("gitlab.freedesktop.org/xorg/lib/libxrender/-/archive/");
    expect(script).toContain("sha256 mismatch");
    expect(script).toContain("Package: $name");
    expect(script).toContain("sagax-libx11");
    expect(script).toContain("sagax-libxrender");
    expect(script).toContain("dpkg --purge --force-depends");
    expect(script).toContain("dpkg -i");
    expect(script).toContain("apt-mark hold");
    expect(script).toContain("Pin-Priority: -1");
    expect(script).toContain("libX11.so.6");
    expect(script).toContain("libXrender.so.1");
    expect(script).not.toMatch(/write_dummy libx11-6/);
    expect(script).not.toMatch(/write_dummy libxrender1/);
    expect(script).not.toMatch(/Package: libx11-6\n/);
    expect(script).not.toMatch(/Package: libxrender1\n/);
  });
});
