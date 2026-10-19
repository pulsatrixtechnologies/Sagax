import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UpdaterState } from "@/lib/updater";

const fixture = vi.hoisted(() => ({ state: { status: "idle" } as UpdaterState }));
// As the real hook: no state without the desktop app's updater bridge.
vi.mock("@/lib/updater", () => ({ useUpdaterState: () => (window.ogb?.updater ? fixture.state : null) }));
vi.mock("@/lib/brand", () => ({ brand: () => ({ name: "Sagax" }) }));
import { readyBody, UpdateBanner, UpdateCheckDialog, UpdateNotesDialog, UpdateProblemDialog, updateView } from "./UpdateBanner";

afterEach(() => vi.unstubAllGlobals());
function render(state: UpdaterState, window: object = { ogb: { updater: {} } }) {
  fixture.state = state;
  vi.stubGlobal("window", window);
  return renderToStaticMarkup(createElement(UpdateBanner));
}

const LOCAL = "http://127.0.0.1:8799";
const OTHER = "https://bots.example.test";
/** The window.ogb that electron/preload.cjs gives a server's page; `answered`:
 * whether main answers that page about updates. */
function serverPageBridge(origin: string, answered: boolean) {
  let bridge: unknown;
  vm.runInNewContext(readFileSync(new URL("../../electron/preload.cjs", import.meta.url), "utf8"), {
    process: { platform: "darwin", argv: [`--omb-local-origin=${LOCAL}`] },
    location: { origin }, navigator: { userActivation: { isActive: false } },
    TextEncoder, localStorage: { getItem: () => null },
    require: () => ({
      webUtils: {},
      contextBridge: { exposeInMainWorld: (_name: string, value: unknown) => { bridge = value; } },
      ipcRenderer: {
        on() {}, removeListener() {}, send() {}, invoke: () => Promise.resolve({ status: "idle" }),
        sendSync: (channel: string) => channel === "update:offered" && answered,
      },
    }),
  });
  return bridge;
}

describe("UpdateBanner", () => {
  it("is absent from another server's page, which never gets the updater", () => {
    const ogb = serverPageBridge(OTHER, false) as { updater?: unknown };
    expect(ogb.updater).toBeUndefined();
    expect(render({ status: "downloaded", version: "0.2.0" }, { location: { origin: OTHER }, ogb })).toBe("");
  });

  it("cannot restart or retry while macOS is preparing the downloaded bytes", () => {
    const html = render({ status: "preparing", version: "0.2.0", percent: 100 });
    expect(html).toContain("Preparing the update…");
    expect(html).toContain("macOS is preparing the update.");
    expect(html).toContain("disabled=\"\"");
    expect(html).not.toContain("Restart to update");
    expect(html).not.toContain("Try again");
    expect(html).not.toContain("Dismiss");
  });

  it("offers restart only after native preparation is complete", () => {
    const html = render({ status: "downloaded", version: "0.2.0" });
    expect(html).toContain(">Update ready</h2>");
    expect(html).toContain("Restart to finish installing Sagax 0.2.0. Your bots and work will be right where you left them.");
    expect(html).toContain(">Later</button>");
    expect(html).toContain(">Restart to install</button>");
  });

  it("keeps the release notes folded under What's new until asked", () => {
    const html = render({ status: "downloaded", version: "0.2.0", notes: "## Fixes\n\n- One" });
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("What&#x27;s new in 0.2.0");
    expect(html).not.toContain(">Fixes<");
    expect(html).toContain("max-w-[400px]");
  });

  it("keeps restart busy and displays the recovery instruction", () => {
    const html = render({ status: "installing", message: "Restart is taking longer than expected. Quit the app completely." });
    expect(html).toContain("Quit the app completely.");
    expect(html).toContain("disabled=\"\"");
    expect(html).not.toContain("Try again");
  });

  it("shows a preparation failure with a recovery action", () => {
    const html = render({ status: "error", message: "Native staging failed" });
    expect(html).toContain("Update failed");
    expect(html).toContain("Native staging failed");
    expect(html).toContain("Try again");
  });

  it.each(["ETIMEDOUT while staging", "native error ".repeat(30)])("preserves restart recovery for a nonretryable error: %s", (message) => {
    const html = render({ status: "error", retryable: false, message });
    expect(html).toContain("Quit and reopen Sagax before trying the update again.");
    expect(html).not.toContain("Try again");
    expect(html).toContain("Dismiss");
  });

  it("preserves system package hand-off without promising restart", () => {
    const html = render({ status: "downloaded", version: "0.2.0", installMode: "handoff" });
    expect(html).toContain("Install in a terminal");
    expect(html).toContain(">Install</button>");
    expect(html).not.toContain("Restart to finish installing");
    expect(html).not.toContain(">Restart to install</button>");
  });

  it("shows the failure cause as well as the required restart without offering a retry", () => {
    const html = render({ status: "error", retryable: false,
      message: "Not enough disk space to prepare the update. Free some space, then try again. Quit and reopen Sagax before trying the update again.",
    });
    expect(html).toContain("Free some space");
    expect(html).toContain("Quit and reopen Sagax");
    expect(html).not.toContain("Try again</button>");
  });
});

