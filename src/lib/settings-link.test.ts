import { describe, expect, it } from "vitest";
import { currentSettingsSection, openModelKeysSettings, openSettings, settingsLinkParts, settingsSectionLabel } from "./settings-link";
import { setLocale } from "@/lib/i18n";

describe("settings links", () => {
  it("names a section with the label Settings shows", () => {
    setLocale("en");
    expect(settingsSectionLabel("engines")).toBe("Models and voice");
    expect(settingsSectionLabel("connectedApps")).toBe("Connected apps");
    expect(settingsSectionLabel("companion")).toBe("Pair devices");
    expect(settingsSectionLabel("experimental")).toBe("Experimental");
    setLocale("fr");
    expect(settingsSectionLabel("engines")).toBe("Modèles et voix");
    expect(settingsSectionLabel("connectedApps")).toBe("Apps connectées");
    setLocale("en");
  });

  // 2026-10-14: Integrations and Models and accounts are one page; an old
  // link to Integrations opens it, or Connected apps for the Composio card.
  it("redirects an old Integrations link to the page that holds it now", () => {
    expect(currentSettingsSection("connections")).toBe("engines");
    expect(currentSettingsSection("connections", "connections.voice")).toBe("engines");
    expect(currentSettingsSection("connections", "connections.apps")).toBe("connectedApps");
    expect(currentSettingsSection("memory")).toBe("memory");
    const sent: unknown[] = [];
    openSettings((action) => sent.push(action), "connections", "connections.apps");
    expect(sent).toEqual([{ type: "toggleAppSettings", open: true, section: "connectedApps" }]);
  });

  // New bot's "no model works" button opens the list of keys (PR #478).
  it("opens Models and voice at its keys for a model that needs one", () => {
    const sent: unknown[] = [];
    openModelKeysSettings((action) => sent.push(action));
    expect(sent).toEqual([{ type: "toggleAppSettings", open: true, section: "engines" }]);
  });

  it("splits a sentence on its settings placeholders", () => {
    expect(settingsLinkParts("Check the key in {settings}.")).toEqual([
      { kind: "text", text: "Check the key in " },
      { kind: "link", name: "settings" },
      { kind: "text", text: "." },
    ]);
    expect(settingsLinkParts("No pointer here.")).toEqual([{ kind: "text", text: "No pointer here." }]);
    expect(settingsLinkParts("the card in {apiKeys}. While off, {providers}.")).toEqual([
      { kind: "text", text: "the card in " },
      { kind: "link", name: "apiKeys" },
      { kind: "text", text: ". While off, " },
      { kind: "link", name: "providers" },
      { kind: "text", text: "." },
    ]);
  });
});
