// What the app says about where bots work (src/lib/desktop-bridge.ts) and
// how the transcript names a tool that ran on the person's computer.
import { describe, expect, it } from "vitest";

import { loadDesktopBridge, readWorkplace, sameDesktopBridgeStatus, workplaceNotice, writeWorkplace, type DesktopBridgeStatus } from "./desktop-bridge";
import { toolExecutionTarget } from "../../shared/execution-target";
import { USER_PREFERENCE_KEYS } from "../../shared/user-preferences";
import { BOT_WORKPLACE_PREFERENCE } from "../../shared/bot-workplace";

const status = (connected: boolean): DesktopBridgeStatus => ({ connected, tunnel: connected, desktops: [], workplace: { place: "computer", routines: false, network: "all" }, activity: [] });

describe("where bots work, as the app says it", () => {
  it("speaks only when the bot works on the person's computer, and says when it is not connected", () => {
    expect(workplaceNotice(status(false), "computer")).toBe("fallback");
    expect(workplaceNotice(status(true), "computer")).toBe("computer");
    expect(workplaceNotice(status(true), "server")).toBeNull();
    expect(workplaceNotice(status(false), null)).toBeNull();
    expect(workplaceNotice(null, "computer")).toBeNull();
  });

  it("a solo server has no bridge; a failure is not 'no bridge'", async () => {
    expect(await loadDesktopBridge(async () => new Response("{}", { status: 404 }))).toBeNull();
    await expect(loadDesktopBridge(async () => new Response("{}", { status: 502 }))).rejects.toThrow();
  });

  it("the preference is one synced key", () => {
    expect(USER_PREFERENCE_KEYS).toContain(BOT_WORKPLACE_PREFERENCE);
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    expect(readWorkplace(storage)).toEqual({ place: "computer", routines: false, network: "all" });
    writeWorkplace({ place: "server", routines: true, network: "lan" }, storage);
    expect(readWorkplace(storage)).toEqual({ place: "server", routines: true, network: "lan" });
  });

  it("treats an equal bridge payload as the same status", () => {
    const first = status(true);
    const copy = JSON.parse(JSON.stringify(first)) as DesktopBridgeStatus;
    expect(sameDesktopBridgeStatus(first, copy)).toBe(true);
    expect(sameDesktopBridgeStatus(first, status(false))).toBe(false);
    expect(sameDesktopBridgeStatus(null, null)).toBe(true);
    expect(sameDesktopBridgeStatus(first, null)).toBe(false);
  });

  it("names a sagax-desktop tool as the person's computer", () => {
    expect(toolExecutionTarget("mcp__sagax-desktop__run_command")).toBe("user-desktop");
    expect(toolExecutionTarget("sagax-desktop__read_file")).toBe("user-desktop");
    expect(toolExecutionTarget("mcp__sagax-environment__run_command")).toBe("user-sandbox");
  });
});