// 2026-10-19 (a Windows report): "Check for updates" restarted into a silent
// install with nothing on screen. The person's check now opens the dialog
// and follows it; only "Restart to install" installs.
describe("the person's own check, followed in the dialog", () => {
  const noop = () => {};

  it("shows every step of a check the person asked for, and stays quiet for a background one", () => {
    const at = (status: UpdaterState["status"], follow: "checking" | "done" | null) => updateView({ status, version: "0.5.24" }, follow);
    expect(at("idle", "checking")).toBe("checking");
    expect(at("checking", "checking")).toBe("checking");
    expect(at("checking", "done")).toBe("checking");
    expect(at("idle", "done")).toBe("up-to-date");
    expect(at("downloading", "checking")).toBe("notes");
    expect(at("downloaded", "done")).toBe("notes");
    expect(at("error", "done")).toBe("problem-dialog");
    // an older failure does not flash while the new check runs
    expect(at("error", "checking")).toBe("checking");
    // background: nothing until the update is ready
    expect(at("idle", null)).toBe("none");
    expect(at("checking", null)).toBe("none");
    expect(at("downloading", null)).toBe("none");
    expect(at("downloaded", null)).toBe("notes");
    expect(at("error", null)).toBe("problem-card");
    expect(updateView(null, "checking")).toBe("none");
  });

  it("says it is checking, then that Sagax is up to date", () => {
    vi.stubGlobal("window", { ogb: { updater: {} } });
    const checking = renderToStaticMarkup(createElement(UpdateCheckDialog, { checking: true, onDismiss: noop }));
    expect(checking).toContain("Checking for updates…");
    expect(checking).toContain('aria-busy="true"');
    const done = renderToStaticMarkup(createElement(UpdateCheckDialog, { checking: false, onDismiss: noop }));
    expect(done).toContain("Sagax is up to date");
    expect(done).toContain(">Close</button>");
  });

  it("names the update found, its notes and the download's progress, with Later open and no install", () => {
    vi.stubGlobal("window", { ogb: { updater: {} } });
    const html = renderToStaticMarkup(createElement(UpdateNotesDialog, {
      state: { status: "downloading", version: "0.5.24", percent: 40, notes: "## Fixes" },
      pending: null, onDismiss: noop, onUpdate: noop,
    }));
    expect(html).toContain(">Sagax 0.5.24 is available</h2>");
    expect(html).toContain("It downloads in the background.");
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain("What&#x27;s new in 0.5.24");
    expect(html).toMatch(/<button type="button" class="[^"]*">Later<\/button>/);
    expect(html).not.toContain(">Restart to install</button>");
  });

  it("on Windows, says the installer shows its progress and Sagax opens again", () => {
    expect(readyBody({ status: "downloaded", version: "0.5.24" }, true))
      .toBe("Restart to install Sagax 0.5.24. Sagax closes, the installer shows its progress, then Sagax opens again. Your bots and work will be right where you left them.");
    expect(readyBody({ status: "downloaded", version: "0.5.24" }, false)).toContain("Restart to finish installing Sagax 0.5.24.");
    vi.stubGlobal("window", { ogb: { platform: "win32", updater: {} } });
    const html = renderToStaticMarkup(createElement(UpdateNotesDialog, {
      state: { status: "installing", version: "0.5.24" }, pending: "install", onDismiss: noop, onUpdate: noop,
    }));
    expect(html).toContain("Sagax is closing. The installer shows its progress, then opens Sagax again.");
    expect(html).toMatch(/disabled=""[^>]*>Later<\/button>/);
  });

  it("shows a failed check clearly, with Try again", () => {
    vi.stubGlobal("window", { ogb: { updater: {} } });
    const html = renderToStaticMarkup(createElement(UpdateProblemDialog, {
      state: { status: "error", message: "net::ERR_INTERNET_DISCONNECTED" }, pending: null, onDismiss: noop, onRetry: noop,
    }));
    expect(html).toContain(">Update failed</h2>");
    expect(html).toContain("Couldn&#x27;t reach the update server.");
    expect(html).toContain(">Try again</button>");
  });

  it("only the dialog's Restart to install installs, and it says it was confirmed", () => {
    const source = readFileSync(new URL("./UpdateBanner.tsx", import.meta.url), "utf8");
    expect(source.match(/updater\.install\(/g)).toHaveLength(1);
    expect(source).toContain("void updater.install({ confirmed: true });");
    for (const file of ["./SidebarProfileMenu.tsx", "./SettingsModal.tsx", "./SidebarUpdatePill.tsx"]) {
      expect(readFileSync(new URL(file, import.meta.url), "utf8"), file).not.toMatch(/updater\??\.install\(/);
    }
  });
});

