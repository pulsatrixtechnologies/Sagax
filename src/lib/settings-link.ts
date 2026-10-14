// A sentence that used to say "Settings > Connections" names the section the
// screen actually shows, and a button opens it. The label is the same one
// the Settings navigation uses, so a renamed section updates every pointer.
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { requestSettingsCard } from "@/components/SettingsPrimitives";
import type { AppSettingsSection } from "@/state/store";
import { currentSettingsSection } from "@/lib/settings-sections";

export { currentSettingsSection };

const SECTION_LABEL = {
  general: "settings.section.general",
  organization: "settings.section.organization",
  appearance: "settings.section.appearance",
  experimental: "settings.section.experimental",
  // Integrations was merged into Models and voice (2026-10-14).
  connections: "settings.section.modelsVoice",
  connectedApps: "settings.section.connectedApps",
  decisionModel: "settings.section.decisionModel",
  engines: "settings.section.modelsVoice",
  companion: "settings.section.companion",
  computer: "settings.section.computer",
  usage: "settings.section.usage",
  people: "settings.section.people",
  mail: "settings.section.mail",
  activity: "settings.section.activity",
  backups: "settings.section.backups",
  workspaces: "settings.section.workspaces",
  privacy: "settings.section.privacy",
  notifications: "settings.section.notifications",
  memory: "settings.section.memory",
} as const satisfies Record<AppSettingsSection, LocaleKey>;

export type SettingsLinkTarget = { section: AppSettingsSection; cardId?: string };

export function settingsSectionLabel(section: AppSettingsSection): string {
  return t(SECTION_LABEL[section]);
}

type SettingsDispatch = (action: { type: "toggleAppSettings"; open: true; section: AppSettingsSection }) => void;

/** Opens Settings on a section, and a card when the sentence points at one. */
export function openSettings(dispatch: SettingsDispatch, section: AppSettingsSection, cardId?: string): void {
  dispatch({ type: "toggleAppSettings", open: true, section: currentSettingsSection(section, cardId) });
  if (cardId) requestSettingsCard(cardId);
}

/** Settings > Models and voice, at the list of keys: where a model that
 * cannot run gets its key (New bot's "no model works" line, 2026-10-14). */
export function openModelKeysSettings(dispatch: SettingsDispatch): void {
  openSettings(dispatch, "engines", "engines.keys");
}

export type SettingsLinkPart = { kind: "text"; text: string } | { kind: "link"; name: string };

/** `{name}` in a translated sentence is a settings link. Other text stays text. */
export function settingsLinkParts(text: string): SettingsLinkPart[] {
  const parts: SettingsLinkPart[] = [];
  const pattern = /\{(\w+)\}/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ kind: "text", text: text.slice(last, index) });
    parts.push({ kind: "link", name: match[1] ?? "" });
    last = index + match[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  if (parts.length === 0) parts.push({ kind: "text", text });
  return parts;
}
