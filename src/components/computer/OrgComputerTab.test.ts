// The Computer tab on an organization server: one screen like the solo panel
// (Play / Pause / Stop on it, "<Bot>'s screen" below), the computer the bot's
// Works on names (no selector) with a link to change it, the usage panel,
// and words for every state, never the desktop's raw answer.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { localVmView, parseLocalVmAnswer, runtimeSummaryKey, type DesktopLocalVmStatus } from "@/lib/desktop-local-vm";
import { formatBytes, powerState } from "@/lib/server-environment";
import { OrgComputerSettings } from "../settings/OrgComputerSettings";
import { activeComputer, OrgComputerTab, setupProgress } from "./OrgComputerTab";

const SYSTEM = { os: "macOS 27.0.0", arch: "arm64", cpus: 16, cpuModel: "Apple M3 Max", cpuPercent: 90, memoryGb: 128, memoryUsedGb: 124.5, diskGb: 994, diskFreeGb: 410 };
const bridge = (connected: boolean, place: "computer" | "server"): DesktopBridgeStatus => ({
  connected, tunnel: false, activity: [], workplace: { place, routines: false, network: "all" },
  desktops: connected ? [{ id: "d1", name: "JeanChrophesMBP", platform: "darwin", online: true, busy: false, lastSeenAt: 1, capabilities: { localVm: true }, system: SYSTEM }] : [],
});
const runtime = { found: true, runtime: "docker" as const, cli: "docker", product: "Docker Desktop", daemonUp: true, installed: ["Docker Desktop"] };
const status = (vm: DesktopLocalVmStatus["vm"], extra: Partial<DesktopLocalVmStatus> = {}): DesktopLocalVmStatus => ({ runtime, workspace: "/Users/jc/.openmausbot/vm-home", vm, setup: null, install: null, ...extra });
const STALE = { name: "openmausbot-computer", state: "exited", managed: true, stale: "missing_folder" as const, folder: "/private/var/folders/5f/T/omb-org-mcp-Em133z/.openmausbot/vm-home", folderExists: false };

describe("Computer tab on an organization server", () => {
  it("shows the server environment for Auto and Cloud, even with the person's computer connected", () => {
    for (const place of ["auto", "cloud"] as const) {
      const markup = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place, computerOff: false, botName: "Luna", onChangePlace: () => {} }));
      expect(markup).toContain('data-org-computer="user-sandbox"');
      expect(markup).toContain('data-computer-source="server"');
      expect(markup).toContain('aria-label="Screen controls"');
      expect(markup).toContain("Luna&#x27;s screen");
      expect(markup).toContain(place === "auto" ? "Luna works on: Auto (Cloud)." : "Luna works on: Cloud (server environment).");
      expect(markup).toContain(">Change<");
      expect(markup).toContain(">Disk<");
      expect(markup).toContain(">Memory<");
    }
  });

  it("has no selector of its own: the bot's Works on decides", () => {
    const markup = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "auto", computerOff: false, botName: "Luna" }));
    expect(markup).not.toContain('role="radiogroup"');
    expect(markup).not.toContain("My computer (Local VM)");
    expect(markup).not.toContain("Where this bot works");
  });

  it("shows the owner's stale Local VM as an error with Repair, never raw JSON", () => {
    const markup = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "vm", computerOff: false, botName: "Luna", initialLocal: status(STALE) }));
    expect(markup).toContain('data-org-computer="user-desktop"');
    expect(markup).toContain('data-computer-screen="error"');
    expect(markup).toContain(">Error<");
    expect(markup).toContain(">Repair<");
    expect(markup).toContain("omb-org-mcp-Em133z");
    expect(markup).toContain("Luna works on: Local VM.");
    expect(markup).toContain("Your own computer (JeanChrophesMBP), through the Sagax app.");
    expect(markup).toContain("124.5 GB of 128 GB");
    expect(markup).not.toContain("localVms");
    expect(markup).not.toMatch(/\{&quot;|\{"/);
    expect(markup).not.toContain("<pre");
  });

  it("names each state of the screen", () => {
    const running = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "vm", computerOff: true, botName: "Luna", initialLocal: status({ ...STALE, state: "running", stale: null, folder: "/Users/jc/.openmausbot/vm-home", folderExists: true }) }));
    expect(running).toContain('data-computer-screen="running"');
    expect(running).toContain(">Running<");
    expect(running).toMatch(/<button[^>]*aria-label="Pause"(?![^>]*disabled="")/);
    expect(running).toMatch(/<button[^>]*aria-label="Stop"(?![^>]*disabled="")/);
    expect(running).toContain("This bot&#x27;s computer is off");
    const missing = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "local", computerOff: false, botName: "Luna", initialLocal: status(null) }));
    expect(missing).toContain(">Off<");
    expect(missing).toContain("Set up in one click");
  });
});

