// The Computer tab on an organization server: the server environment (power,
// live desktop, usage) or the person's own computer (status and coarse
// facts, no power controls), whichever the person's bots use right now.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { formatBytes, powerState } from "@/lib/server-environment";
import { OrgComputerTab } from "./OrgComputerTab";

const bridge = (connected: boolean, place: "computer" | "server", system?: DesktopBridgeStatus["desktops"][number]["system"]): DesktopBridgeStatus => ({
  connected, tunnel: false, activity: [], workplace: { place, routines: false, network: "all" },
  desktops: connected ? [{ id: "d1", name: "Ada's Mac", platform: "darwin", online: true, busy: false, lastSeenAt: 1, capabilities: { localVm: true }, ...(system ? { system } : {}) }] : [],
});

describe("Computer tab on an organization server", () => {
  it("shows the server environment with its power controls, live desktop and usage panel", () => {
    const markup = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(false, "computer"), computerOff: false, botName: "Luna" }));
    expect(markup).toContain('data-org-computer="user-sandbox"');
    expect(markup).toContain("Server environment used by Luna");
    expect(markup).toContain('aria-label="Server environment power"');
    expect(markup).toContain('data-sandbox-desktop="idle"');
    expect(markup).toContain(">Disk<");
    expect(markup).toContain(">Memory<");
  });

  it("shows the person's own computer without shutdown or pause", () => {
    const markup = renderToStaticMarkup(createElement(OrgComputerTab, {
      bridge: bridge(true, "computer", { os: "macOS 27.0", arch: "arm64", cpus: 10, cpuPercent: 15, memoryGb: 32, memoryUsedGb: 18.5, diskGb: 994, diskFreeGb: 410 }),
      computerOff: true, botName: "Luna",
    }));
    expect(markup).toContain('data-org-computer="user-desktop"');
    expect(markup).toContain("Your computer · Ada&#x27;s Mac");
    expect(markup).toContain("macOS 27.0 arm64");
    expect(markup).toContain("18.5 GB of 32 GB");
    expect(markup).toContain("410 GB free of 994 GB");
    expect(markup).toContain("Start the Local VM");
    expect(markup).not.toContain("Shut down");
    expect(markup).not.toContain(">Pause<");
    expect(markup).toContain("This bot&#x27;s computer is off");
  });

  it("names each power state", () => {
    expect(powerState("missing", null)).toBe("off");
    expect(powerState("stopped", "start")).toBe("starting");
    expect(powerState("running", null)).toBe("running");
    expect(powerState("paused", null)).toBe("paused");
    expect(powerState("unavailable", null)).toBe("unavailable");
    expect(formatBytes(1536 * 1024 * 1024)).toBe("1.5 GiB");
    expect(formatBytes(null)).toBe("?");
  });
});
