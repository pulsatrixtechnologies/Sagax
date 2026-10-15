// The Computer tab on an organization server: one screen like the solo panel
// (Play / Pause / Stop on it, "<Bot>'s screen" below), the computer the bot's
// Works on chooses (Works on itself is never a control on this screen), a
// picker of the screens to look at (Cloud and each PC by its name), the
// usage panel, and words for every state, never the desktop's raw answer.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { chosenComputer, computerChoices, type DesktopBridgeStatus } from "@/lib/desktop-bridge";
import { localVmView, parseLocalVmAnswer, runtimeSummaryKey, type DesktopLocalVmStatus } from "@/lib/desktop-local-vm";
import { formatBytes, powerState } from "@/lib/server-environment";
import { BOT_SECTIONS } from "../bot-settings/sections";
import { OrgComputerSettings } from "../settings/OrgComputerSettings";
import { ComputerScreen, controlsAlwaysShown, showsControlBar, showsStateChip } from "./ComputerScreen";
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
  it("shows the person's computer for Auto when the Sagax app is connected (Auto starts there)", () => {
    const markup = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "auto", computerOff: false, botName: "Luna" }));
    expect(markup).toContain('data-org-computer="user-desktop"');
    expect(markup).toContain('data-computer-source="local"');
    const offline = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(false, "computer"), place: "auto", computerOff: false, botName: "Luna" }));
    expect(offline).toContain('data-org-computer="user-sandbox"');
  });

  it("shows the server environment for Cloud, even with the person's computer connected", () => {
    for (const place of ["cloud"] as const) {
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

  it("shows only the screen: Works on is not a control inside this screen", () => {
    for (const place of ["auto", "cloud", "vm", "local"] as const) {
      const markup = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place, computerOff: false, botName: "Luna" }));
      // the one radio group is the screen picker, never Works on
      expect(markup.match(/role="radiogroup"/g)?.length ?? 0).toBeLessThanOrEqual(1);
      expect(markup).not.toContain("data-works-on-setting");
    }
    const ids = BOT_SECTIONS.map((entry) => entry.id);
    const worksOn = BOT_SECTIONS.find((entry) => entry.id === "worksOn");
    expect(ids.indexOf("worksOn")).toBe(ids.indexOf("access") + 1);
    expect(worksOn?.label).toBe("Workspace");
    expect(worksOn?.labelKey).toBe("computer.worksOn");
  });

  it("lists Cloud and each of the person's computers by name, and shows the one picked", () => {
    const two: DesktopBridgeStatus = {
      ...bridge(true, "computer"),
      desktops: [
        { id: "d1", name: "JeanChrophesMBP", platform: "darwin", online: true, busy: false, lastSeenAt: 1, capabilities: { localVm: true } },
        { id: "d2", name: "office-PC-07", platform: "win32", online: true, busy: false, lastSeenAt: 5, capabilities: { localVm: true } },
        { id: "d3", name: "Old-Laptop", platform: "linux", online: false, busy: false, lastSeenAt: 9, capabilities: { localVm: true } },
        { id: "d4", name: "NoVm", platform: "darwin", online: true, busy: false, lastSeenAt: 3, capabilities: { localVm: false } },
      ],
    };
    const choices = computerChoices(two);
    // Cloud first, then the online computers that can run a Local VM, newest first
    expect(choices.map((choice) => choice.key)).toEqual(["server", "desktop:d2", "desktop:d1"]);
    // the first screen is where the bot works, unless another was picked
    expect(chosenComputer(choices, "server", two, null)?.key).toBe("server");
    expect(chosenComputer(choices, "local", two, null)?.key).toBe("desktop:d2");
    expect(chosenComputer(choices, "server", two, "desktop:d1")?.key).toBe("desktop:d1");
    expect(chosenComputer(choices, "server", two, "desktop:d3")?.key).toBe("server");

    const markup = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: two, place: "vm", computerOff: false, botName: "Luna" }));
    expect(markup).toContain('data-computer-picker=""');
    expect(markup).toContain(">Cloud<");
    expect(markup).toContain(">office-PC-07<");
    expect(markup).toContain(">JeanChrophesMBP<");
    expect(markup).not.toContain("Old-Laptop");
    expect(markup).not.toContain(">NoVm<");
    // the bot works on the current computer: its chip is checked and dotted
    expect(markup).toMatch(/aria-selected="true" data-computer-choice="desktop:d2"[^>]*title="office-PC-07: this bot works here"/);
    expect(markup).toContain("Luna&#x27;s screen · office-PC-07");
    expect(markup).toContain('data-org-computer="user-desktop"');
  });

  it("shows no picker when there is only the cloud to look at", () => {
    const markup = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(false, "server"), place: "cloud", computerOff: false, botName: "Luna" }));
    expect(markup).not.toContain("data-computer-picker");
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

  it("shows a state chip only when the state is not obvious from the screen", () => {
    expect(showsStateChip("running")).toBe(false);
    for (const state of ["off", "starting", "paused", "error"] as const) expect(showsStateChip(state)).toBe(true);
    const running = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "vm", computerOff: false, botName: "Luna", initialLocal: status({ ...STALE, state: "running", stale: null, folder: "/Users/jc/.openmausbot/vm-home", folderExists: true }) }));
    expect(running).not.toContain("data-power=");
    const paused = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "vm", computerOff: false, botName: "Luna", initialLocal: status({ ...STALE, state: "paused", stale: null, folder: "/Users/jc/.openmausbot/vm-home", folderExists: true }) }));
    expect(paused).toContain('data-power="paused"');
    const off = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "local", computerOff: false, botName: "Luna", initialLocal: status(null) }));
    expect(off).toContain('data-power="off"');
    const error = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "vm", computerOff: false, botName: "Luna", initialLocal: status(STALE) }));
    expect(error).toContain('data-power="error"');
  });

  it("hides Play / Pause / Stop until intent, except Play on a machine that is off", () => {
    expect(controlsAlwaysShown("off")).toBe(true);
    for (const state of ["running", "starting", "paused", "error"] as const) expect(controlsAlwaysShown(state)).toBe(false);
    const running = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "vm", computerOff: false, botName: "Luna", initialLocal: status({ ...STALE, state: "running", stale: null, folder: "/Users/jc/.openmausbot/vm-home", folderExists: true }) }));
    expect(running).toContain('data-controls="hidden"');
    expect(running).toMatch(/data-screen-controls="hidden"[^>]*pointer-events-none opacity-0/);
    // Off with nothing else to press: Play is shown at once.
    const serverOff = renderToStaticMarkup(createElement(ComputerScreen, { source: "server", state: "off", caption: "Luna's screen", controls: { play: () => {} } }));
    expect(serverOff).toContain('data-screen-controls="shown"');
    expect(serverOff).toMatch(/<button[^>]*aria-label="Start"/);
  });

  // JC 2026-10-14: on the Local VM that is off, Démarrer sat on top of the
  // floating Play / Pause / Stop bar. The off screen's own primary action
  // replaces the bar; elsewhere the bar sits under the state, never over it.
  it("never draws Démarrer and the control bar together on a machine that is off", () => {
    expect(showsControlBar("off", { play: () => {} }, [{ label: "Start", onClick: () => {}, primary: true }])).toBe(false);
    expect(showsControlBar("off", { play: () => {} }, [])).toBe(true);
    expect(showsControlBar("running", { pause: () => {} }, [])).toBe(true);
    expect(showsControlBar("off", undefined, [])).toBe(false);
    const off = renderToStaticMarkup(createElement(OrgComputerTab, { bridge: bridge(true, "computer"), place: "local", computerOff: false, botName: "Luna",
      initialLocal: status({ ...STALE, state: "exited", stale: null, folder: "/Users/jc/.openmausbot/vm-home", folderExists: true }) }));
    expect(off).toContain('data-computer-screen="off"');
    expect(off).toMatch(/<button[^>]*>Start<\/button>/);
    expect(off).not.toContain("data-screen-controls");
    // A state with the bar but no live screen keeps it in the screen's flow, under the words.
    const serverOff = renderToStaticMarkup(createElement(ComputerScreen, { source: "server", state: "off", caption: "Luna's screen", message: "Off", controls: { play: () => {} } }));
    expect(serverOff).toMatch(/data-screen-controls="shown" class="[^"]*mb-2 shrink-0/);
    expect(serverOff).not.toMatch(/data-screen-controls="shown" class="[^"]*absolute/);
  });

  it("keeps the caption on one line, with the whole name in its tooltip", () => {
    const markup = renderToStaticMarkup(createElement(ComputerScreen, { source: "local", state: "off", caption: "Assistant's screen · Jean-Christophes-Macbook-Pro.local", controls: {} }));
    expect(markup).toMatch(/<figcaption class="truncate[^"]*" title="Assistant&#x27;s screen · Jean-Christophes-Macbook-Pro.local">/);
  });
});

