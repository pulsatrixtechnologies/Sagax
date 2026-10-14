// Which Settings page a section id opens today. Kept free of imports so the
// store's reducer can use it.
import type { AppSettingsSection } from "@/state/store";

/** 2026-10-14: Integrations ("connections") and Models and accounts
 * ("engines") became one page, Models and voice ("engines"), and Connected
 * apps got its own page. An old link keeps working: "connections" opens
 * Models and voice, or Connected apps when it pointed at the Composio card. */
export function currentSettingsSection(section: AppSettingsSection, cardId?: string): AppSettingsSection {
  if (section !== "connections") return section;
  return cardId === "connections.apps" ? "connectedApps" : "engines";
}
