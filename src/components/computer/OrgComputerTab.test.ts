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
import { SandboxDesktopModal } from "./SandboxDesktopModal";
import { WorksOnControl, worksOnTip } from "./WorksOnSetting";

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
      const markup = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place, computerOff: false, botName: "Luna" }));
      expect(markup).toContain('data-org-computer="user-sandbox"');
      expect(markup).toContain('data-computer-source="server"');
      expect(markup).toContain('aria-label="Screen controls"');
      expect(markup).toContain("Luna&#x27;s screen");
      // Only the screen: no "works on" line, no description, usage folded.
      expect(markup).not.toContain("works on:");
      expect(markup).not.toContain("Your own isolated Linux machine");
      expect(markup).not.toContain(">Change<");
      expect(markup).toMatch(/data-usage-toggle[^>]*>|aria-expanded="false"[^>]*data-usage-toggle/);
      expect(markup).toContain(">Details");
      expect(markup).not.toContain(">Disk<");
      expect(markup).not.toContain(">Memory<");
    }
  });

  it("draws the bot's Works on under the screen when the panel passes it", () => {
    const bare = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "auto", computerOff: false, botName: "Luna" }));
    expect(bare).not.toContain('role="radiogroup"');
    const markup = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "auto", computerOff: false, botName: "Luna",
      worksOn: createElement(WorksOnControl, { value: null, onChange: () => {}, disabled: {} }) }));
    expect(markup.indexOf('role="radiogroup"')).toBeGreaterThan(markup.indexOf("data-computer-screen"));
    expect(markup.indexOf('role="radiogroup"')).toBeLessThan(markup.indexOf("data-usage-toggle"));
  });

  it("shows the owner's stale Local VM as an error with Repair, never raw JSON", () => {
    const markup = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "vm", computerOff: false, botName: "Luna", initialLocal: status(STALE) }));
    expect(markup).toContain('data-org-computer="user-desktop"');
    expect(markup).toContain('data-computer-screen="error"');
    expect(markup).toContain(">Error<");
    expect(markup).toContain(">Repair<");
    expect(markup).toContain("omb-org-mcp-Em133z");
    expect(markup).not.toContain("Luna works on");
    expect(markup).not.toContain("124.5 GB of 128 GB");
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

describe("the bot's Works on in the Computer tab", () => {
  it("is one compact control with short labels, the meaning in each tooltip", () => {
    const markup = renderToStaticMarkup(createElement(WorksOnControl, { value: "cloud", onChange: () => {}, disabled: {} }));
    expect(markup).toContain(">Computer<");
    expect(markup.match(/role="radio"/g)).toHaveLength(6);
    for (const label of [">Auto<", ">Cloud<", ">Local VM<", ">This computer<", ">Browser<", ">Off<"]) expect(markup).toContain(label);
    expect(markup).toMatch(/aria-checked="true"[^>]*data-works-on-choice="cloud"/);
    expect(markup).toContain('title="Your own Linux machine on the organization server"');
    // No long explanation box any more.
    expect(markup).not.toContain("Cloud is your server environment.");
    expect(markup).not.toContain("Auto (Cloud)");
  });

  it("explains a choice that cannot be picked in its tooltip", () => {
    const markup = renderToStaticMarkup(createElement(WorksOnControl, { value: null, onChange: () => {}, disabled: { local: "Open the Sagax app on this computer" } }));
    expect(markup).toMatch(/disabled=""[^>]*title="This computer is not available: Open the Sagax app on this computer"[^>]*data-works-on-choice="local"/);
    expect(markup).toMatch(/aria-checked="true"[^>]*data-works-on-choice="auto"/);
    expect(worksOnTip(null)).toBe("Chosen automatically: your server environment (Cloud)");
  });
});

describe("taking control of the server environment desktop", () => {
  const controls = { stop: () => {}, pause: () => {} };
  it("opens large, with the name, the state, Release control, Play / Pause / Stop, full screen and close", () => {
    const markup = renderToStaticMarkup(createElement(SandboxDesktopModal, { title: "Luna's screen", state: "running", controls, onClose: () => {} }));
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain("h-[88vh] w-[92vw]");
    expect(markup).toContain("Luna&#x27;s screen");
    expect(markup).toContain('data-power="running"');
    expect(markup).toContain("You have control");
    expect(markup).toMatch(/data-takeover-control="release"[^>]*>.*Release control/);
    expect(markup).toMatch(/aria-label="Pause"(?![^>]*disabled="")/);
    expect(markup).toMatch(/aria-label="Stop"(?![^>]*disabled="")/);
    expect(markup).toMatch(/aria-label="Start"[^>]*disabled=""/);
    expect(markup).toContain('aria-label="Full screen"');
    expect(markup).toMatch(/aria-label="Close and release control[^"]*"[^>]*data-takeover-close/);
    // The live view inside asks for control (data-control="1").
    expect(markup).toContain('data-control="1"');
  });

  it("keeps the small square view-only: its Take control opens the window", () => {
    const square = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "auto", computerOff: false, botName: "Luna" }));
    expect(square).not.toContain('data-control="1"');
    expect(square).not.toContain("data-sandbox-takeover");
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
