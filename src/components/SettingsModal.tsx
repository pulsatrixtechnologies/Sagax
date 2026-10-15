// App settings, as a real modal with sections rather than one long panel.
// Per-bot settings (persona, model, computer) live in BotSettingsDialog: this
// is the stuff shared by every bot: who you are, your keys, and the
// machine your bots can borrow.
import { useRetroSkin } from "./RetroChromeHost";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FLOATING_LIVELINESS, floatingBotPrefs, HOTKEY_CHOICES, hotkeyLabel, setFloatingBarkSound, setFloatingFlyAway, setFloatingHotkey, setFloatingLiveliness, subscribeFloatingBots, type FloatingLiveliness, type HotkeyChoice } from "@/lib/floating-bots";
import { useCallSettings, writeCallSettings } from "@/lib/voice-mode/call-settings";
import { Archive, Bell, Coins, FlaskConical, Monitor, Palette, Search, Terminal, User, X, Building2 } from "lucide-react";
import { api, useStore, type AppSettingsSection, type ConfigStatus } from "@/state/store";
import { browserAvailable, builtInBrowserEnabled, connectedAppsEnabled, dataWindowEnabled, decisionModelEnabled, routinesInConversationEnabled, showToolCallsEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { localeChoices, type LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { withTourReset } from "@/lib/guided-tour";
import { completionPatch } from "@/lib/onboarding";
import { launchBridges } from "@/lib/launch";
import { servedPage } from "@/lib/desktop";
import { brand } from "@/lib/brand";
import { useServerMode } from "./ServerModeSettings";
import { ApiKeyRow } from "./ApiKeys";
import { DecisionModelSettings } from "./DecisionModelSettings";
import { useUpdaterState } from "@/lib/updater";
import { EnginesSettings } from "./EnginesSettings";
import { LocalComputerSection } from "./LocalComputerSection";
import { peopleListServed, readMembership } from "../lib/membership";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { canEditConfig, canManageBackups, canManageComputers, viewerCan } from "@/lib/viewer";
import { BrowserProfilesManager } from "./BrowserProfilesManager";
import { OrganizationSettings } from "./OrganizationSettings";
import { Card, SettingRow, Switch, requestSettingsCard, cardCount, takeRequestedSettingsCard } from "./SettingsPrimitives";
import { PrivacySettings } from "./PrivacySettings";
import { OrgMemorySettings } from "./OrgMemorySettings";
import { NotificationSettings } from "./NotificationSettings";
import { BrowserUnavailableNote, SettingsText } from "./SettingsLink";
import { currentSettingsSection, isMovedOrganizationCard } from "@/lib/settings-sections";

import { shortcutLabel } from "./ShortcutHint";
import { UsageSection } from "./UsageSection";
import { LicenseExpiryBanner } from "./LicenseExpiryBanner";
import { workspacesAvailable } from "./WorkspacesSection";
import { SkinPicker } from "./SkinPicker";
import { SidebarHiddenSettings } from "./SidebarHiddenSettings";
import { SKINS, readSkin } from "@/lib/skins";
import { FONT_IDS, applyFont, readFont, type FontId } from "@/lib/fonts";
import { RoomTurnTimeoutSettings } from "./RoomTurnTimeoutSettings";
import { AboutMeEditor, aboutMeFirstLine } from "./AboutMeSettings";
import { McpCallTimeoutSettings } from "./McpCallTimeoutSettings";
import { PeopleToolAccessSettings } from "./ToolAccessSettings";
import { mcpCallTimeoutMinutes } from "@/lib/mcp-call-timeout";
import { SettingsSubPage, SettingsSubPageRow } from "./SettingsSubPage";
import { AccountCard } from "./settings/AccountCard";
import { ThreadCleanupSettings } from "./ThreadCleanupSettings";
import { DefaultBotSettings } from "./NewBotDialog";
import { AppIconPicker, appIconAvailable } from "./settings/AppIconPicker";
import { WorkspaceBackupSettings } from "./WorkspaceBackupSettings";
import { cn } from "@/lib/cn";
import { setAdvancedMode, useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesSettingsSection } from "@/lib/interface-visibility";
import { setShowThreads, setThreadsLocation, useShowThreadsChoice, useThreadsLocationChoice, type ThreadsLocation } from "@/lib/thread-preferences";
import { setShowUnreadyProviders, useShowUnreadyProviders } from "@/lib/unready-providers-preference";
import { parseSidebarDensity, setSidebarDensity, SIDEBAR_DENSITIES, useSidebarDensity, type SidebarDensity } from "@/lib/sidebar-preferences";
import { setShowRunCard, useShowRunCard } from "@/lib/run-card-preferences";
import { parseSendKey, SEND_KEYS, sendKeyLabel, setSendKey, useSendKey } from "@/lib/send-key";
import { setShowSidebarLogo, useShowSidebarLogo } from "@/lib/sidebar-logo-preferences";
import { setShowRoutinesBadge, useShowRoutinesBadge } from "@/lib/routines-badge-preferences";
import { setSidebarShortcuts, useSidebarShortcuts } from "@/lib/sidebar-shortcuts-preferences";
import { setShowInspectorButton, useShowInspectorButton } from "@/lib/inspector-preferences";
import { effectiveLanguage, setLanguageChoice, useLanguageChoice } from "@/lib/language-preference";

const COMPOSIO_PLATFORM_URL = "https://platform.composio.dev";

// `labelKey`, not a label: t() reads the active pack when it is called, so a
// label resolved here at module scope would freeze the language the app booted
// in. The English keywords stay untranslated: they are a search index, and a
// pack that omits them still matches what people type.
/** Search words of the cards moved from General > Advanced to Organization
 * (2026-10-15). On a desktop with no server they stay in General > Advanced,
 * and General matches them there (sectionMatches `extra`). */
export const ORGANIZATION_ADVANCED_KEYWORDS = ["routines", "conversation", "schedule", "mcp", "timeout", "group turns", "rooms"];

export const SECTIONS: Array<{
  id: AppSettingsSection;
  labelKey: LocaleKey;
  icon: typeof User;
  keywords: string[];
}> = [
  { id: "general", labelKey: "settings.section.general", icon: User, keywords: ["profile", "name", "email", "about me", "about", "suggestions", "suggested", "memory", "updates", "effort", "new bots", "reasoning", "threads", "parallel", "concurrency", "cleanup", "retention", "event log", "event-log", "log size", "automatic recovery", "backup model", "fallback", "advanced", "avancé", "tool access", "accès aux outils", "prerelease", "pre-release", "diagnostics", "diagnostic"] },
  // 2026-10-14: Memory is a card of this page (it was its own section).
  { id: "organization", labelKey: "settings.section.organization", icon: Building2, keywords: ["company", "organization", "organisation", "sign in", "enroll", "managed", "models", "disconnect", "workspace", "cloud", "hosted", "vps", "server", "servers", "connect", "pair", "switch", "local", "memory", "obsidian", "vault", "sync", "git", "perspicax", "mémoire", "cache", "pending", "domain", "dns", "caddy", ...ORGANIZATION_ADVANCED_KEYWORDS] },
  { id: "appearance", labelKey: "settings.section.appearance", icon: Palette, keywords: ["skin", "theme", "appearance", "advanced", "simple", "mode", "tools", "tool calls", "threads", "show threads", "hide threads", "sidebar", "hidden", "hide", "show", "density", "compact", "comfortable", "avatars", "display", "run", "this run", "run card", "commands", "mascot", "owl", "desktop", "fly", "floating", "app icon", "dock", "icon", "taskbar", "providers", "sign-in", "unconfigured", "fournisseurs", "connexion", "non configurés", "send", "enter", "return", "shift+enter", "ctrl+enter", "cmd+enter", "⌘+enter", "new line", "keyboard", "ime", "japanese"] },
  // 2026-10-14: Privacy is a card of this page on an organization server.
  { id: "notifications", labelKey: "settings.section.notifications", icon: Bell, keywords: ["notifications", "notification", "sound", "sounds", "mute", "silent", "chime", "alert", "alerts", "banner", "badge", "dock", "unread", "nudge", "wizz", "shake", "secousse", "son", "persistent", "stay", "privacy", "read receipts", "seen", "vu", "confidentialité", "accusés de lecture", "presence", "online", "away", "offline", "last seen", "status", "en ligne", "absent", "hors ligne", "privacidade"] },
  { id: "experimental", labelKey: "settings.section.experimental", icon: FlaskConical, keywords: ["early", "preview", "learn", "skill", "authoring", "browser", "profiles"] },
  // Models and voice (2026-10-14): Integrations and Models and accounts in
  // one page; Connected apps and Decision model are cards of it.
  { id: "engines", labelKey: "settings.section.modelsVoice", icon: Terminal, keywords: ["models", "model providers", "engines", "claude", "codex", "grok", "providers", "cli", "sign in", "subscription", "keys", "api", "api key", "api keys", "connections", "integrations", "intégrations", "clés", "xai", "mistral", "cerebras", "router", "openrouter", "base url", "openai", "anthropic", "groq", "opencode", "provider", "voice", "voix", "tts", "elevenlabs", "fish", "chatterbox", "live call", "image", "avatar", "box", "vps", "cursor", "cloud agents", "composio", "connected apps", "apps", "gmail", "slack", "notion", "apps connectées", "decision", "jev", "typesafe", "routing", "auto", "who answers"] },
  { id: "computer", labelKey: "settings.section.computer", icon: Monitor, keywords: ["computer", "local vm", "vm", "virtual", "desktop", "ordinateur"] },
  { id: "usage", labelKey: "settings.section.usage", icon: Coins, keywords: ["tokens", "cost", "billing", "plan", "forfait", "coût"] },
  // 2026-10-15: People and Installations are hidden in the app, like Email,
  // Activity and Pair devices (settings-sections.ts HIDDEN).
  { id: "backups", labelKey: "settings.section.backups", icon: Archive, keywords: ["export", "import", "restore", "full backup", "password", "recovery"] },
];

/** Former sections that are a card of another page now (2026-10-14), by the
 * page that holds them. Each keeps its own visibility rules: the card shows
 * where the section would have, and its page shows when the card does. */
const HOSTED_CARDS: Partial<Record<AppSettingsSection, AppSettingsSection[]>> = {
  engines: ["connectedApps", "decisionModel"],
  notifications: ["privacy"],
  organization: ["memory"],
};

/** Collapsible cards a search opens: a match on these words means the person
 * is looking for what the card holds, so it should not stay folded. */
const CARD_KEYWORDS: Record<string, string[]> = {
  "general.aboutMe": ["about me"],
  "general.threadCleanup": ["cleanup", "retention", "event log", "event-log", "log size"],
  "organization.mcpCalls": ["mcp", "timeout", "tool call"],
  "connections.integrations": ["box", "vps"],
  "connections.image": ["image", "avatar", "gpt image"],
  "engines.moreProviders": ["openrouter", "mistral", "opencode", "base url", "compatible", "cursor", "cloud agent", "elevenlabs", "fish audio", "image key"],
  "engines.setup": ["needs setup", "kimi", "droid", "qwen", "hermes", "cline", "antigravity"],
  "voice.advanced": ["live call", "read replies", "hang up", "gpt-live"],
  "companion.domain": ["domain", "dns", "caddy"],
  "connections.apps": ["composio", "connected apps"],
  "engines.decisionModel": ["decision", "jev", "typesafe"],
  "organization.memory": ["obsidian", "vault"],
  "backups.import": ["import", "restore"],
};

export function cardsMatching(query: string): string[] {
  if (query.length < 3) return [];
  return Object.entries(CARD_KEYWORDS)
    .filter(([, words]) => words.some((word) => word.includes(query)))
    .map(([id]) => id);
}

/** Sections an organization server (Perspicax) leaves out: its mail is
 * managed in the Perspicax admin console. A solo server keeps Email: it
 * sends its own sign-in codes and invitations. */
export function organizationHidesSection(id: AppSettingsSection, organization: boolean): boolean {
  // Privacy holds read receipts between people, which exist there only.
  // (A person's own GitHub and MCP servers are in Connect apps > Manage.)
  return organization ? id === "mail" : id === "privacy";
}

/** Sections whose every control writes the installation. Hidden (not greyed)
 * when the viewer cannot edit it. Computer stays for an organization member:
 * their own server environment is not an installation computer. Usage stays
 * for everyone (2026-10-15): it shows the person's own usage only
 * (GET /api/me/usage). */
export function memberHidesSection(id: AppSettingsSection, input: {
  editConfig: boolean;
  manageComputers: boolean;
  manageBackups: boolean;
  organization: boolean;
}): boolean {
  if (id === "experimental" || id === "connectedApps" || id === "decisionModel" || id === "workspaces") return !input.editConfig;
  if (id === "backups") return !input.manageBackups;
  if (id === "computer") return !input.manageComputers && !input.organization;
  return false;
}

/** Settings > Memory needs the desktop app's main process (the vault is a
 * folder on this computer). */
export function orgMemoryAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.ogb?.orgMemory);
}