describe("the bot's Works on", () => {
  it("uses the same place names as the composer chip, with the meaning in each tooltip", () => {
    const markup = renderToStaticMarkup(createElement(WorksOnControl, { value: "cloud", onChange: () => {}, disabled: {}, organization: true }));
    // the Workspace page titles it: one visible title, the heading for the
    // radio group read by assistive tech only, the meaning shown under it
    expect(markup).not.toContain("border-t border-hairline/40 pt-5");
    expect(markup).toContain('<h3 id="works-on-setting" class="sr-only">Workspace</h3>');
    expect(markup).toMatch(/<p id="works-on-setting-hint"[^>]*>Where this bot works\./);
    expect(markup.match(/role="radio"/g)).toHaveLength(6);
    for (const label of [">Auto · picks per task<", ">Cloud (server environment)<", ">Local VM<", ">This computer<", ">Browser<", ">Off<"]) expect(markup).toContain(label);
    expect(markup).toMatch(/aria-checked="true"[^>]*data-works-on-choice="cloud"/);
    expect(markup).toContain('title="Your own Linux machine on the organization server"');
    expect(markup).not.toContain("Cloud is your server environment.");
  });

  it("explains a choice that cannot be picked in its tooltip", () => {
    const markup = renderToStaticMarkup(createElement(WorksOnControl, { value: null, onChange: () => {}, disabled: { local: "Open the Sagax app on this computer" } }));
    expect(markup).toMatch(/disabled=""[^>]*title="This computer is not available: Open the Sagax app on this computer"[^>]*data-works-on-choice="local"/);
    expect(markup).toMatch(/aria-checked="true"[^>]*data-works-on-choice="auto"/);
    expect(worksOnTip(null)).toMatch(/^Picks the place for each task: your computer when the Sagax app is connected, the browser for web work, the cloud for routines/);
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
    expect(activeComputer(bridge(true, "computer"), "auto")).toEqual({ source: "local", reason: "computer" });
    expect(activeComputer(bridge(false, "computer"), "auto")).toEqual({ source: "server", reason: "cloud" });
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
    expect(markup).toContain("Bots whose Workspace is Local VM");
    expect(markup).not.toContain("Each bot&#x27;s Workspace decides");
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
