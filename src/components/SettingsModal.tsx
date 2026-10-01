// App settings, as a real modal with sections rather than one long panel.
// Per-bot settings (persona, model, computer) live in BotSettingsDialog — this
// is the stuff shared by every bot: who you are, your keys, and the
// machine your bots can borrow.
import { useRetroSkin } from "./RetroChromeHost";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { FLOATING_LIVELINESS, floatingBotPrefs, setFloatingFlyAway, setFloatingLiveliness, subscribeFloatingBots, type FloatingLiveliness } from "@/lib/floating-bots";
import { Archive, Coins, FlaskConical, KeyRound, Mail, Monitor, Palette, ScrollText, Search, TabletSmartphone, Terminal, User, Users, X, Building2 } from "lucide-react";
import { api, useStore, type AppSettingsSection, type ConfigStatus } from "@/state/store";
import { analyticsEnabled, setAnalyticsEnabled } from "@/lib/analytics";
import { browserAvailable, browserUnavailableReason, builtInBrowserEnabled, routinesInConversationEnabled, showToolCallsEnabled, skillAuthoringEnabled } from "@/lib/feature-flags";
import { localeChoices, type LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import { withTourReset } from "@/lib/guided-tour";
import { completionPatch } from "@/lib/onboarding";
import { launchBridges } from "@/lib/launch";
import { ApiKeyRow, OpenAiCompatUrl, VpsConnection } from "./ApiKeys";
import { COMPOSIO_PLATFORM_URL } from "./ConnectedAppsSetup";
import { useUpdaterState } from "@/lib/updater";
import { EnginesSettings } from "./EnginesSettings";
import { LocalComputerSection } from "./LocalComputerSection";
import { CompanionSection } from "./CompanionSection";
import { ServerPairingCard } from "./ServerPairingCard";
import { PeopleSection } from "./PeopleSection";
import { peopleListServed, readMembership } from "../lib/membership";
import { ActivitySection } from "./ActivitySection";
import { MailSettings } from "./MailSettings";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { BrowserProfilesManager } from "./BrowserProfilesManager";
import { ThisComputerSettings } from "./DesktopWorkspaceSwitcher";
import { OrganizationSettings } from "./OrganizationSettings";
import { CloudAccountSettings } from "./CloudAccountSettings";
import { Card, SettingRow, Switch, requestSettingsCard, cardCount } from "./SettingsPrimitives";
import { effortLabel } from "./ModelPicker";
import { EFFORT_LEVELS, isEffortLevel } from "../../shared/wire";
import { shortcutLabel } from "./ShortcutHint";
import { UsageSection } from "./UsageSection";
import { LicenseExpiryBanner } from "./LicenseExpiryBanner";
import { WorkspacesSection, workspacesAvailable } from "./WorkspacesSection";
import { SkinPicker } from "./SkinPicker";
import { SKINS, readSkin } from "@/lib/skins";
import { FONT_IDS, applyFont, readFont, type FontId } from "@/lib/fonts";
import { loadSidebarDensity, saveSidebarDensity, subscribeSidebarDensity, type SidebarDensity } from "@/lib/sidebar-preferences";
import { RoomTurnTimeoutSettings } from "./RoomTurnTimeoutSettings";
import { AboutMeSettings } from "./AboutMeSettings";
import { InitialsAvatar } from "./Avatar";
import { profileInitials, profileLabel } from "./SidebarProfileMenu";
import { ThreadConcurrencySettings } from "./ThreadConcurrencySettings";
import { AutomaticRecoverySettings } from "./AutomaticRecoverySettings";
import { ThreadCleanupSettings } from "./ThreadCleanupSettings";
import { DefaultBotSettings } from "./NewBotDialog";
import { WorkspaceBackupSettings } from "./WorkspaceBackupSettings";
import { CompanyBackupSettings } from "./CompanyBackupSettings";
import { cn } from "@/lib/cn";
import { setNotificationSounds, useNotificationSounds } from "@/lib/notification-preferences";
import { setShowThreads, useShowThreads } from "@/lib/thread-preferences";
import { effectiveLanguage, setLanguageChoice, useLanguageChoice } from "@/lib/language-preference";

// `labelKey`, not a label: t() reads the active pack when it is called, so a
// label resolved here at module scope would freeze the language the app booted
// in. The English keywords stay untranslated — they are a search index, and a
// pack that omits them still matches what people type.
const SECTIONS: Array<{
  id: AppSettingsSection;
  labelKey: LocaleKey;
  icon: typeof User;
  keywords: string[];
}> = [
  { id: "general", labelKey: "settings.section.general", icon: User, keywords: ["profile", "name", "email", "about me", "about", "suggestions", "suggested", "memory", "analytics", "updates", "effort", "new bots", "reasoning", "threads", "parallel", "concurrency", "cleanup", "retention", "event log", "event-log", "log size", "automatic recovery", "backup model", "fallback", "routines", "conversation", "schedule"] },
  { id: "organization", labelKey: "settings.section.organization", icon: Building2, keywords: ["company", "organization", "organisation", "sign in", "enroll", "managed", "models", "disconnect", "workspace", "cloud", "hosted", "vps", "server", "servers", "connect", "pair", "switch", "local"] },
  { id: "cloudAccount", labelKey: "settings.section.cloudAccount", icon: User, keywords: ["cloud", "account", "personal", "sign in", "pro", "subscription", "billing"] },
  { id: "appearance", labelKey: "settings.section.appearance", icon: Palette, keywords: ["skin", "theme", "appearance", "tools", "tool calls", "threads", "show threads", "hide threads", "sidebar", "display", "notifications", "sound", "sounds", "mute", "silent", "chime", "mascot", "owl", "desktop", "fly", "floating"] },
  { id: "experimental", labelKey: "settings.section.experimental", icon: FlaskConical, keywords: ["early", "preview", "learn", "skill", "authoring", "browser", "profiles"] },
  { id: "connections", labelKey: "settings.section.connections", icon: KeyRound, keywords: ["keys", "api", "composio", "box", "xai", "mistral", "vps"] },
  { id: "engines", labelKey: "settings.section.engines", icon: Terminal, keywords: ["models", "claude", "grok", "providers", "cli"] },
  { id: "companion", labelKey: "settings.section.companion", icon: TabletSmartphone, keywords: ["companion", "device", "phone", "desktop", "client", "host", "pair", "pairing", "mobile", "https", "secure", "tailscale", "wifi", "remote", "advanced", "domain", "dns", "self-hosted", "server", "caddy"] },
  { id: "computer", labelKey: "settings.section.computer", icon: Monitor, keywords: ["vm", "virtual", "desktop"] },
  { id: "usage", labelKey: "settings.section.usage", icon: Coins, keywords: ["tokens", "cost", "billing"] },
  { id: "people", labelKey: "settings.section.people", icon: Users, keywords: ["people", "users", "invite", "sign in", "members", "admins", "access"] },
  { id: "mail", labelKey: "settings.section.mail", icon: Mail, keywords: ["email", "mail", "courriel", "smtp", "sendgrid", "twilio", "sender", "invitations", "sign-in codes"] },
  { id: "activity", labelKey: "settings.section.activity", icon: ScrollText, keywords: ["activity", "audit", "log", "history", "who changed", "approvals", "decisions", "admin"] },
  { id: "backups", labelKey: "settings.section.backups", icon: Archive, keywords: ["export", "import", "restore", "full backup", "password", "recovery"] },
  { id: "workspaces", labelKey: "settings.section.workspaces", icon: Building2, keywords: ["clients", "tenants", "fleet", "workspaces", "installation", "installations"] },
];

/** Collapsible cards a search opens: a match on these words means the person
 * is looking for what the card holds, so it should not stay folded. */
const CARD_KEYWORDS: Record<string, string[]> = {
  "general.aboutMe": ["about me"],
  "general.threads": ["parallel", "concurrency"],
  "general.threadCleanup": ["cleanup", "retention", "event log", "event-log", "log size"],
  "general.recovery": ["automatic recovery", "backup model", "fallback"],
  "connections.apps": ["composio"],
  "connections.integrations": ["box", "vps"],
  "companion.domain": ["domain", "dns", "caddy"],
  "backups.import": ["import", "restore"],
};

export function cardsMatching(query: string): string[] {
  if (query.length < 3) return [];
  return Object.entries(CARD_KEYWORDS)
    .filter(([, words]) => words.some((word) => word.includes(query)))
    .map(([id]) => id);
}

function sectionMatches(section: (typeof SECTIONS)[number], query: string): boolean {
  if (!query) return true;
  return [t(section.labelKey), ...section.keywords].some((part) => part.toLowerCase().includes(query));
}

function profilePhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the image"));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not read the image"));
      image.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Could not read the image"));
          return;
        }
        const scale = Math.max(size / image.width, size / image.height);
        const width = image.width * scale;
        const height = image.height * scale;
        ctx.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

