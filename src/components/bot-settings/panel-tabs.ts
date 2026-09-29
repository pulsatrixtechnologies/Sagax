// The bot panel's tabs and which one a settings section lives on. Details
// holds who the bot is, Routines what it runs on a schedule, Files what this
// chat produced; Advanced keeps every other section behind one searchable
// list, so a deep link to a section lands on the tab that holds it.
import type { BotSettingsSection } from "@/state/store";

export const PANEL_TABS = ["details", "routines", "files", "computer", "advanced"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

const SECTION_TABS: Partial<Record<BotSettingsSection, Exclude<PanelTab, "computer" | "advanced">>> = {
  identity: "details",
  routines: "routines",
};

export function tabForSection(section: BotSettingsSection): Exclude<PanelTab, "computer"> {
  return SECTION_TABS[section] ?? "advanced";
}

/** Sections the Advanced list shows: everything no other tab owns. */
export function isAdvancedSection(section: BotSettingsSection): boolean {
  return tabForSection(section) === "advanced";
}
