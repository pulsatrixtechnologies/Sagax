// App settings, as a real modal with sections rather than one long panel.
// Per-bot settings (persona, model, computer) live in BotSettingsDialog: this
// is the stuff shared by every bot: who you are, your keys, and the
// machine your bots can borrow.
import { useRetroSkin } from "./RetroChromeHost";
import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Bell, CalendarDays, Check, Coins, Download, ExternalLink, FlaskConical, Monitor, Palette, Search, Terminal, User, X, Building2 } from "lucide-react";
import { api, useStore, type AppSettingsSection, type ConfigStatus } from "@/state/store";
import { connectedAppsEnabled, decisionModelEnabled } from "@/lib/feature-flags";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { localeChoices, type LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { withTourReset } from "@/lib/guided-tour";
import { completionPatch } from "@/lib/onboarding";
import { launchBridges } from "@/lib/launch";
import { servedPage } from "@/lib/desktop";
import { brand } from "@/lib/brand";
import { useServerMode } from "./ServerModeSettings";
import { ApiKeyRow, credentialCopy } from "./ApiKeys";
import { DecisionModelSettings } from "./DecisionModelSettings";
import { GeneralAdvancedSettings, generalAdvancedShown, isSoloDesktop } from "./settings/AdvancedSettings";
import { useUpdaterState } from "@/lib/updater";
import { EnginesSettings } from "./EnginesSettings";
import { LocalComputerSection } from "./LocalComputerSection";
import { peopleListServed, readMembership } from "../lib/membership";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { canEditConfig, canManageBackups, canManageComputers, viewerCan } from "@/lib/viewer";
import { OrganizationSettings } from "./OrganizationSettings";
import { CompactRow, DescribedRow, PILL, PillSelect, requestSettingsCard, SettingRow, SettingsGroup, Switch, takeRequestedSettingsCard } from "./SettingsPrimitives";
import { OrgMemorySettings } from "./OrgMemorySettings";
import { NotificationSettings } from "./NotificationSettings";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { ExperimentalSettings } from "./settings/ExperimentalSettings";
import { currentSettingsSection, isMovedOrganizationCard } from "@/lib/settings-sections";

import { shortcutLabel } from "./ShortcutHint";
import { UsageSection } from "./UsageSection";
import { LicenseExpiryBanner } from "./LicenseExpiryBanner";
import { workspacesAvailable } from "./WorkspacesSection";
import { applySkin, readSkin, visibleSkins, type SkinId } from "@/lib/skins";
import { readRetroUnlocked } from "@/lib/retro98";
import { AboutMeEditor, aboutMeFirstLine } from "./AboutMeSettings";
import { SettingsSubPage, SettingsSubPageRow } from "./SettingsSubPage";
import { AccountCard } from "./settings/AccountCard";
import { DefaultBotSettings } from "./NewBotDialog";
import { WorkspaceBackupSettings } from "./WorkspaceBackupSettings";
import { cn } from "@/lib/cn";
import { useAdvancedMode } from "@/lib/interface-mode";
import { simpleHidesSettingsSection } from "@/lib/interface-visibility";
import { effectiveLanguage, setLanguageChoice, useLanguageChoice } from "@/lib/language-preference";

// The threads choice moved with Appearance (0.5.6); old imports still work.
export { chooseThreadsView } from "./settings/AppearanceSettings";

export { GeneralAdvancedSettings, generalAdvancedShown, isSoloDesktop };

const COMPOSIO_PLATFORM_URL = "https://platform.composio.dev";

// `labelKey`, not a label: t() reads the active pack when it is called, so a
// label resolved here at module scope would freeze the language the app booted
// in. The English keywords stay untranslated: they are a search index, and a
// pack that omits them still matches what people type.
/** Search words of the cards moved from General > Advanced to Organization
 * (2026-10-15). On a desktop with no server they stay in General > Advanced,
 * and General matches them there (sectionMatches `extra`). */
export const ORGANIZATION_ADVANCED_KEYWORDS = ["routines", "conversation", "schedule", "mcp", "timeout", "group turns", "rooms"];

/** The headings of the settings nav (2026-10-16, JC): Cursor Settings and
 * Grok Bot keep a short rail in a few groups; Sagax names its groups. A
 * heading shows while one of its pages (or Automations, for AI) does. */
export type SettingsNavGroup = "you" | "ai" | "workspace" | "app";

export const NAV_GROUPS: Array<{ id: SettingsNavGroup; labelKey: LocaleKey }> = [
  { id: "you", labelKey: "settings.nav.you" },
  { id: "ai", labelKey: "settings.nav.ai" },
  { id: "workspace", labelKey: "settings.nav.workspace" },
  { id: "app", labelKey: "settings.nav.app" },
];

export const SECTIONS: Array<{
  id: AppSettingsSection;
  labelKey: LocaleKey;
  /** The nav heading it sits under (NAV_GROUPS). */
  group: SettingsNavGroup;
  icon: typeof User;
  keywords: string[];
}> = [
  // 2026-10-16: in the order of their nav groups (NAV_GROUPS), as Cursor
  // Settings groups its rail: you, AI, the workspace, this app last.
  // 0.5.6 (JC): General is laid out as Grok Bot's (Account, Appearance,
  // System); Updates is a page of its own, as there.
  { id: "general", group: "you", labelKey: "settings.section.general", icon: User, keywords: ["profile", "name", "email", "copy email", "account", "compte", "sign out", "label", "about me", "about", "suggestions", "suggested", "memory", "effort", "new bots", "reasoning", "threads", "parallel", "concurrency", "cleanup", "retention", "event log", "event-log", "log size", "automatic recovery", "backup model", "fallback", "advanced", "avancé", "tool access", "accès aux outils", "diagnostics", "diagnostic", "journaux", "nettoyage", "grants", "autorisations", "theme", "thème", "language", "langue", "microphone", "micro", "tour", "tours", "visite", "welcome", "bienvenue", "system", "système", "server", "serveur"] },
  { id: "appearance", group: "you", labelKey: "settings.section.appearance", icon: Palette, keywords: ["skin", "theme", "appearance", "advanced", "simple", "mode", "tools", "tool calls", "threads", "show threads", "hide threads", "sidebar", "hidden", "hide", "show", "density", "compact", "comfortable", "avatars", "display", "run", "this run", "run card", "commands", "mascot", "owl", "desktop", "fly", "floating", "app icon", "dock", "icon", "taskbar", "providers", "sign-in", "unconfigured", "fournisseurs", "connexion", "non configurés", "send", "enter", "return", "shift+enter", "ctrl+enter", "cmd+enter", "⌘+enter", "new line", "keyboard", "ime", "japanese", "font", "police", "interface", "inspector", "inspecteur", "logo", "masqués", "mascottes", "icône", "barre latérale", "conversations", "desktop", "bureau"] },
  // 2026-10-14: Privacy is a card of this page on an organization server.
  { id: "notifications", group: "you", labelKey: "settings.section.notifications", icon: Bell, keywords: ["notifications", "notification", "sound", "sounds", "mute", "silent", "chime", "alert", "alerts", "banner", "badge", "dock", "unread", "nudge", "wizz", "shake", "secousse", "son", "persistent", "stay", "privacy", "read receipts", "seen", "vu", "confidentialité", "accusés de lecture", "presence", "online", "away", "offline", "last seen", "status", "en ligne", "absent", "hors ligne", "privacidade", "alertes", "on screen", "à l'écran"] },
  // Models and voice (2026-10-14): Integrations and Models and accounts in
  // one page; Connected apps and Decision model are cards of it.
  { id: "engines", group: "ai", labelKey: "settings.section.modelsVoice", icon: Terminal, keywords: ["models", "model providers", "engines", "claude", "codex", "grok", "providers", "cli", "sign in", "subscription", "keys", "api", "api key", "api keys", "connections", "integrations", "intégrations", "clés", "xai", "mistral", "cerebras", "router", "openrouter", "base url", "openai", "anthropic", "groq", "opencode", "provider", "voice", "voix", "tts", "elevenlabs", "fish", "chatterbox", "live call", "image", "avatar", "box", "vps", "cursor", "cloud agents", "composio", "connected apps", "apps", "gmail", "slack", "notion", "apps connectées", "decision", "jev", "typesafe", "routing", "auto", "who answers", "auto model", "modèle auto", "moteurs", "needs setup", "à configurer", "voice engine", "moteur de voix", "fish audio", "live calls", "appels en direct", "image provider", "fournisseur d'images", "génération d'images", "cloud coding agents"] },
  // 2026-10-14: Memory is a card of this page (it was its own section).
  { id: "organization", group: "workspace", labelKey: "settings.section.organization", icon: Building2, keywords: ["company", "organization", "organisation", "sign in", "enroll", "managed", "models", "disconnect", "workspace", "cloud", "hosted", "vps", "server", "servers", "connect", "pair", "switch", "local", "memory", "obsidian", "vault", "sync", "git", "perspicax", "mémoire", "cache", "pending", "domain", "dns", "caddy", "full access", "accès complet", "approvals", "approbations", "waiting for an admin", "en attente", "people from before", "rattacher", "invite", "inviter", "invitation", "people", "personnes", "this computer", "cet ordinateur", "serveurs", "oublier", "forget", ...ORGANIZATION_ADVANCED_KEYWORDS] },
  { id: "computer", group: "workspace", labelKey: "settings.section.computer", icon: Monitor, keywords: ["computer", "local vm", "vm", "virtual", "desktop", "ordinateur", "your computer", "votre ordinateur", "other computers", "autres ordinateurs", "network", "réseau", "traffic", "trafic", "server environment", "environnement serveur", "reset", "réinitialiser", "repair", "réparer"] },
  { id: "usage", group: "workspace", labelKey: "settings.section.usage", icon: Coins, keywords: ["tokens", "cost", "billing", "plan", "forfait", "coût", "usage", "spend", "this month", "ce mois-ci", "last 30 days", "30 derniers jours", "by bot", "par bot", "by model", "par modèle", "renews", "renouvelle", "sagax business"] },
  // 2026-10-15: People and Installations are hidden in the app, like Email,
  // Activity and Pair devices (settings-sections.ts HIDDEN).
  { id: "backups", group: "workspace", labelKey: "settings.section.backups", icon: Archive, keywords: ["export", "import", "restore", "full backup", "password", "recovery", "backup", "sauvegarde", "exporter", "restaurer", "replace", "remplacer", "mot de passe"] },
  // 0.5.6: this app's updates and the pre-release channel (were in General
  // and General > Advanced). Shown where the desktop app answers.
  { id: "updates", group: "app", labelKey: "settings.updates.title", icon: Download, keywords: ["updates", "update", "version", "mise à jour", "mises à jour", "prerelease", "pre-release", "beta", "bêta", "restart"] },
  { id: "experimental", group: "app", labelKey: "settings.section.experimental", icon: FlaskConical, keywords: ["early", "preview", "learn", "skill", "authoring", "browser", "profiles", "experimental", "expérimental", "data window", "fenêtre data", "decision model", "modèle de décision", "connected apps", "apps connectées", "compétences", "navigateur", "unavailable", "indisponible"] },
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
  "organization.fullAccess": ["full access", "accès complet"],
  "connections.integrations": ["box", "vps"],
  "connections.image": ["image", "avatar", "gpt image"],
  "engines.moreProviders": ["openrouter", "mistral", "opencode", "base url", "compatible", "cursor", "cloud agent", "elevenlabs", "fish audio", "image key"],
  "engines.setup": ["needs setup", "kimi", "droid", "qwen", "hermes", "cline", "antigravity"],
  "voice.advanced": ["live call", "read replies", "hang up", "gpt-live"],
  "companion.domain": ["domain", "dns", "caddy"],
  "connections.apps": ["composio", "connected apps"],
  "engines.decisionModel": ["decision", "jev", "typesafe"],
  "connections.cloudAgents": ["cursor", "cloud agent", "cloud coding"],
  "usage.breakdown": ["by bot", "by model", "par bot", "par modèle"],
  "organization.memory": ["obsidian", "vault"],
  "backups.import": ["import", "restore", "restaurer"],
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

/** Automations' entry in the settings nav: shown unless a search excludes it. */
export function automationsMatch(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [t("sidebar.nav.automations"), "automations", "automatisations", "routines", "schedule", "calendar", "calendrier", "webhooks"].some((word) => word.toLowerCase().includes(q));
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

/** Connected apps (Composio), a group of Models and voice: its state in
 * the row's grey line, where to get a key behind the info button, the key
 * field under it. */
function ConnectedAppsGroup({ config }: { config: ConfigStatus | null | undefined }) {
  return (
    <div data-settings-card="connections.apps">
      <SettingsGroup title={t("settings.connections.appsTitle")} groupId="connectedApps">
        <DescribedRow
          label={credentialCopy("composio").label}
          rowId="composio"
          help={(
            <>
              {t("settings.connections.appsSubtitle")}{" "}
              <a href={COMPOSIO_PLATFORM_URL} target="_blank" rel="noopener noreferrer" className="text-accent-text hover:underline">platform.composio.dev</a>
            </>
          )}
          description={<span data-connected-apps-state={config?.composio.mode ?? "unavailable"}>{connectedAppsSummary(config)}</span>}
          below={<div className="mt-2"><ApiKeyRow section="composio" bare /></div>}
        >
          <a href={COMPOSIO_PLATFORM_URL} target="_blank" rel="noopener noreferrer" className={PILL}>
            platform.composio.dev
            <ExternalLink size={12} aria-hidden="true" />
          </a>
        </DescribedRow>
      </SettingsGroup>
    </div>
  );
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

/** General > System > Guided tours: the app tour (cleared and opened
 * again on the live interface) and the welcome flow, one row with two
 * buttons (0.5.6, they were two rows with a paragraph each). */
function GuidedToursRow() {
  const { state, dispatch } = useStore();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const replayAppTour = () => {
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
  };
  return (
    <>
      <CompactRow label={t("settings.tours.title")} rowId="tours">
        <button type="button" disabled={saving} onClick={replayAppTour} className="ui-button">
          {t("settings.appTour.title")}
        </button>
        <button type="button" onClick={() => dispatch({ type: "toggleWelcome", open: true })} className="ui-button">
          {t("settings.welcome.title")}
        </button>
      </CompactRow>
      {failed && <p role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{t("onboarding.tour.error")}</p>}
    </>
  );
}

/** General > System > Server: the launch screen (no server, or an
 * organization server). What the current choice means is one hover away. */
function ServerRow() {
  const { state, dispatch } = useStore();
  const launchMode = state.config?.onboarding?.launchMode ?? "solo";
  if (!launchBridges(window.ogb)) return null;
  return (
    <CompactRow label={t("settings.launch.title")} rowId="server">
      <button
        type="button"
        title={t(launchMode === "server" ? "settings.launch.server" : "settings.launch.solo")}
        onClick={() => dispatch({ type: "toggleLaunch", open: true, mode: launchMode })}
        className="ui-button"
      >
        {t("settings.launch.change")}
      </button>
    </CompactRow>
  );
}

function LanguageRow() {
  const { state } = useStore();
  // Follows the account: anyone can switch, including a chat-only teammate,
  // and nobody changes another person's screen. The server's language is
  // the default until this person picks one.
  const current = effectiveLanguage(useLanguageChoice(), state.config?.language);
  return (
    <CompactRow label={t("settings.language.title")} rowId="language">
      <PillSelect
        value={current}
        ariaLabel={t("settings.language.aria")}
        onChange={(next) => setLanguageChoice(next)}
        options={[{ value: "", label: t("settings.language.system") }, ...localeChoices.map(({ code, label }) => ({ value: code, label }))]}
      />
    </CompactRow>
  );
}

/** General > Appearance > Theme: the skin, by name. The miniatures stay in
 * Appearance (2026-10-14 picker); this is the one-line choice Grok Bot has. */
function ThemeRow() {
  const [active, setActive] = useState<SkinId>(() => (document.documentElement.dataset.skin as SkinId) || readSkin());
  const [skins] = useState(() => visibleSkins(readRetroUnlocked(), active));
  return (
    <CompactRow label={t("settings.theme.title")} rowId="theme">
      <PillSelect
        value={active}
        ariaLabel={t("settings.theme.title")}
        onChange={(next) => {
          applySkin(next);
          setActive(next);
        }}
        options={skins.map((skin) => ({ value: skin.id, label: skin.name }))}
      />
    </CompactRow>
  );
}

type MicStatus = "granted" | "denied" | "restricted" | "not-determined" | string;

/** General > System > Microphone: the desktop app's own permission, as the
 * welcome flow asks it (PermissionsBeat). Desktop only. */
function MicrophoneRow() {
  const status = window.ogb?.permStatus;
  const [mic, setMic] = useState<MicStatus | null>(null);
  useEffect(() => {
    if (!status) return;
    let live = true;
    const read = () => status().then((perms) => { if (live) setMic(perms?.mic ?? null); }).catch(() => {});
    read();
    // Back from System Settings: read it again.
    window.addEventListener("focus", read);
    return () => { live = false; window.removeEventListener("focus", read); };
  }, [status]);
  if (!status) return null;
  const granted = mic === "granted";
  const denied = mic === "denied" || mic === "restricted";
  return (
    <CompactRow label={t("settings.microphone.title")} rowId="microphone">
      {mic === null ? null : granted ? (
        <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-secondary" data-mic-status="granted">
          <Check size={14} aria-hidden="true" className="text-success" />
          {t("settings.microphone.allowed")}
        </span>
      ) : denied ? (
        <button type="button" onClick={() => void window.ogb?.permOpenSettings?.("mic")} className="ui-button" data-mic-status="denied">
          {t("onboarding.perms.openSettings")}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void window.ogb?.permRequestMic?.().then(() => status().then((perms) => setMic(perms?.mic ?? null))).catch(() => {})}
          className="ui-button"
          data-mic-status="ask"
        >
          {t("onboarding.perms.enable")}
        </button>
      )}
    </CompactRow>
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
    remoteActive && current !== "appearance" && current !== "organization" && current !== "notifications" && current !== "updates"
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
    if (remoteActive && !["appearance", "organization", "privacy", "notifications", "memory", "updates"].includes(id)) return false;
    // this app's own updates: where the desktop app answers
    if (id === "updates" && !window.ogb?.updater) return false;
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
          {/* 2026-10-16 (JC): the rail in headed groups, as Cursor Settings
              groups its own (you, AI, the workspace, this app last). A
              heading shows while one of its entries does, a search too. */}
          {NAV_GROUPS.map((group) => {
            const entries = visibleSections.filter((entry) => entry.group === group.id);
            // Automations left the avatar menu for here (JC, 2026-10-16): a
            // link to its own page, not a section of Settings, under AI.
            const automations = group.id === "ai" && !remoteActive && automationsMatch(query);
            if (entries.length === 0 && !automations) return null;
            const headingId = `app-settings-nav-${group.id}`;
            return (
              <div key={group.id} role="group" aria-labelledby={headingId} data-settings-nav-group={group.id} className="flex shrink-0 flex-col gap-0.5">
                <div id={headingId} className="px-[9px] pb-1 pt-3 text-[11.5px] font-medium leading-4 text-ink-tertiary">
                  {t(group.labelKey)}
                </div>
                {entries.map(({ id, labelKey, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: id })}
                    aria-current={section === id ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-left text-[13px] leading-[18px] text-ink transition-colors motion-reduce:transition-none",
                      section === id ? "bg-selected" : "hover:bg-hover",
                    )}
                  >
                    {/* Grok Bot's nav item (198px rail, 7/9px padding, 9px gap,
                        8px corners, 15px icon) with its thinner glyph stroke */}
                    <Icon size={15} strokeWidth={1.5} className="shrink-0" />
                    {t(labelKey)}
                  </button>
                ))}
                {automations && (
                  <button
                    type="button"
                    data-settings-automations
                    onClick={() => {
                      dispatch({ type: "toggleAppSettings", open: false });
                      dispatch({ type: "showRoutines" });
                    }}
                    className="flex items-center gap-[9px] rounded-lg px-[9px] py-[7px] text-left text-[13px] leading-[18px] text-ink transition-colors hover:bg-hover motion-reduce:transition-none"
                  >
                    <CalendarDays size={15} strokeWidth={1.5} className="shrink-0" />
                    {t("sidebar.nav.automations")}
                  </button>
                )}
              </div>
            );
          })}
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
              {NAV_GROUPS.map((group) => {
                const entries = availableSections.filter((entry) => entry.group === group.id);
                return entries.length === 0 ? null : (
                  <optgroup key={group.id} label={t(group.labelKey)}>
                    {entries.map(({ id, labelKey }) => (
                      <option key={id} value={id}>{t(labelKey)}</option>
                    ))}
                  </optgroup>
                );
              })}
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
            {/* 0.5.6 (JC): Grok Bot's layout (OrganizationSettings): grey
                headings over cards of rows. Memory and, from General >
                Advanced (2026-10-15), routines in the conversation, group
                turns and MCP calls are rows of its groups. */}
            {section === "organization" && (
              allowed("organization")
                ? <OrganizationSettings advanced={advanced} memoryShown={memoryShown} />
                : memoryShown && (
                  <SettingsGroup title={t("settings.thisComputer.title")} groupId="thisComputer">
                    <OrgMemorySettings />
                  </SettingsGroup>
                )
            )}
            {section === "general" && (
              <>
                {/* 0.5.6 (JC): Grok Bot's General. Grey headings outside
                    the cards, compact rows: label at the left, control at
                    the right, no help text. */}
                <SettingsGroup title={t("settings.group.account")} groupId="account">
                  {/* 2026-10-15: one account row (who, label, Sign out) */}
                  <AccountCard lockedServer={lockedServer} />
                  {(!state.config?.viewer || state.config.viewer.operator) && (
                    <SettingsSubPageRow
                      bare
                      cardId="general.aboutMe"
                      title={t("settings.profile.aboutMe")}
                      summary={aboutMeFirstLine(state.config?.profile?.aboutMe)}
                      actionLabel={t("settings.aboutMe.edit")}
                      onOpen={() => openSubPage("general.aboutMe")}
                    />
                  )}
                </SettingsGroup>
                <SettingsGroup title={t("settings.group.appearance")} groupId="appearance">
                  <ThemeRow />
                  <LanguageRow />
                </SettingsGroup>
                <SettingsGroup title={t("settings.group.system")} groupId="system">
                  <MicrophoneRow />
                  {!remoteActive && <GuidedToursRow />}
                  {!remoteActive && <ServerRow />}
                  {advanced && editConfig && <DefaultBotSettings />}
                  {/* General > Advanced: people's tool access, conversation
                      cleanup and diagnostics on one sub-page (tool access,
                      parallel conversations and recovery are each bot's own
                      since #546; routines, group turns and MCP calls went to
                      Organization; pre-releases to Updates). Shown when it
                      holds something for this viewer. A search that names
                      one of them shows them here. */}
                  {advanced && !q && generalAdvancedShown(state.config) && (
                    <SettingsSubPageRow
                      bare
                      cardId="general.advanced"
                      title={t("settings.advancedPage.title")}
                      summary={editConfig ? t("settings.advancedPage.summary") : t("settings.diagnostics.title")}
                      actionLabel={t("settings.advancedPage.open")}
                      onOpen={() => openSubPage("general.advanced")}
                    />
                  )}
                </SettingsGroup>
                {advanced && q && generalAdvancedShown(state.config) && <GeneralAdvancedSettings />}
              </>
            )}

            {section === "updates" && (
              <div data-settings-card="updates">
                {/* 2026-10-16: a titled card, as every other page's */}
                <SettingsGroup title={t("settings.updates.group")} groupId="updates">
                  <UpdatesRow />
                  <PrereleaseRow />
                </SettingsGroup>
              </div>
            )}

            {section === "appearance" && <AppearanceSettings />}

            {section === "experimental" && <ExperimentalSettings />}

            {section === "engines" && (
              <div className="flex min-w-0 flex-col gap-6">
                <EnginesSettings />
                {/* Connected apps (Composio) and Decision model (2026-10-14):
                    groups of Models and voice, shown while their experiment is on. */}
                {allowed("connectedApps") && <ConnectedAppsGroup config={state.config} />}
                {allowed("decisionModel") && <DecisionModelSettings />}
              </div>
            )}

            {section === "backups" && <WorkspaceBackupSettings />}

            {section === "computer" && <LocalComputerSection />}

            {section === "usage" && <UsageSection />}
            {/* Privacy (2026-10-14): a group of Notifications on an organization server. */}
            {section === "notifications" && <NotificationSettings privacy={allowed("privacy")} />}
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