export function sectionMatches(section: (typeof SECTIONS)[number], query: string, extra: string[] = []): boolean {
  if (!query) return true;
  return [t(section.labelKey), ...section.keywords, ...extra].some((part) => part.toLowerCase().includes(query));
}

/** Connected apps in words (2026-10-14: it said "Not set" whatever the
 * reason). Managed through the broker, a Composio key saved, or none yet. */
export function connectedAppsSummary(config: ConfigStatus | null | undefined): string {
  const mode = config?.composio?.mode;
  if (mode === "managed") return t("connectedApps.state.managed");
  if (mode === "self-hosted" || config?.composio?.configured) return t("connectedApps.state.keySaved");
  return t("connectedApps.state.noKey");
}

/** Sub-pages pushed inside a section (src/components/SettingsSubPage.tsx):
 * the section they belong to, their title and their page. */
const SUB_PAGES: Record<string, { section: AppSettingsSection; titleKey: LocaleKey; render: () => React.ReactNode }> = {
  "general.aboutMe": { section: "general", titleKey: "settings.profile.aboutMe", render: () => <AboutMeEditor /> },
  "general.advanced": { section: "general", titleKey: "settings.advancedPage.title", render: () => <GeneralAdvancedSettings /> },
};

/** This app's updates, which download by themselves. Shown once the desktop
 * app answers: on this computer's page, never on another server's, where its
 * buttons would do nothing. */
