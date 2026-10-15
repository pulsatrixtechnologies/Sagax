// Which persona editor page shows a bot settings section. The bot panel
// keeps only Details (with Routines), Library and Computer; every other
// section is reached through the persona editor, so a deep link to one opens
// the editor on that section's own page (store: toggleSettings).
//
// The editor's left column lists groups (JC 2026-10-14); each section of a
// group is its own page (JC 2026-10-15: one long page with Appearance at the
// bottom was confusing). A group's first page is its home: Profile opens on
// the bot's identity, and its other pages (Appearance, Shared with, What it
// does) are listed under it. Permissions (with the Perspicax
// profiles under it), Voice, Usage and Changes are entries of their own
// (JC 2026-10-15).
import type { BotSettingsSection } from "@/state/store";

/** Every page the editor can show, in the order they appear. */
export const PERSONA_CATEGORIES = [
  "overview",
  "appearance",
  "sharing",
  "visibility",
  "summary",
  "soul",
  "rules",
  "skills",
  "memory",
  "files",
  "model",
  "worksOn",
  "access",
  "slack",
  "permissions",
  "perspicax",
  "voice",
  "usage",
  "history",
] as const satisfies readonly BotSettingsSection[];
export type PersonaCategory = (typeof PERSONA_CATEGORIES)[number];

/** The groups of the editor's left column, each with its pages (the first is
 * the group's home). */
export const PERSONA_GROUPS = [
  { id: "profile", sections: ["overview", "appearance", "sharing", "visibility", "summary"] },
  { id: "instructions", sections: ["soul", "rules", "skills"] },
  { id: "memoryFiles", sections: ["memory", "files"] },
  { id: "modelTools", sections: ["model", "worksOn", "access", "slack"] },
  { id: "permissions", sections: ["permissions", "perspicax"] },
  { id: "voice", sections: ["voice"] },
  { id: "usage", sections: ["usage"] },
  { id: "changes", sections: ["history"] },
] as const satisfies ReadonlyArray<{ id: string; sections: readonly PersonaCategory[] }>;
export type PersonaGroup = (typeof PERSONA_GROUPS)[number]["id"];

/** Sections that stay in the bot panel (the Details tab). */
const PANEL_SECTIONS: ReadonlySet<BotSettingsSection> = new Set(["details", "routines"]);

export function isPersonaCategory(id: BotSettingsSection): id is PersonaCategory {
  return (PERSONA_CATEGORIES as readonly string[]).includes(id);
}

/** The persona page that shows `section`, or null when the bot panel does. */
export function personaCategoryForSection(section: BotSettingsSection): PersonaCategory | null {
  if (PANEL_SECTIONS.has(section)) return null;
  return isPersonaCategory(section) ? section : "overview";
}

/** The group whose pages include `section`. */
export function personaGroupOf(section: BotSettingsSection): PersonaGroup {
  const category = personaCategoryForSection(section) ?? "overview";
  return PERSONA_GROUPS.find((group) => (group.sections as readonly PersonaCategory[]).includes(category))?.id ?? "profile";
}

/** The pages of a group, in order. */
export function personaGroupSections(group: PersonaGroup): readonly PersonaCategory[] {
  return PERSONA_GROUPS.find((entry) => entry.id === group)?.sections ?? [];
}