/** Name, email, and photo. Shared context has its own autosave. Someone
 * signed in to another person's server sees who they are signed in as: the
 * editable profile is the operator's, and saving it would overwrite theirs. */
function ProfileFields() {
  const { state } = useStore();
  const viewer = state.config?.viewer;
  if (viewer && !viewer.operator) return <SignedInIdentity name={viewer.name} email={viewer.email} />;
  return <OperatorProfileFields />;
}

function SignedInIdentity({ name, email }: { name: string; email: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[14px] border-[0.5px] border-border px-3.5 py-2.5">
      <InitialsAvatar initials={profileInitials({ name, email })} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-ink">{profileLabel({ name, email })}</div>
        {email && <div className="mt-0.5 truncate text-[13px] text-ink-secondary">{email}</div>}
        <div className="mt-0.5 text-[12px] text-ink-secondary">{t("settings.profile.signedInAs")}</div>
      </div>
    </div>
  );
}

function OperatorProfileFields() {
  const { state, dispatch } = useStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(state.config?.profile?.name ?? "");
  const [email, setEmail] = useState(state.config?.profile?.email ?? "");
  const [avatarUrl, setAvatarUrl] = useState(state.config?.profile?.avatarUrl ?? "");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setName(state.config?.profile?.name ?? "");
    setEmail(state.config?.profile?.email ?? "");
    setAvatarUrl(state.config?.profile?.avatarUrl ?? "");
  }, [state.config?.profile?.name, state.config?.profile?.email, state.config?.profile?.avatarUrl]);

  const save = (next: { name?: string; email?: string; avatarUrl?: string } = {}) => {
    const profile = {
      name: (next.name ?? name).trim(),
      email: (next.email ?? email).trim().toLowerCase(),
      avatarUrl: next.avatarUrl ?? avatarUrl,
    };
    void fetch("/api/config", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profile }),
    })
      .then((r) => { if (!r.ok) throw new Error("Profile save failed"); return r.json(); })
      .then((config: ConfigStatus) => {
        if (config.profile) dispatch({ type: "profileSaved", profile: config.profile });
      })
      .catch(() => {});
  };

  const choosePhoto = (file: File | undefined) => {
    if (!file) return;
    void profilePhoto(file).then((url) => {
      setAvatarUrl(url);
      save({ avatarUrl: url });
    }).catch(() => {});
  };

  const initials = (name.trim() || email.trim() || "?").slice(0, 1).toUpperCase();
  return (
    <div className="flex items-center gap-3">
        <div className="relative">
          <button
            type="button"
            aria-label="Change avatar"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="flex size-9 items-center justify-center overflow-hidden rounded-full bg-raised text-[13px] font-semibold text-ink"
          >
            {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" /> : initials}
          </button>
          {menuOpen && (
            <div className="absolute left-0 top-full z-10 mt-2 flex min-w-[200px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border bg-elevated p-1.5 text-[13px] leading-[18px]">
              <button type="button" onClick={() => { setMenuOpen(false); fileRef.current?.click(); }} className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover">Upload photo</button>
              {avatarUrl && <button type="button" onClick={() => { setAvatarUrl(""); setMenuOpen(false); save({ avatarUrl: "" }); }} className="block w-full rounded-md px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink hover:bg-hover">Remove photo</button>}
            </div>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Upload avatar" onChange={(event) => { choosePhoto(event.target.files?.[0]); event.target.value = ""; }} />
        </div>
        <div className="min-w-0 flex-1">
          <input aria-label={t("settings.profile.name")} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save()} placeholder={t("settings.profile.name")} className="w-full bg-transparent text-[14px] font-semibold text-ink placeholder:text-ink-secondary focus:outline-none" />
          <input type="email" aria-label={t("phone.signIn.email")} value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => save()} placeholder="you@example.com" className="mt-0.5 w-full bg-transparent text-[13px] text-ink-secondary placeholder:text-ink-secondary focus:outline-none" />
        </div>
    </div>
  );
}

