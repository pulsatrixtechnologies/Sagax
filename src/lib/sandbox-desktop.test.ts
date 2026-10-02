import { describe, expect, it } from "vitest";

import type { DesktopBridgeStatus } from "./desktop-bridge";
import { sandboxViewerPath, sandboxViewerProblem, showsSandboxDesktop } from "./sandbox-desktop";

const bridge = (connected: boolean, place: "computer" | "server"): DesktopBridgeStatus => ({
  connected, tunnel: false, desktops: [], activity: [], workplace: { place, routines: false, network: "all" },
});

describe("server environment desktop in the Computer panel", () => {
  it("shows only where bots work in the server environment", () => {
    expect(showsSandboxDesktop(null, "auto")).toBe(false);
    expect(showsSandboxDesktop(bridge(true, "computer"), "auto")).toBe(false);
    expect(showsSandboxDesktop(bridge(false, "computer"), "auto")).toBe(true);
    expect(showsSandboxDesktop(bridge(true, "server"), "local")).toBe(true);
    expect(showsSandboxDesktop(bridge(false, "server"), "off")).toBe(false);
    expect(showsSandboxDesktop(bridge(false, "server"), "browser")).toBe(false);
  });

  it("asks for the caller's own desktop only, control on request", () => {
    expect(sandboxViewerPath(false)).toBe("/api/desktop-viewer/sandbox/me");
    expect(sandboxViewerPath(true, true)).toBe("/api/desktop-viewer/sandbox/me/websockify?control=1");
    expect(sandboxViewerProblem(403)).toBe("closed");
    expect(sandboxViewerProblem(429)).toBe("busy");
    expect(sandboxViewerProblem(409)).toBe("unavailable");
  });
});
