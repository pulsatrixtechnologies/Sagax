// Which Settings page a section id opens today. Kept free of imports so the
// store's reducer can use it.
import type { AppSettingsSection } from "@/state/store";

/** Sections that are a card of another page now, and that card.
 * 2026-10-14: Integrations ("connections") and Models and accounts
 * ("engines") became one page, Models and voice ("engines").
 * 2026-10-14 (menu simplification, Settings lot): Connected apps and
 * Decision model are cards of Models and voice, Privacy joined
 * Notifications, Memory joined Organization and Email is a card of People.
 * An old link, deep link or saved section keeps working: it opens the page
 * that holds the card, and openSettings opens the card. */
const MERGED: Partial<Record<AppSettingsSection, { section: AppSettingsSection; cardId: string }>> = {
  connections: { section: "engines", cardId: "engines.keys" },
  connectedApps: { section: "engines", cardId: "connections.apps" },
  decisionModel: { section: "engines", cardId: "engines.decisionModel" },
  privacy: { section: "notifications", cardId: "notifications.privacy" },
  memory: { section: "organization", cardId: "organization.memory" },
};

/** Sections hidden from the app since 2026-10-14 (JC: managing several
 * people is Sagax Business's job; the app shows what concerns the person
 * signed in). Their server routes stay. An old link opens the nearest page:
 * General. 2026-10-15: People and Installations joined them, so Email (a
 * card of People) opens General too. */
const HIDDEN: Partial<Record<AppSettingsSection, AppSettingsSection>> = {
  companion: "general",
  activity: "general",
  mail: "general",
  people: "general",
  workspaces: "general",
};

export function currentSettingsSection(section: AppSettingsSection, cardId?: string): AppSettingsSection {
  // An old "connections" link to the Composio card opens Connected apps,
  // which is itself a card of Models and voice now.
  if (section === "connections" && cardId === "connections.apps") return "engines";
  return MERGED[section]?.section ?? HIDDEN[section] ?? section;
}

/** The card an old section id stands for, opened when a link names only the
 * section. Undefined for a section that is still a page. */
export function mergedSettingsCard(section: AppSettingsSection): string | undefined {
  return MERGED[section]?.cardId;
}