type ConnectionKey = "anthropic" | "openaiCompat" | "xai" | "mistral" | "composio" | "box" | "vps" | "opencodeGo";

/** "Set" / "Not set" for one connection, "2 of 4 set" for a group. Reads
 * only the configured flags the server returns; never a secret. */
export function configuredSummary(config: ConfigStatus | null | undefined, keys: ConnectionKey[]): string {
  const set = keys.filter((key) => Boolean((config?.[key] as { configured?: boolean } | undefined)?.configured)).length;
  if (keys.length === 1) return set ? t("settings.card.set") : t("settings.card.notSet");
  return t("settings.card.countSet", { count: set, total: keys.length });
}

/** "3 lines" or "Not set": enough to know whether About me needs a look. */
export function aboutMeSummary(aboutMe: string | undefined): string {
  const lines = (aboutMe ?? "").split("\n").filter((line) => line.trim()).length;
  if (!lines) return t("settings.card.notSet");
  return lines === 1 ? t("settings.card.lineOne") : t("settings.card.lineMany", { count: lines });
}

function UpdatesRow() {
  const s = useUpdaterState();
  if (!window.ogb?.updater) return null;
  const updater = window.ogb.updater;
  const label =
    s?.status === "checking"
      ? t("settings.updates.checking")
      : s?.status === "available"
        ? t("settings.updates.available", { version: s.version ?? "" })
        : s?.status === "downloading"
          ? s.percent == null
            ? t("settings.updates.startingDownload")
            : t("settings.updates.downloading", { percent: Math.round(s.percent) })
          : s?.status === "preparing"
            ? t("settings.updates.preparing")
            : s?.status === "downloaded"
              ? s.installMode === "handoff"
                ? t("settings.updates.readyInstall", { version: s.version ?? "" })
                : t("settings.updates.ready", { version: s.version ?? "" })
              : s?.status === "installing"
                ? s.message ||
                  (s.installMode === "handoff"
                    ? t("settings.updates.openingTerminal")
                    : t("settings.updates.restarting"))
                : s?.status === "handed-off"
                  ? t("settings.updates.handedOff")
                  : s?.status === "error"
                    ? t("settings.updates.failed", { message: s.message ?? t("settings.updates.unknownError") })
                    : t("settings.updates.latest");
  return (
    <SettingRow title={t("settings.updates.title")} subtitle={label}>
      <button
        onClick={() => {
          if (s?.status === "available") return void updater.download();
          if (s?.status === "downloaded") return void updater.install();
          void updater.check();
        }}
        disabled={
          s?.status === "checking" || s?.status === "downloading" || s?.status === "preparing" ||
          s?.status === "installing" || s?.retryable === false
        }
        className="ui-button"
      >
        {s?.retryable === false
          ? t("settings.updates.quitReopen")
          : s?.status === "available"
            ? t("settings.updates.download")
            : s?.status === "downloaded"
              ? s.installMode === "handoff"
                ? t("settings.updates.install")
                : t("settings.updates.restart")
              : s?.status === "preparing"
                ? t("settings.updates.preparingShort")
                : s?.status === "installing"
                  ? s.installMode === "handoff"
                    ? t("settings.updates.opening")
                    : t("settings.updates.restartingShort")
                  : t("settings.updates.check")}
      </button>
    </SettingRow>
  );
}

