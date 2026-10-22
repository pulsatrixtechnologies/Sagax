import { describe, expect, it } from "vitest";

import { controlHelperCommand, controlSupported, windowsControlScript } from "./remote-control-helper.ts";

describe("controlSupported", () => {
  it("is Windows only for now", () => {
    expect(controlSupported("windows")).toBe(true);
    expect(controlSupported("macos")).toBe(false);
    expect(controlSupported("linux")).toBe(false);
  });
});

describe("controlHelperCommand", () => {
  it("builds an encoded PowerShell command for Windows and nothing for other OSes", () => {
    const built = controlHelperCommand("windows", { fps: 6, quality: 60, maxSeconds: 3600 });
    expect(built).not.toBeNull();
    expect(built!.command.startsWith("powershell.exe -NoProfile -NonInteractive -EncodedCommand ")).toBe(true);
    const b64 = built!.command.split(" ").pop()!;
    const decoded = Buffer.from(b64, "base64").toString("utf16le");
    expect(decoded).toBe(built!.script);
    expect(controlHelperCommand("macos", { fps: 6, quality: 60, maxSeconds: 3600 })).toBeNull();
    expect(controlHelperCommand("linux", { fps: 6, quality: 60, maxSeconds: 3600 })).toBeNull();
  });
});

describe("windowsControlScript", () => {
  it("injects input with SendInput and streams JPEG frames without admin or disk writes", () => {
    const script = windowsControlScript({ fps: 6, quality: 60, maxSeconds: 3600 });
    // input injection
    expect(script).toContain("SendInput");
    expect(script).toContain("UNICODE");
    expect(script).toContain("WHEEL");
    // screen capture + jpeg
    expect(script).toContain("CopyFromScreen");
    expect(script).toContain("image/jpeg");
    // frame protocol: meta 0x4D, jpeg 0x46
    expect(script).toContain("Write-Frame 0x4D");
    expect(script).toContain("Write-Frame 0x46");
    // identical-frame skip (throttle)
    expect(script).toContain("$lastHash");
    // bounded deadline, no persistence, no admin elevation
    expect(script).toContain("AddSeconds(3600)");
    expect(script).not.toContain("RunAs");
    expect(script).not.toContain("New-Service");
    expect(script).not.toContain("schtasks");
  });

  it("clamps fps, quality and the deadline into safe ranges", () => {
    const script = windowsControlScript({ fps: 999, quality: 999, maxSeconds: 9_999_999 });
    expect(script).toContain("AddSeconds(93600)"); // 26 h cap
    // quality clamped to 90
    expect(script).toContain("[long]90");
    // fps clamped to 15 -> ~66 ms interval
    expect(script).toContain("Start-Sleep -Milliseconds 67");
  });
});
