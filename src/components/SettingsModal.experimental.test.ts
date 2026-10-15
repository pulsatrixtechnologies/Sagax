// Settings > Experimental: the Data window, off by default. Routines in the
// conversation and Group turns are in General > Advanced (2026-10-14): one
// way to reach them, no second Experimental switch hiding them again. Their
// saved values keep applying whether or not the page is open.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsSection } from "@/state/store";
import type { Switch } from "./SettingsPrimitives";

const fixture = vi.hoisted(() => ({
  section: "general" as AppSettingsSection,
  subPage: null as string | null,
  features: {} as Record<string, boolean>,
  api: vi.fn(),
  dispatch: vi.fn(),
  switches: [] as Array<{ "aria-label"?: string; checked?: boolean; onClick?: (event: never) => void }>,
}));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: fixture.api,
  useStore: () => ({
    state: {
      appSettingsSection: fixture.section,
      appSettingsSubPage: fixture.subPage,
      instances: [],
      bots: [],
      groups: [],
      config: { features: { skillAuthoring: true, ...fixture.features }, rooms: { turnTimeoutMinutes: 12 } },
    },
    dispatch: fixture.dispatch,
  }),
}));
vi.mock("./SettingsPrimitives", async (importOriginal) => {
  const original = await importOriginal<typeof import("./SettingsPrimitives")>();
  return {
    ...original,
    Switch: (props: ComponentProps<typeof Switch>) => {
      fixture.switches.push(props as (typeof fixture.switches)[number]);
      return createElement(original.Switch, props);
    },
  };
});
vi.mock("./DesktopCapabilities", () => ({ useDesktopCapabilities: () => ({ capabilities: { host: { platform: "darwin" } } }) }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/analytics", () => ({ analyticsEnabled: () => false, setAnalyticsEnabled: () => {} }));

beforeEach(async () => {
  fixture.section = "general";
  fixture.subPage = null;
  fixture.features = {};
  fixture.switches = [];
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === "openmausbot.settingsCards.v1" ? JSON.stringify({ "experimental.features": true }) : null),
    setItem: () => {},
    removeItem: () => {},
  });
  const { resetSettingsCards } = await import("./SettingsPrimitives");
  resetSettingsCards();
});

const render = async () => {
  const { SettingsModal } = await import("./SettingsModal");
  return renderToStaticMarkup(createElement(SettingsModal));
};
const switchNamed = (label: string) => fixture.switches.filter((props) => props["aria-label"] === label).at(-1);

describe("Settings > Experimental", () => {
  it("offers the Data window, off by default, and no longer a switch for routine and group settings", async () => {
    fixture.section = "experimental";
    const html = await render();
    expect(html).toContain('data-experimental-feature="dataWindow"');
    expect(html).toContain("Data window");
    expect(html).not.toContain('data-experimental-feature="routineGroupSettings"');
    expect(html).not.toContain("Advanced routine and group settings");
    expect(switchNamed("Turn on the Data window")?.checked).toBe(false);
    expect(html).not.toMatch(/[–—]/);
  });

  it("saves each switch as its own server feature", async () => {
    fixture.section = "experimental";
    fixture.api.mockResolvedValue({ features: {} });
    await render();
    switchNamed("Turn on the Data window")!.onClick!({} as never);
    expect(fixture.api).toHaveBeenLastCalledWith("/api/config", { method: "PATCH", body: JSON.stringify({ features: { dataWindow: true } }) });
    await vi.waitFor(() => expect(fixture.dispatch).toHaveBeenCalled());
  });
});

describe("Settings > General > Advanced", () => {
  it("keeps the technical cards off General itself: one row opens them", async () => {
    fixture.features = { routinesInConversation: true };
    const html = await render();
    expect(html).toContain('data-settings-card="general.advanced"');
    expect(html).not.toContain("Routines in the conversation");
    expect(html).not.toContain('data-settings-card="general.roomTurns"');
    expect(html).not.toContain('data-settings-card="general.mcpCalls"');
    expect(html).not.toContain('data-settings-card="general.toolAccess"');
    expect(switchNamed("Run routines in the conversation")).toBeUndefined();
    // nothing is saved or reset by not showing them
    expect(fixture.api).not.toHaveBeenCalled();
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("shows routines and group turns on the sub-page with their current values, no experimental switch needed", async () => {
    fixture.features = { routinesInConversation: true };
    fixture.subPage = "general.advanced";
    const html = await render();
    expect(html).toContain('data-settings-subpage="general.advanced"');
    expect(html).toContain("Routines in the conversation");
    expect(switchNamed("Run routines in the conversation")?.checked).toBe(true);
    expect(html).toContain('data-settings-card="general.roomTurns"');
    expect(html).toContain("Group turns");
    expect(html).toContain(">12 min per turn<");
    expect(html.indexOf("Routines in the conversation")).toBeLessThan(html.indexOf("Group turns"));
    for (const card of ["general.mcpCalls", "general.toolAccess"]) expect(html, card).toContain(`data-settings-card="${card}"`);
    expect(fixture.api).not.toHaveBeenCalled();
  });

  it("shows the advanced cards in place while a search names one of them", async () => {
    const { cardsMatching } = await import("./SettingsModal");
    expect(cardsMatching("mcp")).toContain("general.mcpCalls");
  });
});
