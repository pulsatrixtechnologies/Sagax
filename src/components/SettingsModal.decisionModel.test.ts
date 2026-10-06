// Decision model is an experimental Settings section. Off, it is absent from
// navigation. On, it is its own item, findable by what people would type.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AppSettingsSection } from "@/state/store";
import { resetSettingsCards } from "./SettingsPrimitives";

const fixture = vi.hoisted(() => ({
  section: "appearance" as AppSettingsSection,
  decisionModel: false,
}));

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(),
  useStore: () => ({
    state: {
      appSettingsSection: fixture.section,
      instances: [],
      bots: [],
      groups: [],
      config: { features: { skillAuthoring: true, decisionModel: fixture.decisionModel }, rooms: { turnTimeoutMinutes: 5 } },
    },
    dispatch: vi.fn(),
  }),
}));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: () => {} }));
vi.mock("@/lib/analytics", () => ({
  analyticsEnabled: () => false,
  setAnalyticsEnabled: () => {},
}));

beforeEach(() => {
  fixture.section = "appearance";
  fixture.decisionModel = false;
  vi.stubGlobal("window", {});
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === "openmausbot.settingsCards.v1" ? JSON.stringify({ "experimental.features": false }) : null),
    setItem: () => {},
    removeItem: () => {},
  });
  resetSettingsCards();
});

const render = async () => {
  const { SettingsModal } = await import("./SettingsModal");
  return renderToStaticMarkup(createElement(SettingsModal));
};

describe("Settings → Decision model", () => {
  it("stays out of navigation until the experimental switch is on", async () => {
    const off = await render();
    expect(off).not.toContain('<option value="decisionModel">');
    expect(off).not.toContain("A fast decision model that picks");

    fixture.decisionModel = true;
    const on = await render();
    expect(on).toContain('<option value="decisionModel">Decision model</option>');
    expect(on).not.toContain("A fast decision model that picks");

    fixture.section = "decisionModel";
    const panel = await render();
    expect(panel).toContain('<option value="decisionModel"');
    expect(panel).toContain("A fast decision model that picks");
  });

  it("hides the VPS and Boat switches and counts the five that remain", async () => {
    fixture.section = "experimental";
    const off = await render();
    expect(off).toContain("1 of 5 on");
    expect(off).toContain('data-experimental-feature="decisionModel"');
    expect(off).toContain("Decision model");
    expect(off).not.toContain("VPS Computer");
    expect(off).not.toContain("Boat Computer");
    expect(off).toContain('aria-checked="false"');

    fixture.decisionModel = true;
    expect(await render()).toContain("2 of 5 on");
  });

  it("matches searches for decision, jev, typesafe, routing and auto", async () => {
    const { SECTIONS, sectionMatches } = await import("./SettingsModal");
    const section = SECTIONS.find((entry) => entry.id === "decisionModel")!;
    for (const query of ["decision", "jev", "typesafe", "routing", "auto"]) expect(sectionMatches(section, query)).toBe(true);
    expect(sectionMatches(section, "backups")).toBe(false);
  });
});
