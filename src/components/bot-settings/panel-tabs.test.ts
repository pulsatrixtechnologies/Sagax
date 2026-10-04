import { describe, expect, it } from "vitest";

import en from "@/locales/en.json";
import fr from "@/locales/fr.json";
import { BOT_SECTIONS } from "./sections";
import { isMoreSection, PANEL_TABS, tabForSection } from "./panel-tabs";

describe("bot panel tabs", () => {
  it("run Details, Library, Computer, More in that order", () => {
    expect(PANEL_TABS).toEqual(["details", "library", "computer", "more"]);
  });

  it("are labelled in English and French, with no Routines tab", () => {
    const labels = (catalog: Record<string, string>) => PANEL_TABS.map((id) => catalog[`botPanel.tab.${id}`]);
    expect(labels(en)).toEqual(["Details", "Library", "Computer", "More"]);
    expect(labels(fr)).toEqual(["Détails", "Bibliothèque", "Ordinateur", "Plus"]);
    expect(en).not.toHaveProperty("botPanel.tab.routines");
    expect(fr).not.toHaveProperty("botPanel.tab.routines");
  });

  it("land a deep link on the tab that holds the section", () => {
    // Name, label and description are edited at the panel's top.
    expect(tabForSection("details")).toBe("details");
    // Routines are a section of Details.
    expect(tabForSection("routines")).toBe("details");
    expect(tabForSection("memory")).toBe("more");
    expect(tabForSection("overview")).toBe("more");
  });

  it("keeps Routines out of the More list, and every other section in it", () => {
    const more = BOT_SECTIONS.filter((entry) => isMoreSection(entry.id)).map((entry) => entry.id);
    expect(more).toEqual(BOT_SECTIONS.map((entry) => entry.id).filter((id) => id !== "routines"));
    expect(BOT_SECTIONS.some((entry) => entry.id === "details")).toBe(false);
  });
});