describe("the Local VM's view", () => {
  it("maps the desktop's status to Off, Starting, Running, Paused and Error", () => {
    expect(localVmView(null, false).problem).toBe("not_connected");
    expect(localVmView(status(STALE), true)).toMatchObject({ state: "error", problem: "stale", repair: true, canPlay: true, playNeedsConsent: true });
    expect(localVmView(status(null), true)).toMatchObject({ state: "off", problem: "missing", canPlay: true, playNeedsConsent: true });
    const healthy = { ...STALE, stale: null, folderExists: true };
    expect(localVmView(status({ ...healthy, state: "running" }), true)).toMatchObject({ state: "running", canPause: true, canStop: true, canPlay: false });
    expect(localVmView(status({ ...healthy, state: "paused" }), true)).toMatchObject({ state: "paused", canResume: true, canStop: true });
    expect(localVmView(status({ ...healthy, state: "exited" }), true)).toMatchObject({ state: "off", canPlay: true, playNeedsConsent: false });
    expect(localVmView(status(null), true, "setup").state).toBe("starting");
    expect(localVmView(status({ ...STALE, stale: "foreign" }), true)).toMatchObject({ state: "error", problem: "foreign", canPlay: false });
    expect(localVmView(status(null, { runtime: { ...runtime, daemonUp: false } }), true)).toMatchObject({ problem: "runtime_stopped", canPlay: true });
    expect(localVmView(status(null, { runtime: { found: false, runtime: null, cli: null, product: null, daemonUp: false, installed: [] } }), true)).toMatchObject({ state: "error", problem: "no_runtime" });
    const failed = status(null, { setup: { state: "error", steps: [], error: "boom", code: "no_runtime", previousFolder: null } });
    expect(localVmView(failed, true).problem).toBe("no_runtime");
  });

  it("reads the desktop's answer and says which runtime it found", () => {
    const answer = parseLocalVmAnswer({ result: { content: [{ type: "text", text: JSON.stringify(status(STALE)) }] } });
    expect(answer.status?.vm?.stale).toBe("missing_folder");
    expect(parseLocalVmAnswer({ result: { content: [{ type: "text", text: "nope" }], isError: true } })).toMatchObject({ ok: false, text: "nope" });
    expect(parseLocalVmAnswer({ result: { content: [{ type: "image", data: "aGk=", mimeType: "image/png" }] } }).image).toBe("data:image/png;base64,aGk=");
    expect(runtimeSummaryKey(runtime)).toEqual({ key: "localVm.runtime.running", product: "Docker Desktop" });
    expect(runtimeSummaryKey({ ...runtime, daemonUp: false, product: "OrbStack" })).toEqual({ key: "localVm.runtime.stopped", product: "OrbStack" });
    expect(runtimeSummaryKey(null).key).toBe("localVm.runtime.none");
    expect(setupProgress([{ id: "runtime", state: "done", detail: "" }, { id: "image", state: "running", detail: "" }, { id: "container", state: "pending", detail: "" }, { id: "start", state: "pending", detail: "" }])).toBe("Step 2 of 4: Desktop image");
  });

  it("says which computer the bot's Works on uses and why", () => {
    expect(activeComputer(bridge(true, "computer"), "auto")).toEqual({ source: "server", reason: "cloud" });
    expect(activeComputer(bridge(true, "computer"), "cloud")).toEqual({ source: "server", reason: "cloud" });
    expect(activeComputer(bridge(true, "server"), "vm")).toEqual({ source: "local", reason: "computer" });
    expect(activeComputer(bridge(false, "computer"), "local")).toEqual({ source: "local", reason: "notConnected" });
    expect(activeComputer(bridge(true, "computer"), "off")).toEqual({ source: "server", reason: "none" });
    expect(activeComputer(bridge(true, "computer"), "browser")).toEqual({ source: "server", reason: "none" });
    expect(powerState("missing", null)).toBe("off");
    expect(powerState("stopped", "start")).toBe("starting");
    expect(formatBytes(1536 * 1024 * 1024)).toBe("1.5 GiB");
  });
});

describe("Settings > Computer on an organization server", () => {
  it("shows where bots work, the Local VM with the runtime found and one-click setup, and the server environment", () => {
    const markup = renderToStaticMarkup(createElement(OrgComputerSettings, {
      bridge: bridge(true, "computer"), initialLocal: status(STALE),
      initialServer: { configured: true, state: "stopped", limits: { memoryMb: 1024, cpus: 1, pids: 256, diskMb: 2048, tmpMb: 256 }, pendingDeletionAt: null },
    }));
    expect(markup).toContain("Where bots work");
    expect(markup).toContain("Each bot&#x27;s Works on decides");
    expect(markup).not.toContain('role="radiogroup"');
    expect(markup).toContain("Docker Desktop found and running");
    expect(markup).not.toContain("Install a supported container runtime first");
    expect(markup).toContain('data-local-vm-problem="stale"');
    expect(markup).toContain(">Repair<");
    expect(markup).toContain("Server environment");
    expect(markup).toContain("Show the screen");
  });

  it("offers installs only when no runtime was found", () => {
    const none = renderToStaticMarkup(createElement(OrgComputerSettings, {
      bridge: bridge(true, "computer"),
      initialLocal: status(null, { runtime: { found: false, runtime: null, cli: null, product: null, daemonUp: false, installed: [] } }),
      initialServer: { configured: false },
    }));
    expect(none).toContain("data-install-offers");
    expect(none).toContain("Get OrbStack");
    expect(none).toContain("Get Docker Desktop");
    expect(none).toContain("No container engine found");
  });
});