/** Usage analytics, on by default and switchable here. Naming what is sent
 * matters more than the switch: people who cannot see the scope assume the
 * worst, and the worst — conversation text — is exactly what this never
 * sends (autocapture is off; see lib/analytics.ts). */
/** The effort every new bot starts with. The server skips a level the new
 * bot's engine does not offer, and a bot's own choice always wins. */
function NewBotEffortRow() {
  const { state, dispatch } = useStore();
  const current = state.config?.newBots?.effort ?? "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async (value: string) => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ newBots: { effort: isEffortLevel(value) ? value : null } }),
      });
      dispatch({ type: "configStatus", config });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.newBotEffort.error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingRow
      title={t("settings.newBotEffort.title")}
      subtitle={t("settings.newBotEffort.short")}
      help={t("settings.newBotEffort.subtitle")}
      message={error ? <p role="alert" className="text-danger">{error}</p> : null}
    >
      <select
        value={current}
        disabled={saving}
        aria-label={t("settings.newBotEffort.aria")}
        onChange={(event) => void save(event.target.value)}
        className="w-full max-w-[240px] rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none disabled:cursor-wait disabled:opacity-50"
      >
        <option value="">{t("settings.newBotEffort.default")}</option>
        {EFFORT_LEVELS.map((level) => (
          <option key={level} value={level}>
            {effortLabel(level)}
          </option>
        ))}
      </select>
    </SettingRow>
  );
}

