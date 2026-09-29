import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { BOT_SECTIONS } from "./sections";
import { isAdvancedSection, PANEL_TABS, tabForSection } from "./panel-tabs";

describe("bot panel tabs", () => {
  it("run Details, Routines, Files, Computer, Advanced in that order", () => {
    expect(PANEL_TABS).toEqual(["details", "routines", "files", "computer", "advanced"]);
  });

  it("are labelled in English and French, with Media renamed to Files", () => {
    const labels = (catalog: Record<string, string>) => PANEL_TABS.map((id) => catalog[`botPanel.tab.${id}`]);
    expect(labels(en)).toEqual(["Details", "Routines", "Files", "Computer", "Advanced"]);
    expect(labels(fr)).toEqual(["Détails", "Routines", "Fichiers", "Ordinateur", "Avancé"]);
    expect(en).not.toHaveProperty("botPanel.tab.media");
    expect(fr).not.toHaveProperty("botPanel.tab.media");
  });

  it("land a deep link on the tab that holds the section", () => {
    expect(tabForSection("identity")).toBe("details");
    expect(tabForSection("routines")).toBe("routines");
    expect(tabForSection("memory")).toBe("advanced");
    expect(tabForSection("overview")).toBe("advanced");
  });

  it("keep Identity and Routines out of the Advanced list, and every other section in it", () => {
    const advanced = BOT_SECTIONS.filter((entry) => isAdvancedSection(entry.id)).map((entry) => entry.id);
    expect(advanced).not.toContain("identity");
    expect(advanced).not.toContain("routines");
    expect(advanced).toEqual(BOT_SECTIONS.map((entry) => entry.id).filter((id) => id !== "identity" && id !== "routines"));
  });
});
