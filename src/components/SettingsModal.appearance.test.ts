import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { AppSettingsSection } from "@/state/store";
import type { Switch } from "./SettingsPrimitives";
import { SettingsModal } from "./SettingsModal";

vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));

const fixture = vi.hoisted(() => ({
  section: "appearance" as AppSettingsSection,
  showThreads: true,
  setShowThreads: vi.fn(),
  showRunCard: true,
  setShowRunCard: vi.fn(),
  sidebarDensity: "comfortable" as "comfortable" | "compact" | "icons",
  setSidebarDensity: vi.fn(),
  notificationSounds: true,
  nudgeSound: true,
  setNudgeSound: vi.fn(),
  setNotificationSounds: vi.fn(),
  api: vi.fn(),
  dispatch: vi.fn(),
  switches: [] as ComponentProps<typeof Switch>[],
}));
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: {} }) }));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({ state: { appSettingsSection: fixture.section, instances: [] }, dispatch: fixture.dispatch }),
}));
vi.mock("@/lib/thread-preferences", () => ({
  useShowThreads: () => fixture.showThreads,
  setShowThreads: fixture.setShowThreads,
}));
vi.mock("@/lib/run-card-preferences", () => ({
  useShowRunCard: () => fixture.showRunCard,
  setShowRunCard: fixture.setShowRunCard,
}));
vi.mock("@/lib/sidebar-preferences", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/sidebar-preferences")>(),
  useSidebarDensity: () => fixture.sidebarDensity,
  setSidebarDensity: fixture.setSidebarDensity,
}));
vi.mock("@/lib/notification-preferences", () => ({
  useNotificationSounds: () => fixture.notificationSounds,
  useNudgeSound: () => fixture.nudgeSound,
  setNudgeSound: fixture.setNudgeSound,
  setNotificationSounds: fixture.setNotificationSounds,
}));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: vi.fn() }));
vi.mock("./SettingsPrimitives", async (importOriginal) => {
  const original = await importOriginal<typeof import("./SettingsPrimitives")>();
  return {
    ...original,
    Switch: (props: ComponentProps<typeof Switch>) => {
      fixture.switches.push(props);
      return createElement(original.Switch, props);
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  fixture.section = "appearance";
  fixture.showThreads = true;
  fixture.showRunCard = true;
  fixture.sidebarDensity = "comfortable";
  fixture.notificationSounds = true;
  fixture.nudgeSound = true;
  fixture.switches = [];
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  setLocale("en");
});

afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

const render = () => renderToStaticMarkup(createElement(SettingsModal));

describe("Settings → Appearance", () => {
  it("groups skins, thread visibility, and tool-call display with preservation copy", () => {
    const html = render();
    expect(html).toContain('<option value="appearance" selected="">Appearance</option>');
    expect(html).toContain("Midnight");
    expect(html).toContain('aria-label="Show threads"');
    expect(html).toContain('aria-label="Show tool calls in chat"');
    expect(html).not.toContain("on this device only");
    expect(html).not.toContain("data-settings-scope");
    expect(html).not.toContain("Follows your account");
    expect(html).not.toContain("This device only");
    expect(html).not.toContain("Everyone on this server");
    expect(html).toContain("all conversation history and running work");
    expect(html).toContain("channels are unchanged");
    expect(html).toContain("Turn this back on");
    expect(html).not.toContain("Maximum turn length");
  });

  it.each([true, false])("only updates the local preference when the switch is %s", (enabled) => {
    fixture.showThreads = enabled;
    render();
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Show threads")!;
    expect(toggle.checked).toBe(enabled);
    toggle.onClick!({} as never);
    expect(fixture.setShowThreads).toHaveBeenCalledWith(!enabled);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it.each([true, false])("mutes notification sounds on this computer only when the switch is %s", (enabled) => {
    fixture.notificationSounds = enabled;
    const html = render();
    expect(html).toContain('aria-label="Notification sounds"');
    expect(html).toContain("keep the banners but lose the chime");
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Notification sounds")!;
    expect(toggle.checked).toBe(enabled);
    toggle.onClick!({} as never);
    expect(fixture.setNotificationSounds).toHaveBeenCalledWith(!enabled);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it.each([true, false])("toggles the nudge sound on this computer only when the switch is %s", (enabled) => {
    fixture.nudgeSound = enabled;
    render();
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Nudge sound")!;
    expect(toggle.checked).toBe(enabled);
    toggle.onClick!({} as never);
    expect(fixture.setNudgeSound).toHaveBeenCalledWith(!enabled);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ["comfortable", "Comfortable"],
    ["compact", "Compact"],
    ["icons", "Avatars only"],
  ] as const)("shows the saved sidebar density (%s) in Appearance", (density, label) => {
    fixture.sidebarDensity = density;
    const html = render();
    expect(html).toContain('aria-label="Choose sidebar density"');
    expect(html).toContain("Sidebar density");
    expect(html).toContain("collapsing the sidebar from its header");
    expect(html).toContain(`<option value="${density}" selected="">${label}</option>`);
    for (const option of ["Comfortable", "Compact", "Avatars only"]) expect(html).toContain(`>${option}</option>`);
    expect(fixture.setSidebarDensity).not.toHaveBeenCalled();
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("offers the run card visibility toggle in Appearance", () => {
    fixture.showRunCard = true;
    const html = render();
    expect(html).toContain('aria-label="Show the run card"');
    expect(html).toContain("This run");
    expect(html).toContain("saving the run as a skill");
    const toggle = fixture.switches.find((props) => props["aria-label"] === "Show the run card")!;
    expect(toggle.checked).toBe(true);
    toggle.onClick!({} as never);
    expect(fixture.setShowRunCard).toHaveBeenCalledWith(false);
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();

    fixture.showRunCard = false;
    render();
    const off = fixture.switches.filter((props) => props["aria-label"] === "Show the run card").at(-1)!;
    expect(off.checked).toBe(false);
    off.onClick!({} as never);
    expect(fixture.setShowRunCard).toHaveBeenLastCalledWith(true);
  });

  it("leaves non-appearance General settings in place", () => {
    fixture.section = "general";
    const html = render();
    expect(html).toContain("Profile");
    expect(html).toContain("Maximum turn length");
    expect(html).toContain("Maximum running threads per bot");
    expect(html).toContain("Automatic recovery");
    expect(html).toContain('aria-label="App language"');
    expect(html).toContain("Diagnostics");
    expect(html).not.toContain('aria-label="Show threads"');
    expect(html).not.toContain('aria-label="Choose sidebar density"');
    expect(html).not.toContain('aria-label="Show tool calls in chat"');
    expect(html).not.toContain("Midnight");
  });

  it("makes local appearance available remotely without exposing server settings", () => {
    vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
    const html = render();
    expect(html).toContain('<option value="appearance" selected="">Appearance</option>');
    expect(html).toContain('<option value="companion">Pair devices</option>');
    expect(html).not.toContain('<option value="general">');
    expect(html).not.toContain('<option value="connections">');
    expect(html).not.toContain('<option value="engines">');
    expect(html).not.toContain('<option value="backups">');
    expect(html).toContain("Midnight");
    expect(html).toContain('aria-label="Show threads"');
    expect(html).toContain('aria-label="Notification sounds"');
    expect(html).toContain('aria-label="Choose sidebar density"');
    expect(html).not.toContain('aria-label="Show tool calls in chat"');
  });

  it("offers full backups in local Settings", () => {
    fixture.section = "backups";
    const html = render();
    expect(html).toContain('<option value="backups" selected="">Backups</option>');
    expect(html).toContain("Export full backup");
    expect(html).toContain('type="file" accept=".sagaxbackup"');
    expect(html).toContain("Older team backups and shareable templates");
  });

  it("uses English fallback for new keys in untranslated languages", () => {
    setLocale("ja");
    const html = render();
    expect(html).toContain("Appearance");
    expect(html).toContain('aria-label="Show threads"');
    expect(html).toContain("all conversation history and running work");
    expect(html).not.toContain("settings.threadDisplay");
  });

  // The joined-servers list and the join card both wait on the /api/org
  // load, which this suite never flushes (no effects run under
  // renderToStaticMarkup); OrganizationSettings.test.ts covers that content
  // once loaded. This only pins the section itself and its nav visibility.
  it("offers Organisation settings locally and in a browser, folding the joined-servers list into it", () => {
    fixture.section = "organization";
    vi.stubGlobal("window", { ogb: { organization: {} } });
    const local = render();
    expect(local).toContain('<option value="organization" selected="">Organization</option>');
    expect(local).not.toContain('<option value="desktopWorkspaces"');
    // The enterprise Admin connection stays hidden until it is in use.
    expect(local).not.toContain("personal and local models");
    vi.stubGlobal("window", {});
    const browser = render();
    expect(browser).toContain('<option value="organization" selected="">Organization</option>');
  });

  it("keeps Organisation reachable to a remote client instead of hiding it", () => {
    fixture.section = "organization";
    vi.stubGlobal("window", { ogb: { organization: {}, remoteClient: { active: true } } });
    const html = render();
    expect(html).toContain('<option value="organization" selected="">Organization</option>');
    fixture.section = "appearance";
    expect(render()).toContain("Midnight");
  });
});
