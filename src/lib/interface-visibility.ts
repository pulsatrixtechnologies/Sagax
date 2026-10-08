// What Simple mode hides. Advanced shows the screen as it is. The composer is
// the same in both modes and is not listed here. Hiding never changes a
// stored value, and nothing in these lists is required to chat: engine
// sign-in stays on the model picker and the empty-engines screen.
import type { AppSettingsSection, BotSettingsSection } from "@/state/store";

const HIDDEN_SETTINGS: ReadonlySet<AppSettingsSection> = new Set([
  "experimental",
  "connections",
  "myConnections",
  "decisionModel",
  "engines",
  "computer",
  "usage",
  "mail",
  "activity",
  "backups",
  "workspaces",
  "people",
]);

const HIDDEN_BOT: ReadonlySet<BotSettingsSection> = new Set([
  "access",
  "worksOn",
  "perspicax",
  "usage",
  "history",
  "skills",
]);

export function simpleHidesSettingsSection(id: AppSettingsSection): boolean {
  return HIDDEN_SETTINGS.has(id);
}

export function simpleHidesBotSection(id: BotSettingsSection): boolean {
  return HIDDEN_BOT.has(id);
}

export function simpleHidesPanelTab(id: string): boolean {
  return id === "computer";
}
