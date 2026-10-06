// The bot panel's tabs and which one a settings section lives on. Details
// holds what the bot is doing (its coding activity), its routines and who it
// is (name and label are edited in place at the panel's top; the
// description stays on the bot and is edited in IdentitySection);
// Library holds its files; Computer is the computer view; More keeps every
// other section behind one searchable list, so a deep link to a section
// lands on the tab that holds it.
import type { BotSettingsSection } from "@/state/store";

export const PANEL_TABS = ["details", "library", "computer", "more"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

const SECTION_TABS: Partial<Record<BotSettingsSection, Exclude<PanelTab, "computer" | "more">>> = {
  details: "details",
  routines: "details",
};

export function tabForSection(section: BotSettingsSection): Exclude<PanelTab, "computer"> {
  return SECTION_TABS[section] ?? "more";
}

/** Sections the More list shows: everything no other tab owns. */
export function isMoreSection(section: BotSettingsSection): boolean {
  return tabForSection(section) === "more";
}
