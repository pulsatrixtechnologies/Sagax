// Which persona editor category a bot settings section lives in. The bot
// panel keeps only Details (with Routines), Library and Computer; every other
// section is reached through the persona editor, so a deep link to one opens
// the editor on the matching category (store: toggleSettings).
//
// The editor lists six groups (JC 2026-10-14): each group shows its sections
// one under the other, and a deep link to a section opens its group and
// scrolls to it.
import type { BotSettingsSection } from "@/state/store";

/** The sections the editor shows, in the order they appear. */
export const PERSONA_CATEGORIES = [
  "overview",
  "appearance",
  "soul",
  "rules",
  "skills",
  "memory",
  "files",
  "model",
  "access",
  "perspicax",
  "permissions",
  "voice",
  "history",
  "usage",
] as const satisfies readonly BotSettingsSection[];
export type PersonaCategory = (typeof PERSONA_CATEGORIES)[number];

/** The six groups of the editor's left column, each with its sections. */
export const PERSONA_GROUPS = [
  { id: "profile", sections: ["overview", "appearance"] },
  { id: "instructions", sections: ["soul", "rules", "skills"] },
  { id: "memoryFiles", sections: ["memory", "files"] },
  { id: "modelTools", sections: ["model", "access", "perspicax"] },
  { id: "behavior", sections: ["permissions", "voice"] },
  { id: "activity", sections: ["history", "usage"] },
] as const satisfies ReadonlyArray<{ id: string; sections: readonly PersonaCategory[] }>;
export type PersonaGroup = (typeof PERSONA_GROUPS)[number]["id"];

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

/** The group whose page shows `section` (a folded section follows its host). */
export function personaGroupOf(section: BotSettingsSection): PersonaGroup {
  const category = personaCategoryForSection(section) ?? "overview";
  return PERSONA_GROUPS.find((group) => (group.sections as readonly PersonaCategory[]).includes(category))?.id ?? "profile";
}

/** The sections of a group, in order. */
export function personaGroupSections(group: PersonaGroup): readonly PersonaCategory[] {
  return PERSONA_GROUPS.find((entry) => entry.id === group)?.sections ?? [];
}