export function UpdatesRow() {
  const s = useUpdaterState();
  const updater = window.ogb?.updater;
  if (!s || !updater) return null;
  const label =
    s.status === "checking"
      ? t("settings.updates.checking")
      : s.status === "downloading"
        ? s.percent == null
          ? t("settings.updates.startingDownload")
          : t("settings.updates.downloading", { percent: Math.round(s.percent) })
        : s.status === "preparing"
          ? t("settings.updates.preparing")
          : s.status === "downloaded"
            ? s.installMode === "handoff"
              ? t("settings.updates.readyInstall", { app: brand().name, version: s.version ?? "" })
              : t("settings.updates.ready", { app: brand().name, version: s.version ?? "" })
            : s.status === "installing"
              ? s.message ||
                (s.installMode === "handoff"
                  ? t("settings.updates.openingTerminal")
                  : t("settings.updates.restarting"))
              : s.status === "handed-off"
                ? t("settings.updates.handedOff")
                : s.status === "error"
                  ? t("settings.updates.failed", { message: s.message ?? t("settings.updates.unknownError") })
                  : t("settings.updates.latest");
  return (
    <SettingRow title={t("settings.updates.title")} subtitle={label}>
      <button
        onClick={() => {
          if (s.status === "downloaded") return void updater.install();
          void updater.check();
        }}
        disabled={
          s.status === "checking" || s.status === "downloading" || s.status === "preparing" ||
          s.status === "installing" || s.retryable === false
        }
        className="ui-button"
      >
        {s.retryable === false
          ? t("settings.updates.quitReopen")
          : s.status === "downloaded"
            ? s.installMode === "handoff"
              ? t("settings.updates.install")
              : t("settings.updates.restart")
            : s.status === "preparing"
              ? t("settings.updates.preparingShort")
              : s.status === "installing"
                ? s.installMode === "handoff"
                  ? t("settings.updates.opening")
                  : t("settings.updates.restartingShort")
                : t("settings.updates.check")}
      </button>
    </SettingRow>
  );
}

/** Opt-in to pre-release versions. Updates only ever come from Sagax's own
 * GitHub releases (electron/update-feed.mjs); this only widens the channel. */
function PrereleaseRow() {
  const s = useUpdaterState();
  const setPrereleases = window.ogb?.updater?.setPrereleases;
  if (!setPrereleases) return null;
  const on = s?.allowPrerelease === true;
  return (
    <SettingRow
      title={t("settings.updates.prerelease.title")}
      subtitle={t("settings.updates.prerelease.short")}
      help={t("settings.updates.prerelease.subtitle")}
    >
      <Switch
        checked={on}
        aria-label={t("settings.updates.prerelease.aria")}
        onClick={() => void setPrereleases(!on)}
      />
    </SettingRow>
  );
}

/** Clears the tour's steps and opens it again on the live interface. */
function ReplayAppTourButton() {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div>
      <button
        disabled={saving}
        onClick={() => {
          setSaving(true);
          setFailed(false);
          void api("/api/config", {
            method: "PUT",
            body: JSON.stringify({ onboarding: {
              // Upgraded users may have completed only the legacy browser gate.
              ...(!state.config?.onboarding?.completedAt ? completionPatch().onboarding : {}),
              hintsSeen: withTourReset(state.config?.onboarding),
            } }),
            signal: AbortSignal.timeout(10_000),
          })
            .then((config) => {
              dispatch({ type: "configStatus", config });
              dispatch({ type: "toggleTour", open: true });
            })
            .catch(() => setFailed(true))
            .finally(() => setSaving(false));
        }}
        className="ui-button"
      >
        {t("settings.welcome.appTour")}
      </button>
      {failed && <p role="alert" className="mt-2 text-[13px] text-danger">{t("onboarding.tour.error")}</p>}
    </div>
  );
}

// Three rows, one action each, so every button sits in the row's action
// column like Updates and Diagnostics.
function ReplayTourRow() {
  const { state, dispatch } = useStore();
  const launchMode = state.config?.onboarding?.launchMode ?? "solo";
  return (
    <>
      <SettingRow title={t("settings.appTour.title")} subtitle={t("settings.appTour.subtitle")}>
        <ReplayAppTourButton />
      </SettingRow>
      <SettingRow title={t("settings.welcome.title")} subtitle={t("settings.welcome.subtitle")}>
        <button onClick={() => dispatch({ type: "toggleWelcome", open: true })} className="ui-button">
          {t("settings.welcome.replay")}
        </button>
      </SettingRow>
      {/* the launch screen: no server or an organization server */}
      {launchBridges(window.ogb) && (
        <SettingRow
          title={t("settings.launch.title")}
          subtitle={t(launchMode === "server" ? "settings.launch.server" : "settings.launch.solo")}
        >
          <button
            onClick={() => dispatch({ type: "toggleLaunch", open: true, mode: launchMode })}
            className="ui-button"
          >
            {t("settings.launch.change")}
          </button>
        </SettingRow>
      )}
    </>
  );
}