function AnalyticsRow() {
  const [on, setOn] = useState(analyticsEnabled);
  return (
    <SettingRow title={t("settings.analytics.title")} subtitle={t("settings.analytics.short")} help={t("settings.analytics.subtitle")}>
      <Switch
        checked={on}
        aria-label={t("settings.analytics.aria")}
        onClick={() => {
          const next = !on;
          setAnalyticsEnabled(next);
          setOn(next);
        }}
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
  // Saved on this device only: anyone can switch, including a chat-only
  // teammate, and nobody changes another person's screen. The server's
  // language is the default until this device picks one.
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

function NotificationSoundsRow() {
  const enabled = useNotificationSounds();
  return (
    <SettingRow title={t("settings.notificationSounds.title")} subtitle={t("settings.notificationSounds.short")} help={t("settings.notificationSounds.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.notificationSounds.play")}
        onClick={() => setNotificationSounds(!enabled)}
      />
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

function SidebarDensityRow() {
  const density = useSyncExternalStore(subscribeSidebarDensity, loadSidebarDensity, () => "comfortable" as const);
  const choose = (next: SidebarDensity) => saveSidebarDensity(next);
  return (
    <SettingRow title={t("sidebar.density.title")} subtitle={t("sidebar.density.chooseAria")}>
      <select
        aria-label={t("sidebar.density.chooseAria")}
        value={density}
        onChange={(event) => choose(event.target.value as SidebarDensity)}
        className="rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink focus:border-border-strong focus:outline-none"
      >
        <option value="comfortable">{t("sidebar.density.comfortable")}</option>
        <option value="compact">{t("sidebar.density.compact")}</option>
        <option value="icons">{t("sidebar.density.iconsOnly")}</option>
      </select>
    </SettingRow>
  );
}

function ShowThreadsRow() {
  const enabled = useShowThreads();
  return (
    <SettingRow title={t("settings.threadDisplay.title")} subtitle={t("settings.threadDisplay.short")} help={t("settings.threadDisplay.subtitle")}>
      <Switch
        checked={enabled}
        aria-label={t("settings.threadDisplay.show")}
        onClick={() => setShowThreads(!enabled)}
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

function ExperimentalFeaturesRow() {
  const { state, dispatch } = useStore();
  const skillAuthoring = skillAuthoringEnabled(state.config);
  const browser = builtInBrowserEnabled(state.config);
  const desktopBrowser = browserAvailable(state.config);
  const browserInstallable = state.config?.browserEngine?.installable === true;
  const browserBlockedOnWindows = window.ogb?.platform === "win32" && !desktopBrowser && !browserInstallable;
  const [saving, setSaving] = useState<"skillAuthoring" | "browser" | null>(null);
  const [error, setError] = useState("");

  const toggle = async (feature: "skillAuthoring" | "browser", next: boolean) => {
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
      summary={t("settings.card.countOn", { count: Number(skillAuthoring) + Number(browser), total: 2 })}
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
                : browserUnavailableReason(state.config)}
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
 * report holds versions, configured-or-not booleans and the server.log tail —
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

export function SettingsModal() {
  const { state, dispatch } = useStore();
  const retroSkin = useRetroSkin();
  const remoteActive = window.ogb?.remoteClient?.active === true;
  const section: AppSettingsSection =
    (remoteActive && !["appearance", "organization"].includes(state.appSettingsSection)) || state.appSettingsSection === "remote"
      ? "companion"
      : state.appSettingsSection;
  const dialogRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  useEffect(() => window.ogb?.environments?.onOpenSettings?.(() => setQuery("")), []);
  useEffect(() => window.ogb?.onOpenAppSettings?.(() => setQuery("")), []);
  const q = query.trim().toLowerCase();
  const ownerOrAdmin = useOwnerOrAdmin();
  const soloDesktop = !remoteActive && Boolean(launchBridges(window.ogb)) && state.config?.onboarding?.launchMode !== "server";
  // A request for Settings > Organization (the Server menu, a deep link) on
  // a desktop with no server opens the launch screen on Server instead.
  useEffect(() => {
    if (!soloDesktop || state.appSettingsSection !== "organization") return;
    dispatch({ type: "toggleAppSettings", open: false, section: "general" });
    dispatch({ type: "toggleLaunch", open: true, mode: "server" });
  }, [soloDesktop, state.appSettingsSection, dispatch]);
  const availableSections = SECTIONS.filter((entry) => !remoteActive || entry.id === "companion" || entry.id === "appearance" || entry.id === "organization")
    // the desktop app in "No server" mode has no organization to show; it
    // joins one from General > Server, which brings this section back
    .filter((entry) => entry.id !== "organization" || !soloDesktop)
    .filter((entry) => entry.id !== "cloudAccount" || Boolean(window.ogb?.cloudAccount))
    // the operator's screen for other workspaces exists only where a fleet agent does
    .filter((entry) => entry.id !== "workspaces" || workspacesAvailable(state.config))
    // sign-in by email is a served solo server's (the desktop app pairs
    // devices under Remote access), or the read-only view of a hosted
    // workspace whose members the organisation's Admin decides. An
    // organization server sends no sign-in list: Perspicax owns its people.
    .filter((entry) => entry.id !== "people" || (!window.ogb && (readMembership(state.config).authority === "portal" || peopleListServed(state.config))))
    // how the server sends sign-in codes and invitations: its admins and
    // the operator, on the desktop and on the web
    .filter((entry) => entry.id !== "mail" || ownerOrAdmin === true)
    // the activity log belongs to a workspace served to a browser, and to its admins
    .filter((entry) => entry.id !== "activity" || (!window.ogb && ownerOrAdmin === true));
  const visibleSections = availableSections.filter((entry) => sectionMatches(entry, q));
  const sectionLabelKey = SECTIONS.find((entry) => entry.id === section)?.labelKey;
  const nextVisibleSection = visibleSections.some((entry) => entry.id === section) ? undefined : visibleSections[0]?.id;

  useEffect(() => {
    for (const id of cardsMatching(q)) requestSettingsCard(id);
  }, [q]);

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

          <div className="flex flex-1 flex-col overflow-y-auto">
            <h2 className="hidden px-8 pb-1 pt-6 text-[17px] font-semibold leading-6 tracking-[-0.008em] text-ink sm:block">
              {sectionLabelKey ? t(sectionLabelKey) : null}
            </h2>
            <div className="flex flex-col gap-3 px-4 pb-6 pt-4 sm:px-8">
            <LicenseExpiryBanner config={state.config} />
            {section === "organization" && <OrganizationSettings />}
            {section === "cloudAccount" && window.ogb?.cloudAccount && !remoteActive && <CloudAccountSettings />}
            {section === "general" && (
              <>
                <ThisComputerSettings />
                <Card
                  collapsible
                  cardId="general.profile"
                  title={t("settings.profile.title")}
                  summary={state.config?.profile?.name || state.config?.profile?.email || t("settings.card.notSet")}
                >
                  <ProfileFields />
                </Card>
                <Card
                  collapsible
                  cardId="general.aboutMe"
                  defaultOpen={false}
                  title={t("settings.profile.aboutMe")}
                  subtitle={t("settings.profile.aboutMeHelp")}
                  summary={aboutMeSummary(state.config?.profile?.aboutMe)}
                >
                  <AboutMeSettings inCard />
                </Card>
                <div className="rounded-[14px] border-[0.5px] border-border py-1">
                  <LanguageRow />
                  <NewBotEffortRow />
                  <AnalyticsRow />
                  <DefaultBotSettings />
                </div>
                {!remoteActive && (
                  <div className="rounded-[14px] border-[0.5px] border-border py-1">
                    <RoutinesInConversationRow />
                  </div>
                )}
                <Card
                  collapsible
                  cardId="general.roomTurns"
                  defaultOpen={false}
                  title={t("settings.roomTurns.title")}
                  subtitle={t("settings.roomTurns.subtitle")}
                  summary={t("settings.card.roomTurns", { minutes: state.config?.rooms.turnTimeoutMinutes ?? 5 })}
                >
                  <RoomTurnTimeoutSettings />
                </Card>
                <ThreadConcurrencySettings />
                <AutomaticRecoverySettings />
                <ThreadCleanupSettings />
                <div className="rounded-[14px] border-[0.5px] border-border py-1">
                  {!remoteActive && <ReplayTourRow />}
                  <UpdatesRow />
                  <DiagnosticsRow />
                </div>
              </>
            )}

            {section === "appearance" && (
              <>
                <Card
                  collapsible
                  cardId="appearance.skin"
                  title={t("settings.skin.title")}
                  subtitle={t("settings.skin.subtitle")}
                  summary={<CurrentSkinName />}
                >
                  <SkinPicker />
                </Card>
                <div className="rounded-[14px] border-[0.5px] border-border py-1">
                  <FontRow />
                  <SidebarDensityRow />
                  <ShowThreadsRow />
                  <NotificationSoundsRow />
                  <FloatingFlyAwayRow />
                  <FloatingLivelinessRow />
                  {!remoteActive && <ToolCallsRow />}
                </div>
              </>
            )}

            {section === "experimental" && (
              <>
                <ExperimentalFeaturesRow />
                <BrowserProfilesRow />
              </>
            )}

            {section === "connections" && (
              <>
                <p className="text-[13px] leading-[18px] text-ink-secondary">{t("settings.connections.subtitle")}</p>
                {state.config?.composio.mode === "managed" ? (
                  <div className="rounded-lg border border-success/25 bg-success/10 px-3 py-2 text-[13px] text-success">
                    {t("settings.connections.ready")}
                  </div>
                ) : null}
                <Card
                  collapsible
                  cardId="connections.providers"
                  title={t("keys.providers.title")}
                  subtitle={t("keys.providers.subtitle")}
                  summary={configuredSummary(state.config, ["anthropic", "openaiCompat", "xai", "mistral"])}
                >
                  <div className="flex flex-col gap-4">
                    <ApiKeyRow section="anthropic" testProvider="anthropic" />
                    <ApiKeyRow section="openaiCompat" testProvider="openaiCompat" />
                    <OpenAiCompatUrl />
                    <ApiKeyRow section="xai" testProvider="xai" />
                    <ApiKeyRow section="mistral" testProvider="mistral" />
                  </div>
                </Card>
                <Card
                  collapsible
                  cardId="connections.apps"
                  defaultOpen={false}
                  title={t("settings.connections.appsTitle")}
                  subtitle={<>
                    {t("settings.connections.appsSubtitle")}{" "}
                    <a href={COMPOSIO_PLATFORM_URL} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                      platform.composio.dev
                    </a>
                  </>}
                  summary={configuredSummary(state.config, ["composio"])}
                >
                  <ApiKeyRow section="composio" />
                </Card>
                <Card
                  collapsible
                  cardId="connections.integrations"
                  defaultOpen={false}
                  title={t("keys.integrations.title")}
                  summary={configuredSummary(state.config, ["box", "vps", "opencodeGo"])}
                >
                  <div className="flex flex-col gap-4">
                    <ApiKeyRow section="box" />
                    <VpsConnection />
                    <ApiKeyRow section="opencodeGo" />
                  </div>
                </Card>
              </>
            )}

            {section === "engines" && (
              <EnginesSettings />
            )}

            {section === "backups" && <><WorkspaceBackupSettings /><CompanyBackupSettings /></>}

            {section === "companion" && (
              <>
                <p className="text-[13px] leading-relaxed text-ink-secondary">{t("settings.companion.ownDevices")}</p>
                {/* mints an admin/client session token for anything that isn't the phone companion
                    flow (MCP clients, `openmausbot pair`, a second desktop app), and pairs phones to a
                    hosted server. Shown for the desktop app's own server (#950) AND when this desktop is
                    a remote client of a hosted workspace: its requests carry that server's session, and
                    Settings there is the only place that server's phones can be paired from (MOCA-84).
                    The server decides who may act — an owner or an admin session — not this gate. */}
                <ServerPairingCard />
                {!remoteActive && <CompanionSection profileEmail={state.config?.profile?.email} />}
              </>
            )}

            {section === "computer" && <LocalComputerSection />}

            {section === "usage" && <UsageSection />}
            {section === "people" && <PeopleSection />}
            {section === "mail" && <MailSettings />}
            {section === "activity" && <ActivitySection />}
            {section === "workspaces" && <WorkspacesSection />}
            </div>
          </div>
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
