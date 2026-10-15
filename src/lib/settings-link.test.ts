import { describe, expect, it } from "vitest";
import { currentSettingsSection, mergedSettingsCard, openModelKeysSettings, openSettings, settingsLinkParts, settingsSectionLabel } from "./settings-link";
import { setLocale } from "@/lib/i18n";

describe("settings links", () => {
  it("names a section with the label Settings shows", () => {
    setLocale("en");
    expect(settingsSectionLabel("engines")).toBe("Models and voice");
    // a former page names the page that holds its card now
    expect(settingsSectionLabel("connectedApps")).toBe("Models and voice");
    // Pair devices and Activity are hidden (2026-10-14), People, Installations
    // and Email (a card of People) too (2026-10-15): their old links open General
    expect(settingsSectionLabel("mail")).toBe("General");
    expect(settingsSectionLabel("people")).toBe("General");
    expect(settingsSectionLabel("workspaces")).toBe("General");
    expect(settingsSectionLabel("companion")).toBe("General");
    expect(settingsSectionLabel("activity")).toBe("General");
    expect(settingsSectionLabel("experimental")).toBe("Experimental");
    setLocale("fr");
    expect(settingsSectionLabel("engines")).toBe("Modèles et voix");
    expect(settingsSectionLabel("privacy")).toBe("Notifications");
    expect(settingsSectionLabel("memory")).toBe("Organisation");
    setLocale("en");
  });

  // 2026-10-14: Integrations and Models and accounts are one page; an old
  // link to Integrations opens it. Then (menu simplification, Settings lot)
  // Connected apps, Decision model, Privacy, Memory and Email became cards:
  // an old section id opens the page that holds the card, and the card.
  it("redirects an old section link to the page and card that hold it now", () => {
    expect(currentSettingsSection("connections")).toBe("engines");
    expect(currentSettingsSection("connections", "connections.voice")).toBe("engines");
    expect(currentSettingsSection("connections", "connections.apps")).toBe("engines");
    expect(currentSettingsSection("connectedApps")).toBe("engines");
    expect(currentSettingsSection("decisionModel")).toBe("engines");
    expect(currentSettingsSection("privacy")).toBe("notifications");
    expect(currentSettingsSection("memory")).toBe("organization");
    expect(currentSettingsSection("mail")).toBe("general");
    expect(currentSettingsSection("people")).toBe("general");
    expect(currentSettingsSection("workspaces")).toBe("general");
    expect(currentSettingsSection("companion")).toBe("general");
    expect(currentSettingsSection("activity")).toBe("general");
    expect(currentSettingsSection("usage")).toBe("usage");
    expect(mergedSettingsCard("connectedApps")).toBe("connections.apps");
    expect(mergedSettingsCard("decisionModel")).toBe("engines.decisionModel");
    expect(mergedSettingsCard("privacy")).toBe("notifications.privacy");
    expect(mergedSettingsCard("memory")).toBe("organization.memory");
    expect(mergedSettingsCard("mail")).toBeUndefined();
    expect(mergedSettingsCard("general")).toBeUndefined();
    const sent: unknown[] = [];
    openSettings((action) => sent.push(action), "connections", "connections.apps");
    openSettings((action) => sent.push(action), "decisionModel");
    expect(sent).toEqual([
      { type: "toggleAppSettings", open: true, section: "engines" },
      { type: "toggleAppSettings", open: true, section: "engines" },
    ]);
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