function LanguageRow() {
  const { state } = useStore();
  // Follows the account: anyone can switch, including a chat-only teammate,
  // and nobody changes another person's screen. The server's language is
  // the default until this person picks one.
  const current = effectiveLanguage(useLanguageChoice(), state.config?.language);

  return (
    <SettingRow
      title={t("settings.language.title")}
      subtitle={t("settings.language.short")}
      help={t("settings.language.subtitle")}
    >
      <select
        value={current}
        aria-label={t("settings.language.aria")}
        onChange={(event) => setLanguageChoice(event.target.value)}
        className="w-full max-w-[240px] rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none disabled:cursor-wait disabled:opacity-50"
      >
        <option value="">{t("settings.language.system")}</option>
        {localeChoices.map(({ code, label }) => (
          <option key={code} value={code}>
            {label}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}

/** Desktop mascots: fly off to the screen edge while the bot works, back when done. */
function FloatingFlyAwayRow() {
  const prefs = useSyncExternalStore(subscribeFloatingBots, floatingBotPrefs, floatingBotPrefs);
  return (
    <SettingRow title={t("settings.floatingBots.flyAway.title")} subtitle={t("settings.floatingBots.flyAway.subtitle")}>
      <Switch
        checked={prefs.flyAway}
        aria-label={t("settings.floatingBots.flyAway.title")}
        onClick={() => setFloatingFlyAway(!prefs.flyAway)}
      />
    </SettingRow>
  );
}

/** Desktop mascots: Shiba barks out loud (off by default; the bark itself always shows). */
function FloatingBarkSoundRow() {
  const prefs = useSyncExternalStore(subscribeFloatingBots, floatingBotPrefs, floatingBotPrefs);
  return (
    <SettingRow title={t("settings.floatingBots.barkSound.title")} subtitle={t("settings.floatingBots.barkSound.subtitle")}>
      <Switch
        checked={prefs.barkSound}
        aria-label={t("settings.floatingBots.barkSound.title")}
        onClick={() => setFloatingBarkSound(!prefs.barkSound)}
      />
    </SettingRow>
  );
}

/** Desktop mascots: how often they move and play on their own. */
function FloatingLivelinessRow() {
  const prefs = useSyncExternalStore(subscribeFloatingBots, floatingBotPrefs, floatingBotPrefs);
  return (
    <SettingRow title={t("settings.floatingBots.liveliness.title")} subtitle={t("settings.floatingBots.liveliness.subtitle")}>
      <select
        value={prefs.liveliness}
        aria-label={t("settings.floatingBots.liveliness.title")}
        onChange={(event) => setFloatingLiveliness(event.target.value as FloatingLiveliness)}
        className="w-full max-w-[240px] rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none"
      >
        {FLOATING_LIVELINESS.map((level) => (
          <option key={level} value={level}>{t(`settings.floatingBots.liveliness.${level}`)}</option>
        ))}
      </select>
    </SettingRow>
  );
}

/** Desktop mascots: the global call hotkey (press to call, again to mute, hold to talk), on unless switched off. */
function FloatingHotkeyRow() {
  const prefs = useSyncExternalStore(subscribeFloatingBots, floatingBotPrefs, floatingBotPrefs);
  // the desktop app only: a browser has no global keys
  if (typeof window === "undefined" || !(window.ogb?.floatingBots as { hotkey?: unknown } | undefined)?.hotkey) return null;
  const mac = /Mac/.test(navigator.platform || navigator.userAgent);
  return (
    <SettingRow title={t("settings.floatingBots.hotkey.title")} subtitle={t("settings.floatingBots.hotkey.subtitle")}>
      <div className="flex items-center gap-2">
        <select
          value={prefs.hotkeyKeys}
          disabled={!prefs.hotkey}
          aria-label={t("settings.floatingBots.hotkey.keys")}
          onChange={(event) => setFloatingHotkey({ keys: event.target.value as HotkeyChoice })}
          className="w-full max-w-[200px] rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none disabled:opacity-50"
        >
          {HOTKEY_CHOICES.map((keys) => (
            <option key={keys} value={keys}>{hotkeyLabel(keys, mac)}</option>
          ))}
        </select>
        <Switch
          checked={prefs.hotkey}
          aria-label={t("settings.floatingBots.hotkey.title")}
          onClick={() => setFloatingHotkey({ on: !prefs.hotkey })}
        />
      </div>
    </SettingRow>
  );
}

/** Desktop mascots: live captions beside the mascot during a call (a call setting, kept on this device). */
function FloatingCaptionsRow() {
  const call = useCallSettings();
  const on = call.captions !== false;
  return (
    <SettingRow title={t("settings.floatingBots.captions.title")} subtitle={t("settings.floatingBots.captions.subtitle")}>
      <Switch checked={on} aria-label={t("settings.floatingBots.captions.title")} onClick={() => writeCallSettings({ captions: !on })} />
    </SettingRow>
  );
}

function FontRow() {
  const [current, setCurrent] = useState<FontId>(readFont);
  return (
    <SettingRow title={t("settings.font.title")} subtitle={t("settings.font.subtitle")}>
      <select
        value={current}
        aria-label={t("settings.font.aria")}
        onChange={(event) => {
          // SAFETY: the options are rendered from FONT_IDS, so the value is always a member.
          const id = event.target.value as FontId;
          applyFont(id);
          setCurrent(id);
        }}
        className="w-full max-w-[240px] rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none"
      >
        {FONT_IDS.map((id) => (
          <option key={id} value={id}>{t(`settings.font.${id}`)}</option>
        ))}
      </select>
    </SettingRow>
  );
}

/** Which keys send a message (Enter, Shift+Enter or Ctrl/Cmd+Enter), on this device only. */
function SendKeyRow() {
  const sendKey = useSendKey();
  return (
    <SettingRow title={t("settings.sendKey.title")} subtitle={t("settings.sendKey.subtitle", { key: sendKeyLabel("mod-enter") })}>
      <select
        value={sendKey}
        aria-label={t("settings.sendKey.title")}
        onChange={(event) => setSendKey(parseSendKey(event.target.value))}
        className="w-full max-w-[240px] rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none"
      >
        {SEND_KEYS.map((mode) => (
          <option key={mode} value={mode}>{sendKeyLabel(mode)}</option>
        ))}
      </select>
    </SettingRow>
  );
}

function SidebarDensityRow() {
  const density = useSidebarDensity();
  const choose = (next: SidebarDensity) => setSidebarDensity(parseSidebarDensity(next));
  return (
    <SettingRow title={t("sidebar.density.title")} subtitle={t("settings.sidebarDensity.subtitle")}>
      <select
        aria-label={t("sidebar.density.chooseAria")}
        value={density}
        onChange={(event) => choose(event.target.value as SidebarDensity)}
        className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none"
      >
        {SIDEBAR_DENSITIES.map((option) => (
          <option key={option} value={option}>{t(option === "icons" ? "sidebar.density.iconsOnly" : option === "compact" ? "sidebar.density.compact" : "sidebar.density.comfortable")}</option>
        ))}
      </select>
    </SettingRow>
  );
}

type ThreadsView = "hidden" | ThreadsLocation;

/** Hidden keeps the last place, for when threads come back. */
export function chooseThreadsView(next: ThreadsView): void {
  if (next === "hidden") {
    setShowThreads(false);
    return;
  }
  setThreadsLocation(next);
  setShowThreads(true);
}

/** One choice for whether and where conversation threads show (2026-10-14:
 * it was "Conversations" on/off plus "Threads location", greyed while off).
 * Both stored values stay: hiding keeps the last place for when they return. */
function ThreadsViewRow() {
  const enabled = useShowThreadsChoice();
  const location = useThreadsLocationChoice();
  const value: ThreadsView = enabled ? location : "hidden";
  return (
    <SettingRow title={t("settings.threadsView.title")} subtitle={t("settings.threadsView.subtitle")} help={t("settings.threadDisplay.subtitle")}>
      <select
        aria-label={t("settings.threadsView.title")}
        value={value}
        onChange={(event) => chooseThreadsView(event.target.value as ThreadsView)}
        className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none"
      >
        <option value="hidden">{t("settings.threadsView.hidden")}</option>
        <option value="header">{t("settings.threadsLocation.header")}</option>
        <option value="sidebar">{t("settings.threadsLocation.sidebar")}</option>
      </select>
    </SettingRow>
  );
}

function ShowUnreadyProvidersRow() {
  const enabled = useShowUnreadyProviders();
  return (
    <SettingRow title={t("settings.unreadyProviders.title")} subtitle={t("settings.unreadyProviders.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.unreadyProviders.show")}
        onClick={() => setShowUnreadyProviders(!enabled)}
      />
    </SettingRow>
  );
}

function InspectorButtonRow() {
  const enabled = useShowInspectorButton();
  return (
    <SettingRow title={t("settings.inspectorButton.title")} subtitle={t("settings.inspectorButton.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.inspectorButton.show")}
        onClick={() => setShowInspectorButton(!enabled)}
      />
    </SettingRow>
  );
}

function SidebarLogoRow() {
  const enabled = useShowSidebarLogo();
  return (
    <SettingRow title={t("settings.sidebarLogo.title")} subtitle={t("settings.sidebarLogo.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.sidebarLogo.show")}
        onClick={() => setShowSidebarLogo(!enabled)}
      />
    </SettingRow>
  );
}

/** Connected apps and Browse Bots as menu rows at the foot of the sidebar.
 * On, the account row drops its title and points line for lack of room. */
function SidebarShortcutsRow() {
  const { state } = useStore();
  const enabled = useSidebarShortcuts(state.config);
  return (
    <SettingRow title={t("settings.sidebarShortcuts.title")} subtitle={t("settings.sidebarShortcuts.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.sidebarShortcuts.show")}
        onClick={() => setSidebarShortcuts(!enabled)}
      />
    </SettingRow>
  );
}

function RoutinesBadgeRow() {
  const enabled = useShowRoutinesBadge();
  return (
    <SettingRow title={t("settings.routinesBadge.title")} subtitle={t("settings.routinesBadge.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.routinesBadge.show")}
        onClick={() => setShowRoutinesBadge(!enabled)}
      />
    </SettingRow>
  );
}

function RunCardRow() {
  const enabled = useShowRunCard();
  return (
    <SettingRow title={t("settings.runCard.title")} subtitle={t("settings.runCard.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.runCard.show")}
        onClick={() => setShowRunCard(!enabled)}
      />
    </SettingRow>
  );
}

function RoutinesInConversationRow() {
  const { state, dispatch } = useStore();
  const enabled = routinesInConversationEnabled(state.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { routinesInConversation: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.routinesInConversation.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow
      title={t("settings.routinesInConversation.title")}
      subtitle={t("settings.routinesInConversation.short")}
      help={t("settings.routinesInConversation.subtitle")}
      message={error ? <p role="alert" className="text-danger">{error}</p> : null}
    >
      <Switch
        checked={enabled}
        aria-label={t("settings.routinesInConversation.aria")}
        disabled={saving}
        onClick={() => void toggle()}
        className="disabled:cursor-wait disabled:opacity-50"
      />
    </SettingRow>
  );
}

function ToolCallsRow() {
  const { state, dispatch } = useStore();
  const enabled = showToolCallsEnabled(state.config);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { showToolCalls: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolCalls.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow
      title={t("settings.toolCalls.title")}
      subtitle={t("settings.toolCalls.short")}
      help={<>{t("settings.toolCalls.subtitle")} {t("settings.toolCalls.detail")}</>}
      message={error ? <p role="alert" className="text-danger">{error}</p> : null}
    >
      <Switch
        checked={enabled}
        aria-label={t("settings.toolCalls.aria")}
        disabled={saving}
        onClick={() => void toggle()}
        className="disabled:cursor-wait disabled:opacity-50"
      />
    </SettingRow>
  );
}

// 2026-10-14: "Advanced routine and group settings" left this list. Routines
// in the conversation and Group turns are in General > Advanced, a sub-page
// only Advanced mode shows: one way to reach them, not two locks.
type ExperimentalFeature = "skillAuthoring" | "browser" | "connectedApps" | "decisionModel" | "dataWindow";

function ExperimentalFeaturesRow() {
  const { state, dispatch } = useStore();
  const skillAuthoring = skillAuthoringEnabled(state.config);
  const browser = builtInBrowserEnabled(state.config);
  const connectedApps = connectedAppsEnabled(state.config);
  const decisionModel = decisionModelEnabled(state.config);
  const dataWindow = dataWindowEnabled(state.config);
  // A server that predates the Data window (Sagax 0.5.2 and earlier, e.g. an
  // organization server not updated yet) sends no dataWindow and refuses to
  // save one: the row stays, greyed, with the reason.
  const dataWindowServed = typeof state.config?.features?.dataWindow === "boolean";
  const desktopBrowser = browserAvailable(state.config);
  const browserInstallable = state.config?.browserEngine?.installable === true;
  const browserBlockedOnWindows = window.ogb?.platform === "win32" && !desktopBrowser && !browserInstallable;
  const [saving, setSaving] = useState<ExperimentalFeature | null>(null);
  const [error, setError] = useState("");

  // The switches show the server's saved state, read again when this card
  // opens: never a copy this page kept from earlier.
  useEffect(() => {
    let live = true;
    api<ConfigStatus>("/api/config").then((config) => { if (live) dispatch({ type: "configStatus", config }); }, () => {});
    return () => { live = false; };
  }, [dispatch]);

  const toggle = async (feature: ExperimentalFeature, next: boolean) => {
    if (saving) return;
    setSaving(feature);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { [feature]: next } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.experimental.error"));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card
      collapsible
      cardId="experimental.features"
      title={t("settings.experimental.title")}
      subtitle={t("settings.experimental.subtitle")}
      summary={t("settings.card.countOn", { count: Number(skillAuthoring) + Number(browser) + Number(connectedApps) + Number(decisionModel) + Number(dataWindow), total: 5 })}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{t("settings.experimental.skillAuthoring")}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
            {t("settings.experimental.skillAuthoringDetail")}
          </div>
        </div>
        <Switch
          checked={skillAuthoring}
          aria-label={t("settings.experimental.skillAuthoringAria")}
          disabled={saving !== null}
          onClick={() => void toggle("skillAuthoring", !skillAuthoring)}
          className="disabled:cursor-wait disabled:opacity-50"
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-hairline/30 pt-4">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{t("settings.experimental.browser")}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
            {desktopBrowser
              ? browser
                ? t("settings.experimental.browserOn")
                : t("settings.experimental.browserOff")
              : browserBlockedOnWindows
                ? t("settings.experimental.browserWindows")
                : <BrowserUnavailableNote config={state.config} />}
          </div>
        </div>
        <Switch
          checked={browser}
          aria-label={t("settings.experimental.browserAria")}
          disabled={saving !== null || (!browser && !desktopBrowser && !browserInstallable)}
          onClick={() => void toggle("browser", !browser)}
          className="disabled:cursor-wait disabled:opacity-50"
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-hairline/30 pt-4" data-experimental-connected-apps>
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{t("settings.experimental.connectedApps")}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
            <SettingsText
              text={t("settings.experimental.connectedAppsDetail")}
              links={{
                apiKeys: { section: "connections", cardId: "connections.apps" },
                providers: { section: "engines" },
              }}
            />
          </div>
        </div>
        <Switch
          checked={connectedApps}
          aria-label={t("settings.experimental.connectedAppsAria")}
          disabled={saving !== null}
          onClick={() => void toggle("connectedApps", !connectedApps)}
          className="disabled:cursor-wait disabled:opacity-50"
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-hairline/30 pt-4" data-experimental-feature="decisionModel">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{t("settings.experimental.decisionModel")}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("settings.experimental.decisionModelDetail")}</div>
        </div>
        <Switch
          checked={decisionModel}
          aria-label={t("settings.experimental.decisionModel")}
          disabled={saving !== null}
          onClick={() => void toggle("decisionModel", !decisionModel)}
          className="disabled:cursor-wait disabled:opacity-50"
        />
      </div>
      <div className="mt-4 flex items-center justify-between gap-4 border-t border-hairline/30 pt-4" data-experimental-feature="dataWindow">
        <div className="min-w-0">
          <div className="text-[14px] font-medium text-ink">{t("settings.experimental.dataWindow")}</div>
          <div className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">
            {dataWindowServed ? t("settings.experimental.dataWindowDetail") : t("settings.experimental.dataWindowServerOld")}
          </div>
        </div>
        <Switch
          checked={dataWindow}
          aria-label={t("settings.experimental.dataWindowAria")}
          disabled={saving !== null || (!dataWindow && !dataWindowServed)}
          onClick={() => void toggle("dataWindow", !dataWindow)}
          className="disabled:cursor-wait disabled:opacity-50"
        />
      </div>
      {error ? <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p> : null}
    </Card>
  );
}

/** Reads the skin when the collapsed summary mounts, so a skin picked while
 * the card was open is the one it names. */
function CurrentSkinName() {
  const id = readSkin();
  return <>{SKINS.find((skin) => skin.id === id)?.name ?? id}</>;
}

function BrowserProfilesRow() {
  const { state } = useStore();
  const profiles = state.config?.browserProfiles ?? [];
  if (!builtInBrowserEnabled(state.config) && profiles.length === 0) return null;
  return (
    <Card
      collapsible
      cardId="experimental.browserProfiles"
      defaultOpen={false}
      title={t("settings.profiles.title")}
      subtitle={t("settings.profiles.sharedSubtitle")}
      summary={cardCount("profiles", profiles.length)}
    >
      <BrowserProfilesManager />
    </Card>
  );
}

/** Writes a redacted diagnostics file to a location the user picks. The
 * report holds versions, configured-or-not booleans and the server.log tail:
 * never credential values (the desktop shell does not read secret fields). */
function DiagnosticsRow() {
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  const exportDiagnostics = async () => {
    if (!window.ogb?.exportDiagnostics || exporting) return;
    setExporting(true);
    setResult(null);
    try {
      const path = await window.ogb.exportDiagnostics();
      if (path) setResult({ kind: "success", message: t("settings.diagnostics.saved", { path }) });
    } catch (e) {
      setResult({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setExporting(false);
    }
  };

  return (
    <SettingRow
      title={t("settings.diagnostics.title")}
      subtitle={t("settings.diagnostics.short")}
      help={t("settings.diagnostics.subtitle")}
      message={result ? (
        <p role={result.kind === "error" ? "alert" : "status"} className={cn("break-all", result.kind === "error" ? "text-danger" : "text-success")}>
          {result.message}
        </p>
      ) : null}
    >
      <button
        onClick={() => void exportDiagnostics()}
        disabled={exporting}
        aria-label={t("settings.diagnostics.aria")}
        className="ui-button"
      >
        {exporting ? t("settings.diagnostics.exporting") : t("settings.diagnostics.export")}
      </button>
    </SettingRow>
  );
}

/** The six desktop mascot rows in one folded card (2026-10-14: they were a
 * third of Appearance). Folded, every value set here still applies. */
function DesktopMascotsCard() {
  return (
    <Card
      collapsible
      cardId="appearance.mascots"
      defaultOpen={false}
      title={t("settings.mascotsCard.title")}
      subtitle={t("settings.mascotsCard.subtitle")}
    >
      <div className="-mx-3.5 -mb-1">
        <FloatingFlyAwayRow />
        <FloatingLivelinessRow />
        <FloatingBarkSoundRow />
        <FloatingHotkeyRow />
        <FloatingCaptionsRow />
      </div>
    </Card>
  );
}

/** The desktop app in "No server" mode: Settings > Organization is hidden
 * there (nothing to show until it joins one). */
export function isSoloDesktop(config: ConfigStatus | null | undefined): boolean {
  const remoteActive = window.ogb?.remoteClient?.active === true;
  return !remoteActive && Boolean(launchBridges(window.ogb)) && config?.onboarding?.launchMode !== "server";
}

/** Organization > routines in the conversation, group turns and MCP calls
 * (2026-10-15, JC: they were in General > Advanced; they set how the bots of
 * the organization work). Admin or owner only, in Advanced mode, as before.
 * A desktop with no server shows them in General > Advanced instead
 * (Organization is hidden there): same cards, same ids. */
export function OrganizationAdvancedCards() {
  const { state } = useStore();
  const remoteActive = window.ogb?.remoteClient?.active === true;
  if (!canEditConfig(state.config)) return null;
  return (
    <>
      {!remoteActive && (
        <div className="rounded-[14px] border-[0.5px] border-border py-1" data-settings-card="organization.routinesInConversation">
          <RoutinesInConversationRow />
        </div>
      )}
      <Card
        collapsible
        cardId="organization.roomTurns"
        defaultOpen={false}
        title={t("settings.roomTurns.title")}
        subtitle={t("settings.roomTurns.subtitle")}
        summary={t("settings.card.roomTurns", { minutes: state.config?.rooms.turnTimeoutMinutes ?? 5 })}
      >
        <RoomTurnTimeoutSettings />
      </Card>
      <Card
        collapsible
        cardId="organization.mcpCalls"
        defaultOpen={false}
        title={t("settings.mcpCalls.title")}
        subtitle={t("settings.mcpCalls.subtitle")}
        summary={`${mcpCallTimeoutMinutes(state.config)} ${t("settings.mcpCalls.minutes")}`}
      >
        <McpCallTimeoutSettings />
      </Card>
    </>
  );
}

/** General > Advanced (2026-10-14): the technical cards of General on a page
 * of their own, shown in Advanced mode. 2026-10-15: routines in the
 * conversation, group turns and MCP calls moved to Organization; they stay
 * here on a desktop with no server, where Organization is hidden. Their
 * saved values apply whether or not anyone looks. */
export function GeneralAdvancedSettings() {
  const { state } = useStore();
  const editConfig = canEditConfig(state.config);
  return (
    <div className="flex flex-col gap-3" data-general-advanced="">
      {isSoloDesktop(state.config) && <OrganizationAdvancedCards />}
      {editConfig && (
        <>
          {/* 2026-10-15: Tool access, Parallel conversations and Automatic
              recovery are each bot's own, in its editor (Permissions and
              Model pages). A person's grants stay here. */}
          <PeopleToolAccessSettings />
          <ThreadCleanupSettings />
        </>
      )}
      <div className="rounded-[14px] border-[0.5px] border-border py-1 empty:hidden">
        <PrereleaseRow />
        <DiagnosticsRow />
      </div>
    </div>
  );
}

function InterfaceModeRow() {
  const advanced = useAdvancedMode();
  return (
    <SettingRow title={t("settings.advancedMode.title")} subtitle={t("settings.advancedMode.subtitle")}>
      <Switch
        checked={advanced}
        aria-label={t("settings.advancedMode.title")}
        onClick={() => setAdvancedMode(!advanced)}
      />
    </SettingRow>
  );
}

export function SettingsModal() {
  const { state, dispatch } = useStore();
  const advanced = useAdvancedMode();
  const retroSkin = useRetroSkin();
  const remoteActive = window.ogb?.remoteClient?.active === true;
  // An old section id opens the page that holds it now. A remote client
  // shows this desktop's own pages only (Appearance, Organization,
  // Notifications); Pair devices, its old landing page, is hidden since
  // 2026-10-14, so it lands on Appearance.
  const current = currentSettingsSection(state.appSettingsSection);
  const requested: AppSettingsSection =
    remoteActive && current !== "appearance" && current !== "organization" && current !== "notifications"
      ? "appearance"
      : current;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => window.ogb?.environments?.onOpenSettings?.(() => setQuery("")), []);
  useEffect(() => window.ogb?.onOpenAppSettings?.(() => setQuery("")), []);
  const q = query.trim().toLowerCase();
  const ownerOrAdmin = useOwnerOrAdmin();
  const editConfig = canEditConfig(state.config);
  const manageComputers = canManageComputers(state.config);
  const manageBackups = canManageBackups(state.config);
  // Server mode: this app shows its organization's server only (src/lib/launch.ts).
  const serverMode = useServerMode();
  const lockedServer = serverMode?.active ? serverMode : null;
  // An organization server (Perspicax): the desktop locked to one, or a
  // page whose server answers GET /api/org as Perspicax.
  const perspicaxOrg = usePerspicaxOrg();
  const organization = Boolean(lockedServer) || perspicaxOrg !== null;
  const soloDesktop = isSoloDesktop(state.config);
  // Whether a section id (a page, or a former page that is a card now) may
  // show for this viewer. A card keeps the rules its section had.
  const allowed = (id: AppSettingsSection): boolean => {
    // a remote client shows the pages that are about this desktop
    if (remoteActive && !["appearance", "organization", "privacy", "notifications", "memory"].includes(id)) return false;
    // the organization memory's local cache is the desktop app's (main
    // process), set up by itself on an organization server signed in with
    // Perspicax: nothing to show anywhere else
    if (id === "memory" && !(orgMemoryAvailable() && perspicaxOrg !== null)) return false;
    // the desktop app in "No server" mode has no organization to show; it
    // joins one from General > Server, which brings this section back
    if (id === "organization" && soloDesktop) return false;
    // the operator's screen for other workspaces exists only where a fleet agent does
    if (id === "workspaces" && !workspacesAvailable(state.config)) return false;
    // sign-in by email is a served solo server's (the desktop app pairs
    // devices under Remote access), or the read-only view of a hosted
    // workspace whose members the organisation's Admin decides. An
    // organization server sends no sign-in list: Perspicax owns its people.
    // A served page, in a browser or drawn by the desktop app on that server
    // (electron/bundled-ui.cjs): the same server shows the same sections.
    if (id === "people" && !(servedPage() && (readMembership(state.config).authority === "portal" || peopleListServed(state.config)))) return false;
    // how the server sends sign-in codes and invitations: its admins and
    // the operator, on the desktop and on the web
    if (id === "mail" && ownerOrAdmin !== true) return false;
    if (organizationHidesSection(id, organization)) return false;
    // the activity log belongs to a workspace served to a browser, and to its admins
    // (2026-10-09: and to a person whose profile includes people.activityLog)
    if (id === "activity" && !(servedPage() && (ownerOrAdmin === true || (perspicaxOrg !== null && viewerCan(state.config, "people.activityLog"))))) return false;
    // Installation writes the server refuses with 403: hide the section.
    if (memberHidesSection(id, { editConfig, manageComputers, manageBackups, organization })) return false;
    // Decision model and Connected apps (Composio) are experimental, off until their switch is on.
    if (id === "decisionModel" && !decisionModelEnabled(state.config)) return false;
    if (id === "connectedApps" && !connectedAppsEnabled(state.config)) return false;
    // Simple hides technical sections. Their saved values stay.
    return advanced || !simpleHidesSettingsSection(id);
  };
  const memoryShown = allowed("memory");
  // A request for Settings > Organization (the Server menu, a deep link) on
  // a desktop with no server opens the launch screen on Server instead,
  // unless the page holds this computer's organization memory.
  // A link to a card moved from General > Advanced (2026-10-15) opens
  // General > Advanced there, where those cards stay.
  useEffect(() => {
    if (!soloDesktop || memoryShown || state.appSettingsSection !== "organization") return;
    if (isMovedOrganizationCard(takeRequestedSettingsCard())) {
      dispatch({ type: "toggleAppSettings", open: true, section: "general", subPage: "general.advanced" });
      return;
    }
    dispatch({ type: "toggleAppSettings", open: false, section: "general" });
    dispatch({ type: "toggleLaunch", open: true, mode: "server" });
  }, [soloDesktop, memoryShown, state.appSettingsSection, dispatch]);
  // A page shows when it is allowed, or when one of the cards it holds is.
  const availableSections = SECTIONS.filter((entry) => allowed(entry.id) || (HOSTED_CARDS[entry.id] ?? []).some(allowed));
  // A page this viewer cannot see (an old link to Email where People is not
  // shown, a hidden page) draws the first page they can, at once.
  const section: AppSettingsSection = availableSections.some((entry) => entry.id === requested) ? requested : availableSections[0]?.id ?? requested;
  const visibleSections = availableSections.filter((entry) => sectionMatches(entry, q, soloDesktop && entry.id === "general" ? ORGANIZATION_ADVANCED_KEYWORDS : []));
  const sectionLabelKey = SECTIONS.find((entry) => entry.id === section)?.labelKey;
  const subPageId = state.appSettingsSubPage;
  const subPage = subPageId && SUB_PAGES[subPageId]?.section === section ? SUB_PAGES[subPageId] : null;
  const openSubPage = (id: string) => dispatch({ type: "toggleAppSettings", open: true, section: SUB_PAGES[id].section, subPage: id });
  const closeSubPage = useCallback(() => {
    const from = state.appSettingsSubPage;
    dispatch({ type: "toggleAppSettings", open: true, section });
    // Back where the person left: the row that opened the page.
    if (from && typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        const row = [...document.querySelectorAll<HTMLElement>("[data-settings-card]")].find((node) => node.dataset.settingsCard === from);
        row?.querySelector<HTMLElement>("button")?.focus();
      });
    }
  }, [dispatch, section, state.appSettingsSubPage]);
  const nextVisibleSection = visibleSections.some((entry) => entry.id === section) ? undefined : visibleSections[0]?.id;

  useEffect(() => {
    for (const id of cardsMatching(q)) requestSettingsCard(id);
  }, [q]);

  // Searching shows the matching sections, not the page that was open.
  useEffect(() => {
    if (q && subPage) dispatch({ type: "toggleAppSettings", open: true, section });
  }, [q, subPage, section, dispatch]);

  useEffect(() => {
    // Translated matches can change without the query changing. Follow the
    // rendered results instead of a second filter with stale effect inputs.
    if (nextVisibleSection) dispatch({ type: "toggleAppSettings", open: true, section: nextVisibleSection });
  }, [dispatch, nextVisibleSection]);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const search = dialog?.querySelector<HTMLInputElement>("[data-settings-search]");
    if (search?.checkVisibility()) search.focus();
    else dialog?.focus();

    const onKey = (event: KeyboardEvent) => {
      // A child editor owns Escape and its focus trap, including while saving.
      if (event.defaultPrevented || (dialog && [...dialog.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')]
        .some(child => child.getClientRects().length))) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "toggleAppSettings", open: false });
        return;
      }
      if (event.key !== "Tab" || !dialog) return;

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.checkVisibility());
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previousFocus?.focus();
    };
  }, [dispatch]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && dispatch({ type: "toggleAppSettings", open: false })}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-settings-title"
        tabIndex={-1}
        className="flex h-[min(700px,calc(100dvh-96px))] w-[min(900px,calc(100vw-40px))] overflow-hidden rounded-[14px] border border-border bg-app outline-none"
      >
        {/* section nav */}
        <span id="app-settings-title" className="sr-only">{t("settings.title")}</span>
        <nav className="hidden min-h-0 w-[198px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-hairline-weak bg-panel px-3 py-4 sm:flex">
          <div className="shrink-0 px-2 py-2 text-[13px] font-semibold text-ink">
            {t("settings.title")}
          </div>
          <div className="mb-2 mt-1 flex shrink-0 items-center gap-2 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 focus-within:border-border-strong">
            <Search size={14} className="shrink-0 text-ink-secondary" />
            <input
              data-settings-search
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                e.stopPropagation();
                if (query) setQuery("");
                else dispatch({ type: "toggleAppSettings", open: false });
              }}
              placeholder={t("settings.search")}
              aria-label={t("settings.searchAria")}
              className="w-full bg-transparent text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </div>
          {visibleSections.length === 0 && (
            <div className="px-2.5 py-4 text-[12.5px] leading-relaxed text-ink-secondary">
              {t("settings.noMatch", { query: query.trim() })}
            </div>
          )}
          {visibleSections.map(({ id, labelKey, icon: Icon }) => (
            <button
              key={id}
              onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: id })}
              aria-current={section === id ? "page" : undefined}
              className={cn(
                "flex items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-left text-[13px] leading-[18px] text-ink transition-colors motion-reduce:transition-none",
                section === id ? "bg-selected" : "hover:bg-hover",
              )}
            >
              <Icon size={15} className="shrink-0" />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          <button
            onClick={() => dispatch({ type: "toggleAppSettings", open: false })}
            aria-label={t("settings.close")}
            title={`${t("settings.close")} (${shortcutLabel("close-panel")})`}
            className="absolute right-2.5 top-2.5 z-10 flex size-8 items-center justify-center rounded-full text-ink-tertiary hover:bg-ink/10 hover:text-ink-secondary"
          >
            <X size={18} />
          </button>
          <div className="shrink-0 px-4 pb-1 pr-12 pt-3 sm:hidden">
            <select
              aria-label={t("settings.title")}
              value={section}
              onChange={(event) => {
                setQuery("");
                dispatch({ type: "toggleAppSettings", open: true, section: event.target.value as AppSettingsSection });
              }}
              className="w-full min-w-0 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none sm:hidden"
            >
              {availableSections.map(({ id, labelKey }) => (
                <option key={id} value={id}>{t(labelKey)}</option>
              ))}
            </select>
          </div>

          {subPage && subPageId ? (
            <SettingsSubPage
              pageId={subPageId}
              sectionLabel={sectionLabelKey ? t(sectionLabelKey) : ""}
              title={t(subPage.titleKey)}
              onBack={closeSubPage}
            >
              {subPage.render()}
            </SettingsSubPage>
          ) : (
          <div className="flex flex-1 flex-col overflow-y-auto">
            <h2 className="hidden px-8 pb-1 pt-6 text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink sm:block">
              {sectionLabelKey ? t(sectionLabelKey) : null}
            </h2>
            <div className="flex flex-col gap-3 px-4 pb-6 pt-4 sm:px-8">
            <LicenseExpiryBanner config={state.config} />
            {section === "organization" && (
              <>
                {allowed("organization") && <OrganizationSettings />}
                {/* Memory (2026-10-14): a card of Organization, not a page. */}
                {memoryShown && (
                  <Card collapsible cardId="organization.memory" title={t("settings.section.memory")}>
                    <OrgMemorySettings />
                  </Card>
                )}
                {/* From General > Advanced (2026-10-15): routines in the
                    conversation, group turns, MCP calls. */}
                {advanced && allowed("organization") && <OrganizationAdvancedCards />}
              </>
            )}
            {section === "general" && (
              <>
                {/* 2026-10-15: one account card (who, label, server, Sign out) */}
                <AccountCard lockedServer={lockedServer} />
                {(!state.config?.viewer || state.config.viewer.operator) && (
                  <SettingsSubPageRow
                    cardId="general.aboutMe"
                    title={t("settings.profile.aboutMe")}
                    summary={aboutMeFirstLine(state.config?.profile?.aboutMe)}
                    actionLabel={t("settings.aboutMe.edit")}
                    onOpen={() => openSubPage("general.aboutMe")}
                  />
                )}
                <div className="rounded-[14px] border-[0.5px] border-border py-1">
                  <LanguageRow />
                  {advanced && editConfig && <DefaultBotSettings />}
                </div>
                <div className="rounded-[14px] border-[0.5px] border-border py-1">
                  {!remoteActive && <ReplayTourRow />}
                  <UpdatesRow />
                </div>
                {/* General > Advanced (2026-10-14): tool access, parallel
                    conversations, recovery, cleanup, pre-releases and
                    diagnostics on one sub-page (routines, group turns and
                    MCP calls went to Organization on 2026-10-15).
                    A search that names one of them shows them here. */}
                {advanced && (q
                  ? <GeneralAdvancedSettings />
                  : (
                    <SettingsSubPageRow
                      cardId="general.advanced"
                      title={t("settings.advancedPage.title")}
                      summary={t("settings.advancedPage.summary")}
                      actionLabel={t("settings.advancedPage.open")}
                      onOpen={() => openSubPage("general.advanced")}
                    />
                  ))}
              </>
            )}

            {section === "appearance" && (
              <>
                <div className="rounded-[14px] border-[0.5px] border-border py-1">
                  <InterfaceModeRow />
                </div>
                <Card
                  collapsible
                  cardId="appearance.skin"
                  title={t("settings.skin.title")}
                  subtitle={t("settings.skin.subtitle")}
                  summary={<CurrentSkinName />}
                >
                  <SkinPicker />
                </Card>
                {appIconAvailable() && (
                  <Card
                    collapsible
                    cardId="appearance.appIcon"
                    defaultOpen={false}
                    title={t("settings.appIcon.title")}
                    subtitle={t("settings.appIcon.subtitle")}
                  >
                    <AppIconPicker />
                  </Card>
                )}
                <div className="rounded-[14px] border-[0.5px] border-border py-1">
                  <FontRow />
                  <SendKeyRow />
                  <SidebarDensityRow />
                  <ThreadsViewRow />
                  {/* Simple shows what most people change; the rest is Advanced (2026-10-14). */}
                  {advanced && <SidebarLogoRow />}
                  {advanced && <SidebarShortcutsRow />}
                  {advanced && <RoutinesBadgeRow />}
                  {advanced && <InspectorButtonRow />}
                  {advanced && <ShowUnreadyProvidersRow />}
                  {/* Simple: the sidebar's own "Hidden (N)" row brings entries back. */}
                  {advanced && <SidebarHiddenSettings />}
                  {advanced && !remoteActive && editConfig && <ToolCallsRow />}
                  {advanced && <RunCardRow />}
                </div>
                <DesktopMascotsCard />
              </>
            )}

            {section === "experimental" && (
              <>
                <ExperimentalFeaturesRow />
                <BrowserProfilesRow />
              </>
            )}

            {section === "engines" && (
              <>
                <EnginesSettings />
                {/* Connected apps (Composio) and Decision model (2026-10-14):
                    cards of Models and voice, shown while their experiment is on. */}
                {allowed("connectedApps") && (
                  <Card
                    collapsible
                    cardId="connections.apps"
                    title={t("settings.connections.appsTitle")}
                    summary={connectedAppsSummary(state.config)}
                  >
                    {state.config?.composio.mode === "managed" ? (
                      <div className="mb-2 rounded-lg border border-accent/25 bg-accent/10 px-3 py-2 text-[13px] text-accent-text">
                        {t("settings.connections.ready")}
                      </div>
                    ) : null}
                    <p className="mb-2 text-[13px] leading-[18px] text-ink-secondary">
                      {t("settings.connections.appsSubtitle")}{" "}
                      <a href={COMPOSIO_PLATFORM_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                        platform.composio.dev
                      </a>
                    </p>
                    <p className="mb-2 text-[12.5px] text-ink-secondary" data-connected-apps-state={state.config?.composio.mode ?? "unavailable"}>
                      {connectedAppsSummary(state.config)}
                    </p>
                    <ApiKeyRow section="composio" />
                  </Card>
                )}
                {allowed("decisionModel") && (
                  <Card collapsible cardId="engines.decisionModel" title={t("settings.section.decisionModel")}>
                    <DecisionModelSettings />
                  </Card>
                )}
              </>
            )}

            {section === "backups" && <WorkspaceBackupSettings />}

            {section === "computer" && <LocalComputerSection />}

            {section === "usage" && <UsageSection />}
            {section === "notifications" && (
              <>
                <NotificationSettings />
                {/* Privacy (2026-10-14): what other people of the organization see. */}
                {allowed("privacy") && (
                  <section data-settings-card="notifications.privacy" className="flex flex-col gap-2">
                    <h3 className="mt-2 text-[13px] font-medium text-ink">{t("settings.section.privacy")}</h3>
                    <PrivacySettings />
                  </section>
                )}
              </>
            )}
            </div>
          </div>
          )}
          {/* Hibou 98 only: the era's dialog footer. Settings save as you go,
              so OK simply closes, like the other skins' close box. */}
          {retroSkin && (
            <div className="r98-dialog-footer">
              <button type="button" className="r98-dialog-ok" onClick={() => dispatch({ type: "toggleAppSettings", open: false })}>
                {t("retro.button.ok")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
