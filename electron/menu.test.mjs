import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { name: "openmausbot" },
  Menu: { buildFromTemplate: (template) => template },
}));

import { buildApplicationMenu } from "./menu.mjs";

describe("buildApplicationMenu", () => {
  const originalPlatform = process.platform;

  function withPlatform(platform, fn) {
    Object.defineProperty(process, "platform", { value: platform, configurable: true });
    try {
      return fn();
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    }
  }

  const environments = [{ id: "x", name: "X", origin: "http://localhost" }];
  const build = (platform, overrides = {}) =>
    withPlatform(platform, () =>
      buildApplicationMenu({
        environments,
        activeId: "x",
        onSwitch: vi.fn(),
        onAddFromClipboard: vi.fn(),
        onForget: vi.fn(),
        ...overrides,
      }),
    );

  it("macOS app menu wires an explicit Preferences item to the settings callback", () => {
    const onOpenSettings = vi.fn();
    const template = build("darwin", { onOpenSettings });
    const item = template[0].submenu.find((entry) => entry.label === "Preferences…");
    expect(item).toBeDefined();
    expect(item.accelerator).toBe("CmdOrCtrl+,");
    expect(item.click).toBeTypeOf("function");
    item.click();
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it("labels the macOS app menu with the display name, not the runtime name", () => {
    const [appMenu] = build("darwin");
    expect(appMenu.label).toBe("Sagax");
    const labels = appMenu.submenu.map((entry) => entry.label).filter(Boolean);
    expect(labels).toEqual(expect.arrayContaining(["About Sagax", "Hide Sagax", "Quit Sagax"]));
    expect(JSON.stringify(appMenu)).not.toContain("openmausbot");
  });

  it.each(["linux", "win32"])("does not add an app menu on %s", (platform) => {
    const template = build(platform);
    expect(template[0].role).toBe("fileMenu");
    for (const item of template) {
      expect(item.label).not.toBe("Sagax");
    }
  });

  it.each(["darwin", "linux", "win32"])("does not offer hosted organisation sign-in on %s", platform => {
    const template = build(platform);
    const server = template.find(entry => entry.label === "Server").submenu;
    expect(server.some(entry => entry.id === "organization-sign-in")).toBe(false);
    expect(JSON.stringify(server)).not.toContain("Sign in with your organization");
    expect(server.some(entry => entry.label === "Connect to a server…")).toBe(true);
  });

  it("in server mode the Server menu shows the organization's server and Change server only", () => {
    const onLeaveServerMode = vi.fn();
    const onSwitch = vi.fn();
    const template = build("darwin", { serverModeId: "x", onLeaveServerMode, onSwitch });
    const items = template.find(entry => entry.label === "Server").submenu;
    const labels = items.map(entry => entry.label).filter(Boolean);
    expect(labels).toEqual(["X — localhost", "Change server…"]);
    expect(JSON.stringify(items)).not.toContain("Local (this computer)");
    items.find(entry => entry.label === "Change server…").click();
    expect(onLeaveServerMode).toHaveBeenCalledOnce();
    expect(onSwitch).not.toHaveBeenCalled();
  });

  it.each(["darwin", "linux", "win32"])("Help menu opens release notes on %s", (platform) => {
    const onOpenReleaseNotes = vi.fn();
    const template = build(platform, { onOpenReleaseNotes });
    const help = template.find((entry) => entry.label === "Help");
    const item = help.submenu.find((entry) => entry.label === "Release notes");
    expect(item).toBeDefined();
    item.click();
    expect(onOpenReleaseNotes).toHaveBeenCalledOnce();
  });
});
