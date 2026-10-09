// Which persona editor category a bot settings section lives in. The bot
// panel keeps only Details (with Routines), Library and Computer; every other
// section is reached through the persona editor, so a deep link to one opens
// the editor on the matching category (store: toggleSettings).
import type { BotSettingsSection } from "@/state/store";

/** The categories, in the order the persona editor lists them. */
export const PERSONA_CATEGORIES = [
  "overview",
  "soul",
  "skills",
  "memory",
  "access",
  "model",
  "permissions",
  "voice",
  "perspicax",
  "history",
  "usage",
] as const satisfies readonly BotSettingsSection[];
export type PersonaCategory = (typeof PERSONA_CATEGORIES)[number];

/** Sections that stay in the bot panel (the Details tab). */
const PANEL_SECTIONS: ReadonlySet<BotSettingsSection> = new Set(["details", "routines"]);

/** Sections shown inside another category's pane. */
const FOLDED_INTO: Partial<Record<BotSettingsSection, PersonaCategory>> = {
  worksOn: "access",
  slack: "access",
  visibility: "overview",
  sharing: "overview",
};

export function isPersonaCategory(id: BotSettingsSection): id is PersonaCategory {
  return (PERSONA_CATEGORIES as readonly string[]).includes(id);
}

/** The persona category that shows `section`, or null when the bot panel does. */
export function personaCategoryForSection(section: BotSettingsSection): PersonaCategory | null {
  if (PANEL_SECTIONS.has(section)) return null;
  if (isPersonaCategory(section)) return section;
  return FOLDED_INTO[section] ?? "overview";
}
