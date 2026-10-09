// Plugins: one panel in three views, after the "Connect apps" screens people
// know from desktop assistants.
//
//   - Connect apps (main): every connected app, MCP server, catalog plugin
//     and skill in one list (one row per app, whatever its sources), with
//     search across all of them, category chips, a small type filter and a
//     section per category. "N connected" opens Manage.
//   - Manage: installed plugins, private skills (each opens its skill page),
//     a person's own connections on an organization server, and in Advanced:
//     Add manually / Paste config, marketplaces, the settings for every
//     MCP server.
//   - Detail: one plugin's accounts, tools (a switch per MCP tool, applied to
//     every bot) and details, with Uninstall.
//
// Two install scopes on one marketplace list (src/lib/plugin-scope.ts):
// everyone (a marketplace plugin's MCP servers and skills) or, when a bot is
// in reach, "For <bot>" (the whole plugin, agents and commands included, on
// that bot only; its owner or a person who manages it).
//
// This panel is the only place that adds, removes, configures or lists
// plugins, servers, apps, skills and marketplaces. Other screens link here
// or choose among them for one bot; keys stay in Settings > API keys.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { managedConnectorUnavailableReason } from "../../shared/connector-availability";
import { isWhopServer } from "@/lib/whop-integration";
import { skillsLibraryEnabled } from "@/lib/feature-flags";
import { templatesEntryActions } from "@/lib/templates-entry";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";
import { viewerCan } from "@/lib/viewer";
import { permissionMissingText } from "@/lib/permissions";
import type { SkillsLibrarySkillWire } from "../../shared/wire";
import { WHOP_KEY, buildPluginItems, marketplacePluginKey, type PluginFilter, type PluginItem, type PluginTypeFilter } from "@/lib/plugins-model";
import {
  addMarketplace as addBotMarketplace,
  installPlugin as installBotPlugin,
  loadBotPlugins,
  removeMarketplace as removeBotMarketplace,
  setPluginEnabled as setBotPluginEnabled,
  uninstallPlugin as uninstallBotPlugin,
  updateMarketplace as updateBotMarketplace,
  type BotPluginsView,
} from "@/lib/my-connections";
import { botPluginState, botScopeMarketplaces, initialPluginScope, marketplaceRoute, pluginScopeBot, type PluginScope } from "@/lib/plugin-scope";
import {
  ClaudeMcpSwitch,
  McpAuthLine,
  McpClientForm,
  McpImportForm,
  McpMessages,
  McpServerEditor,
  WhopAction,
  WhopBelow,
  isRemoteMcpListing,
  useMcpServers,
} from "./McpServersPanel";
import { IntegrationsManagedNotice, MyConnectionsSettings } from "./settings/MyConnectionsSettings";
import { useServerMode } from "./ServerModeSettings";
import { ProvidersSection } from "./plugins/ProvidersSection";
import { requestSettingsCard } from "./SettingsPrimitives";
import {
  botsMissingConnectedApps,
  botsWithLimitedServiceTools,
  connectorActionLabel,
  disconnectAccountConfirmation,
  hasUsableConnectedApps,
  useConnectedApps,
  type ConnectedApps,
} from "./plugins/connected-apps";
import { ConnectAppsView } from "./plugins/ConnectAppsView";
import { ManageView } from "./plugins/ManageView";
import { MarketplacesSection } from "./plugins/MarketplacesSection";
import { PluginStatusLabel } from "./plugins/PluginParts";
import { AddAccountButton, PluginDetailView, SignInButton, type DetailAccount, type PluginDetailProps } from "./plugins/PluginDetailView";
import { SkillPage } from "./plugins/SkillPage";
import { ScopeToggle } from "./plugins/ScopeToggle";
import { BotPluginCard } from "./plugins/BotPluginCard";

export * from "./plugins/connected-apps";

interface MarketplaceListing {
  name: string;
  source: string;
  ref?: string;
  description?: string;
  /** bots with plugins from it (the workspace list only) */
  bots?: number;
  plugins: Array<{ name: string; description?: string; version?: string; category?: string; installed: boolean; servers: string[]; skills: string[] }>;
}

interface FeaturedListing {
  id: string; name: string; description: string; url: string; domain: string; auth: string; installed?: boolean; site?: string; category?: string; iconUrl?: string;
}

type Page =
  | { page: "main" }
  | { page: "manage" }
  | { page: "detail"; key: string; from: "main" | "manage" }
  /** a private skill's page; no name: a new skill */
  | { page: "skill"; name?: string; from: "main" | "manage" };

/** Connectors a Claude account brings to bots (Manage > Providers lists
 * them); "N connected" counts the connected ones. */
function useClaudeConnectorCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    api("/api/me/harness-connectors", { timeoutMs: 90_000 })
      .then((answer) => {
        const connectors: Array<{ status?: string }> = answer?.claude?.available ? answer.claude.connectors ?? [] : [];
        if (!cancelled) setCount(connectors.filter((connector) => connector.status === "connected").length);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return count;
}

/** The label of a plugin's source, for Manage and the details. */
export function pluginSourceLabel(source: string): string {
  if (source === "manual") return t("connectApps.source.manual");
  if (source === "catalog") return t("connectApps.source.catalog");
  if (source === "composio") return t("connectApps.source.composio");
  if (source === "local") return t("connectApps.skill.createdLocally");
  return source;
}

export function PluginsPanel() {
  const { state, dispatch } = useStore();
  const remoteClient = window.ogb?.remoteClient?.active === true;
  const dialogRef = useRef<HTMLDivElement>(null);
  const apps = useConnectedApps();
  const mcp = useMcpServers();
  const [page, setPage] = useState<Page>({ page: "main" });
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [type, setType] = useState<PluginTypeFilter>(state.pluginsSurface === "mcp" ? "mcp" : "any");
  const claudeConnectors = useClaudeConnectorCount();
  const ownerOrAdmin = useOwnerOrAdmin();
  // 2026-10-09: a profile with skills.library changes the library too.
  const libraryEditor = ownerOrAdmin === true || (ownerOrAdmin === false && viewerCan(state.config, "skills.library"));
  const serverMode = useServerMode();
  const perspicaxOrg = usePerspicaxOrg();
  const organization = Boolean(serverMode?.active) || perspicaxOrg !== null;
  const [featured, setFeatured] = useState<FeaturedListing[] | null>(null);
  const [skills, setSkills] = useState<SkillsLibrarySkillWire[] | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [marketplaces, setMarketplaces] = useState<MarketplaceListing[] | null>(null);
  const [marketBusy, setMarketBusy] = useState<string | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  /** the workspace's marketplace routes answered (its managers only) */
  const [workspaceMarkets, setWorkspaceMarkets] = useState(false);
  const scopeBot = pluginScopeBot({ pluginsBotId: state.pluginsBotId, selectedId: state.selectedId, bots: state.bots });
  const scopeBotId = scopeBot?.id ?? null;
  const [scopeChoice, setScopeChoice] = useState<PluginScope>(() => initialPluginScope(state.pluginsBotId, scopeBot));
  const scope: PluginScope = scopeChoice === "bot" && scopeBot ? "bot" : "workspace";
  const [botView, setBotView] = useState<BotPluginsView | null>(null);
  const [botBusy, setBotBusy] = useState<string | null>(null);

  const loadFeatured = useCallback(() => api("/api/plugins/search")
    .then((result) => setFeatured(result.featured ?? []))
    .catch(() => setFeatured([])), []);
  const loadSkills = useCallback(() => api("/api/skills-library")
    .then((result) => setSkills(result.skills ?? []))
    // the skills library is an option: off, there are no private skills
    .catch(() => setSkills([])), []);
  const loadMarketplaces = useCallback(() => api("/api/marketplaces")
    .then((result) => {
      setMarketplaces(result.marketplaces ?? []);
      setWorkspaceMarkets(true);
    })
    // only an admin or this computer's owner manages marketplaces; a member
    // reads the same list through a bot ("For this bot")
    .catch(() => {
      setMarketplaces([]);
      setWorkspaceMarkets(false);
    }), []);
  const loadBotView = useCallback(async () => {
    if (!scopeBotId) {
      setBotView(null);
      return;
    }
    try {
      setBotView(await loadBotPlugins(scopeBotId));
    } catch {
      setBotView(null);
    }
  }, [scopeBotId]);
  useEffect(() => {
    void loadFeatured();
    void loadSkills();
    void loadMarketplaces();
  }, [loadFeatured, loadSkills, loadMarketplaces]);
  useEffect(() => {
    void loadBotView();
  }, [loadBotView]);

  const close = useCallback(() => dispatch({ type: "togglePlugins", open: false }), [dispatch]);
  const skillsLibraryOn = skillsLibraryEnabled(state.config);
  /** Bot templates: closes Connect apps and opens Browse Bots on its
   * Templates section (the one place for templates). */
  const openBotTemplates = () => {
    for (const action of templatesEntryActions("connectApps")) dispatch(action);
  };
  const back = useCallback(() => setPage((current) => current.page === "detail" || current.page === "skill" ? { page: current.from } : { page: "main" }), []);

  // Focus and keys: Escape steps back one page, then closes.
  const pageRef = useRef(page);
  pageRef.current = page;
  useEffect(() => {
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? []);
    (dialog?.querySelector<HTMLElement>("input") ?? focusable()[0] ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (pageRef.current.page === "main") close();
        else back();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      returnFocus?.focus();
    };
  }, [back, close]);

  // The bot scope reads the same marketplaces through the bot: installed
  // there means on that bot.
  const shownMarketplaces = useMemo<MarketplaceListing[] | null>(
    () => (scope === "bot" ? (botView ? botScopeMarketplaces(botView) : null) : marketplaces),
    [scope, botView, marketplaces],
  );
  const items = useMemo(() => buildPluginItems({
    cards: apps.cards,
    status: apps.status,
    servers: mcp.servers,
    featured,
    skills,
    marketplaces: shownMarketplaces,
    whop: { description: t("whop.description"), server: mcp.whopServer?.name, connected: mcp.whopConnected },
    // Until the catalog answers, assume apps can be connected (no flicker).
    composioUsable: apps.cards === null || apps.configured,
  }), [apps.cards, apps.status, apps.configured, mcp.servers, featured, skills, shownMarketplaces, mcp.whopServer?.name, mcp.whopConnected]);
  // For a bot, only marketplace plugins: apps, servers and skills are the
  // workspace's (a bot chooses among them in its own Access).
  const scopedItems = useMemo(() => (scope === "bot" ? items.filter((item) => item.kind === "plugin") : items), [scope, items]);

  const refreshAll = () => {
    void apps.loadConnectionInventory(true);
    void mcp.load(true);
    void loadFeatured();
    void loadSkills();
    void loadMarketplaces();
    void loadBotView();
  };
  const refreshing = apps.refreshing || mcp.busy === "load";

  const openItem = (item: PluginItem) => {
    if (item.kind === "skill") {
      setPage((current) => ({ page: "skill", name: item.id, from: current.page === "manage" ? "manage" : "main" }));
      return;
    }
    // Whop's page is its MCP server's page.
    const key = item.key === WHOP_KEY && mcp.whopServer ? `mcp:${mcp.whopServer.name}` : item.key;
    setPage((current) => ({ page: "detail", key, from: current.page === "manage" ? "manage" : "main" }));
  };

  const installFeatured = async (item: PluginItem) => {
    setInstalling(item.id);
    setPanelError(null);
    try {
      const result = await api("/api/plugins/install", { method: "POST", body: JSON.stringify({ id: item.id }) });
      await mcp.load();
      await loadFeatured();
      if (typeof result.authorizationUrl === "string") await apps.openConnectUrl(result.authorizationUrl);
      if (typeof result.name === "string") setPage({ page: "detail", key: `mcp:${result.name}`, from: "main" });
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(null);
    }
  };

  const marketAction = async (busy: string, work: () => Promise<unknown>): Promise<boolean> => {
    setMarketBusy(busy);
    setMarketError(null);
    try {
      await work();
      return true;
    } catch (cause) {
      setMarketError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setMarketBusy(null);
    }
  };
  // Add, refresh and remove go through the workspace's routes for its
  // managers, else through the bot's own for a person who may change that
  // bot's plugins: one list either way.
  const marketRoute = marketplaceRoute({ workspaceManager: workspaceMarkets, scope, botView });
  const afterBotMarket = async (view: BotPluginsView) => {
    setBotView(view);
    if (workspaceMarkets) await loadMarketplaces();
  };
  const addMarketplace = (source: string, ref: string) => marketAction("add", async () => {
    if (marketRoute === "bot" && scopeBotId) {
      await afterBotMarket(await addBotMarketplace(scopeBotId, source, ref || undefined));
      return;
    }
    const result = await api("/api/marketplaces", { method: "POST", body: JSON.stringify({ source, ...(ref ? { ref } : {}) }) });
    setMarketplaces(result.marketplaces ?? []);
    void loadBotView();
  });
  const refreshMarketplace = (name: string) => void marketAction(`refresh:${name}`, async () => {
    if (marketRoute === "bot" && scopeBotId) {
      await afterBotMarket(await updateBotMarketplace(scopeBotId, name));
      return;
    }
    const result = await api(`/api/marketplaces/${encodeURIComponent(name)}/refresh`, { method: "POST", body: "{}" });
    setMarketplaces(result.marketplaces ?? []);
    void loadBotView();
  });
  const removeMarketplace = (name: string) => {
    const fromBot = marketRoute === "bot" && scopeBot;
    if (!window.confirm(fromBot ? t("connectApps.market.removeFromBotConfirm", { name, bot: scopeBot.name }) : t("connectApps.market.removeConfirm", { name }))) return;
    void marketAction(`remove:${name}`, async () => {
      if (fromBot) {
        const view = await removeBotMarketplace(scopeBot.id, name);
        await afterBotMarket(view);
        if (!view.sharedRemoved) setPanelNotice(t("connectApps.market.keptForEveryone", { name }));
      } else {
        const result = await api(`/api/marketplaces/${encodeURIComponent(name)}`, { method: "DELETE" });
        setMarketplaces(result.marketplaces ?? []);
        void loadBotView();
      }
      if (filter === `source:${name}`) setFilter("all");
    });
  };
  const marketSummaries = marketRoute === "bot" && botView
    ? botScopeMarketplaces(botView)
    : marketRoute === "workspace" ? marketplaces : null;

  /** "For <bot>": the whole plugin on that one bot. */
  const botAction = async (busy: string, work: () => Promise<BotPluginsView>): Promise<void> => {
    setBotBusy(busy);
    setPanelError(null);
    try {
      setBotView(await work());
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBotBusy(null);
    }
  };
  const installForBot = (id: string) => {
    const at = id.lastIndexOf("@");
    if (!scopeBotId || at <= 0) return;
    void botAction(`install:${id}`, () => installBotPlugin(scopeBotId, id.slice(at + 1), id.slice(0, at)));
  };
  const uninstallForBot = (id: string) => {
    if (!scopeBot || !window.confirm(t("connectApps.botPlugin.uninstallConfirm", { name: id.slice(0, id.lastIndexOf("@")), bot: scopeBot.name }))) return;
    void botAction(`remove:${id}`, () => uninstallBotPlugin(scopeBot.id, id));
  };
  const toggleForBot = (id: string, enabled: boolean) => {
    if (!scopeBotId) return;
    void botAction(`toggle:${id}`, () => setBotPluginEnabled(scopeBotId, id, enabled));
  };
  const botCard = (item: PluginItem): ReactNode => {
    if (!scopeBot || !botView || item.kind !== "plugin") return null;
    const plugin = botPluginState(botView, item.id);
    if (!plugin) return null;
    const busy = botBusy?.endsWith(`:${item.id}`) ? botBusy.slice(0, botBusy.indexOf(":")) : botBusy ? "other" : null;
    return (
      <BotPluginCard
        botName={scopeBot.name}
        view={botView}
        plugin={plugin}
        busy={busy}
        onInstall={() => installForBot(item.id)}
        onToggle={(enabled) => toggleForBot(item.id, enabled)}
        onUninstall={() => uninstallForBot(item.id)}
      />
    );
  };
  /** Add on a marketplace plugin: its MCP servers and skills, for every bot. */
  const installPlugin = async (item: PluginItem) => {
    const [plugin, marketplace] = item.id.split("@") as [string, string];
    setInstalling(item.id);
    setPanelError(null);
    setPanelNotice(null);
    try {
      const result = await api(`/api/marketplaces/${encodeURIComponent(marketplace)}/plugins/${encodeURIComponent(plugin)}`, { method: "POST", body: "{}" });
      setMarketplaces(result.marketplaces ?? []);
      await Promise.all([mcp.load(), loadSkills()]);
      const skipped: string[] = Array.isArray(result.skipped) ? result.skipped : [];
      if (skipped.length) setPanelNotice(t("connectApps.plugin.skipped", { parts: skipped.join("; ") }));
      setPage((current) => ({ page: "detail", key: marketplacePluginKey(marketplace, plugin), from: current.page === "manage" ? "manage" : "main" }));
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(null);
    }
  };
  const uninstallPlugin = async (item: PluginItem) => {
    const [plugin, marketplace] = item.id.split("@") as [string, string];
    if (!window.confirm(t("connectApps.plugin.uninstallConfirm", { name: plugin }))) return;
    setInstalling(item.id);
    setPanelError(null);
    try {
      const result = await api(`/api/marketplaces/${encodeURIComponent(marketplace)}/plugins/${encodeURIComponent(plugin)}`, { method: "DELETE" });
      setMarketplaces(result.marketplaces ?? []);
      await Promise.all([mcp.load(), loadSkills()]);
    } catch (cause) {
      setPanelError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setInstalling(null);
    }
  };

  const renderAction = (item: PluginItem) => {
    if (item.key === WHOP_KEY) return <WhopAction mcp={mcp} />;
    if (item.kind === "plugin") {
      if (item.installed) return null;
      if (scope === "bot") {
        if (!botView?.canChange) return null;
        return (
          <button type="button" data-bot-plugin-add={item.id} disabled={botBusy !== null} onClick={() => installForBot(item.id)} className="ui-button min-w-[76px] disabled:opacity-40">
            {botBusy === `install:${item.id}` ? <Loader2 size={13} className="mx-auto animate-spin" /> : t("connectApps.action.add")}
          </button>
        );
      }
      return (
        <button type="button" disabled={installing !== null} onClick={() => void installPlugin(item)} className="ui-button min-w-[76px] disabled:opacity-40">
          {installing === item.id ? <Loader2 size={13} className="mx-auto animate-spin" /> : t("connectApps.action.add")}
        </button>
      );
    }
    if (item.kind === "featured") {
      return (
        <button type="button" disabled={installing !== null} onClick={() => void installFeatured(item)} className="ui-button min-w-[76px] disabled:opacity-40">
          {installing === item.id ? <Loader2 size={13} className="mx-auto animate-spin" /> : t(item.action === "connect" ? "connectApps.action.connect" : "connectApps.action.add")}
        </button>
      );
    }
    if (item.kind !== "app" || item.installed) return null;
    return <AppActionButton apps={apps} slug={item.id} />;
  };

  const renderBelow = (item: PluginItem) => {
    if (item.key === WHOP_KEY) return <WhopBelow mcp={mcp} />;
    if (item.kind !== "app") return null;
    return <AppBelow apps={apps} item={item} draft={aliasDraft} onDraft={setAliasDraft} />;
  };

  // Only worth saying once an app is actually connected and reachable.
  const botsWithoutApps = hasUsableConnectedApps(apps.configured, apps.inventoryPhase, apps.stale, apps.status)
    ? botsMissingConnectedApps(state.bots, state.instances)
    : [];
  const appsError = apps.error ? (typeof apps.error === "string" ? apps.error : t(apps.error.key)) : null;
  const errorBanner = (
    <>
      {(panelError || appsError) && <div role="alert" className="mx-6 mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger sm:mx-8">{panelError ?? appsError}</div>}
      {panelNotice && <div role="status" className="mx-6 mt-2 rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning sm:mx-8">{panelNotice}</div>}
    </>
  );

  const notices = (
    <>
      {apps.stale && (
        // Say which of the two things is true. Silence here is what makes a
        // remembered list indistinguishable from a confirmed one.
        <div className="mx-6 mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[12.5px] text-warning sm:mx-8">
          <TriangleAlert size={14} className="mt-px shrink-0" />
          <span>{t("connectors.stale")}</span>
        </div>
      )}
      {botsWithoutApps.length > 0 && (
        <div className="mx-6 mt-3 rounded-xl bg-inset px-4 py-3 text-[12.5px] leading-relaxed text-ink-secondary sm:mx-8">
          <span className="font-medium text-ink">{t("connectors.perBot.title")}</span>{" "}
          {t("connectors.perBot.body")}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {botsWithoutApps.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => dispatch({ type: "updateBot", botId: candidate.id, patch: { composio: true } })}
                className="rounded-full bg-control px-2.5 py-1 text-[11.5px] font-medium text-ink hover:bg-raised-hover"
              >
                {t("connectors.perBot.allow", { name: candidate.name })}
              </button>
            ))}
          </div>
        </div>
      )}
      {apps.configured && !remoteClient && apps.source === "curated" && apps.mode === "self-hosted" && (
        <div className="mx-6 mt-3 text-[12px] text-ink-secondary sm:mx-8">
          {t("connectors.featuredBefore")}{" "}
          <button
            className="underline underline-offset-2 hover:text-ink"
            onClick={() => {
              close();
              requestSettingsCard("connections.apps");
              dispatch({ type: "toggleAppSettings", open: true, section: "connections" });
            }}
          >
            {t("connectors.updateKey")}
          </button>{" "}
          {t("connectors.featuredAfter")}
        </div>
      )}
      {errorBanner}
    </>
  );

  const scopeControl = scopeBot ? (
    <div data-plugins-scope-bar>
      <ScopeToggle scope={scope} botName={scopeBot.name} onScope={setScopeChoice} />
      {scope === "bot" && (
        <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">
          {t("connectApps.scope.botNote", { name: scopeBot.name })}
          {botView && !botView.canChange && !botView.managedByAdmin && <> {t("plugins.readOnly")}</>}
        </p>
      )}
      {scope === "bot" && botView?.managedByAdmin && <div className="mt-2"><IntegrationsManagedNotice /></div>}
      {scope === "bot" && botView && botView.marketplaces.length === 0 && (
        <p className="mt-2 rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary" data-plugins-scope-empty>{t("connectApps.scope.noMarketplaces")}</p>
      )}
    </div>
  ) : null;

  const detailItem = page.page === "detail" ? items.find((item) => item.key === page.key) : undefined;
  // An item that went away (uninstalled, or removed elsewhere) leaves its page.
  const detailMissing = page.page === "detail" && !detailItem && mcp.servers !== null && apps.cards !== null && skills !== null && shownMarketplaces !== null;
  // A skill deleted or renamed elsewhere leaves its page too.
  const skillMissing = page.page === "skill" && Boolean(page.name) && skills !== null && !skills.some((entry) => entry.name === page.name);
  useEffect(() => {
    if (detailMissing || skillMissing) back();
  }, [detailMissing, skillMissing, back]);

  const skillsOn = skills !== null && skillsLibraryOn;
  const pageSkill = page.page === "skill" && page.name ? skills?.find((entry) => entry.name === page.name) : undefined;
  const skillReadOnly = (skill: SkillsLibrarySkillWire): string | undefined => {
    if (ownerOrAdmin === false && !libraryEditor) return perspicaxOrg !== null ? permissionMissingText("skills.library") : t("connectApps.skill.readOnlyOwner");
    if (skill.version) return t("connectApps.skill.readOnlyOrganization");
    const plugin = marketplaces?.find((market) => market.name === skill.source)?.plugins.find((entry) => entry.installed && entry.skills.includes(skill.name));
    if (plugin) return t("connectApps.skill.readOnlyPlugin", { plugin: plugin.name });
    return undefined;
  };

  let content;
  if (page.page === "skill" && (pageSkill || !page.name)) {
    content = (
      <SkillPage
        key={page.name ?? "new"}
        skill={pageSkill}
        readOnlyReason={pageSkill ? skillReadOnly(pageSkill) : undefined}
        onBack={back}
        onClose={close}
        onSaved={async (name) => {
          await loadSkills();
          setPage((current) => current.page === "skill" ? { ...current, name } : current);
        }}
        onDeleted={async () => {
          await loadSkills();
          setPage((current) => current.page === "skill" ? { page: current.from } : current);
        }}
      />
    );
  } else if (page.page === "manage") {
    content = (
      <ManageView
        items={scopedItems}
        countLabel={(item) => (scope === "bot" ? botCountLabel(item, botView) : countLabel(item, marketplaces))}
        sourceLabel={pluginSourceLabel}
        scope={scopeControl}
        pluginsOnly={scope === "bot"}
        onBack={back}
        onClose={close}
        onOpenItem={openItem}
        onNewSkill={skillsOn && (ownerOrAdmin !== false || libraryEditor) ? () => setPage({ page: "skill", from: "manage" }) : undefined}
        personal={organization ? (
          <section className="mt-6" data-plugins-personal>
            <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.manage.personal")}</h3>
            <MyConnectionsSettings />
          </section>
        ) : undefined}
        advancedOpen={mcp.editing === "new" || mcp.importOpen}
        onAddManually={mcp.startAdd}
        onPasteConfig={mcp.toggleImport}
        addDisabled={mcp.busy !== null || mcp.restricted}
        addTitle={mcp.restricted && mcp.policy ? t("policy.managedBy", { organization: mcp.policy.organizationName }) : undefined}
        refreshing={refreshing}
        onRefresh={refreshAll}
        providers={<ProvidersSection instances={state.instances} />}
        forms={(
          <>
            {mcp.restricted && mcp.policy && <p role="status" className="mt-3 text-[12.5px] leading-relaxed text-ink-secondary">{t("policy.mcpRestricted", { organization: mcp.policy.organizationName })}</p>}
            <McpMessages mcp={mcp} />
            <McpImportForm mcp={mcp} />
            {mcp.editing === "new" && <McpServerEditor mcp={mcp} />}
          </>
        )}
      >
        <MarketplacesSection
          marketplaces={marketSummaries}
          busy={marketBusy}
          error={marketError}
          onAdd={addMarketplace}
          onRefresh={refreshMarketplace}
          onRemove={removeMarketplace}
          disabled={marketRoute === null}
          removeKeepsInstalls={marketRoute === "bot"}
        />
        {scope === "workspace" && (
          <section className="mt-6">
            <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.manage.settings")}</h3>
            <ClaudeMcpSwitch />
          </section>
        )}
      </ManageView>
    );
  } else if (page.page === "detail" && detailItem) {
    content = (
      <PluginDetailView
        {...detailProps(detailItem, { apps, mcp, aliasDraft, setAliasDraft, bots: state.bots, instances: state.instances,
          items, marketplaces: shownMarketplaces, installing, openItem, uninstallPlugin: (item) => void uninstallPlugin(item),
          scope, botCard: botCard(detailItem),
          openBotAccess: (botId) => {
            close();
            dispatch({ type: "toggleSettings", open: true, botId, section: "access" });
          } })}
        onBack={back}
        onClose={close}
      />
    );
  } else if (page.page === "detail" || page.page === "skill") {
    content = (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-secondary">
        <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
      </div>
    );
  } else {
    content = (
      <ConnectAppsView
        items={scopedItems}
        scope={scopeControl}
        loading={apps.cards === null || mcp.servers === null || (scope === "bot" && botView === null)}
        search={search}
        onSearch={setSearch}
        filter={filter}
        onFilter={setFilter}
        type={type}
        onType={(next) => {
          setType(next);
          if (next === "mcp" || next === "apps" || next === "any") {
            dispatch({ type: "togglePlugins", open: true, surface: next === "mcp" ? "mcp" : "apps" });
          }
        }}
        sourceLabel={pluginSourceLabel}
        extraSources={(shownMarketplaces ?? []).map((market) => market.name)}
        extraConnected={scope === "bot" ? 0 : claudeConnectors}
        onBotTemplates={remoteClient ? undefined : openBotTemplates}
        refreshing={refreshing}
        onRefresh={refreshAll}
        onClose={close}
        onOpenManage={() => setPage({ page: "manage" })}
        onOpenItem={openItem}
        renderAction={renderAction}
        renderBelow={renderBelow}
        notices={notices}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        ref={dialogRef}
        data-tour="apps-panel"
        data-plugins-page={page.page}
        role="dialog"
        aria-modal="true"
        aria-labelledby="plugins-title"
        tabIndex={-1}
        className="animate-pop-in flex h-[min(720px,calc(100dvh-96px))] w-[min(860px,calc(100vw-40px))] flex-col overflow-hidden rounded-[14px] border border-border bg-elevated"
      >
        {content}
      </div>
    </div>
  );
}

/** Connect / Continue / Add account on a connected app's row. */
function AppActionButton({ apps, slug }: { apps: ConnectedApps; slug: string }) {
  const serviceStatus = apps.status[slug];
  const failed = Boolean(serviceStatus?.status && /^(expired|failed)$/i.test(serviceStatus.status));
  const pending = serviceStatus?.pending && !failed;
  const accounts = serviceStatus?.accounts ?? [];
  const busy = apps.busySlug === slug;
  const unavailable = Boolean(managedConnectorUnavailableReason(apps.mode, slug));
  // Dimmed only when connecting cannot work right now, and then it says why.
  const why = unavailable ? t("connectors.selfHostOnlyReason")
    : !apps.configured ? t("connectApps.unavailable.noKey")
    : apps.inventoryPhase === "loading" ? t("connectApps.unavailable.checking")
    : apps.inventoryPhase === "error" ? t("connectApps.unavailable.error")
    : undefined;
  return (
    <button
      type="button"
      disabled={busy || why !== undefined}
      title={why}
      onClick={() => apps.primaryAction(slug)}
      className="ui-button min-w-[76px] disabled:opacity-40"
    >
      {unavailable ? t("connectors.selfHostOnly") : busy ? <Loader2 size={13} className="mx-auto animate-spin" /> : connectorActionLabel(apps.inventoryPhase, {
        busy,
        included: false,
        canContinue: Boolean(pending && apps.pendingUrl(slug)),
        pending,
        hasAccounts: accounts.length > 0,
        failed,
      })}
    </button>
  );
}

/** Under an app's row: the link of a sign-in in flight, or the name of the
 * account about to be connected. */
function AppBelow({ apps, item, draft, onDraft }: { apps: ConnectedApps; item: PluginItem; draft: string; onDraft: (value: string) => void }) {
  const slug = item.id;
  const serviceStatus = apps.status[slug];
  const failed = /^(expired|failed)$/i.test(serviceStatus?.status ?? "");
  const url = serviceStatus?.pending && !failed ? apps.pendingUrl(slug) : null;
  return (
    <>
      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" onClick={(event) => {
          if (!apps.pendingUrl(slug)) {
            event.preventDefault();
            void apps.connect(slug);
          }
        }} className="ml-[52px] mt-1 inline-block text-[12px] text-accent-text underline underline-offset-2">
          {t("connectors.openAuthorizationPage")}
        </a>
      )}
      {apps.aliasSlug === slug && !item.installed && (
        <AliasForm apps={apps} slug={slug} name={item.name} draft={draft} onDraft={onDraft} hasAccounts={Boolean(serviceStatus?.accounts?.length)} />
      )}
    </>
  );
}

/** The name of the account about to be connected (every account has one). */
function AliasForm({ apps, slug, name, draft, onDraft, hasAccounts }: {
  apps: ConnectedApps; slug: string; name: string; draft: string; onDraft: (value: string) => void; hasAccounts: boolean;
}) {
  const busy = apps.busySlug === slug;
  return (
    <form
      className="ml-[52px] mt-2 flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const alias = draft.trim();
        if (!alias) {
          apps.setError({ key: "connectors.aliasRequired" });
          return;
        }
        void apps.connect(slug, alias).then(() => onDraft(""));
      }}
    >
      <input
        autoFocus
        value={draft}
        maxLength={64}
        onChange={(event) => onDraft(event.target.value)}
        placeholder={t("connectors.aliasPlaceholder")}
        aria-label={hasAccounts ? t("connectors.aliasAriaAnother", { service: name }) : t("connectors.aliasAriaNew", { service: name })}
        className="min-w-0 flex-1 rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] leading-[18px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none"
      />
      <button type="submit" disabled={busy || !draft.trim()} className="rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-accent-ink disabled:opacity-40">
        {t("connectors.action.continue")}
      </button>
    </form>
  );
}

/** Installed card subline, as the reference: how many connectors it brings
 * (an app or a server is one; a marketplace plugin, its servers). */
function countLabel(item: PluginItem, marketplaces: MarketplaceListing[] | null): string {
  let count = 1;
  if (item.kind === "plugin") {
    const [plugin, marketplace] = item.id.split("@");
    const entry = marketplaces?.find((market) => market.name === marketplace)?.plugins.find((candidate) => candidate.name === plugin);
    count = entry?.servers.length ?? 0;
    if (count === 0 && entry?.skills.length) {
      return entry.skills.length === 1 ? t("connectApps.count.skillOne") : t("connectApps.count.skillMany", { count: entry.skills.length });
    }
  }
  return count === 1 ? t("connectApps.count.connectorOne") : t("connectApps.count.connectorMany", { count });
}

/** The same subline for the bot scope: what the plugin brings to that bot. */
function botCountLabel(item: PluginItem, view: BotPluginsView | null): string {
  const contents = botPluginState(view, item.id)?.contents;
  const count = contents ? contents.agents.length + contents.commands.length + contents.skills.length : 0;
  return count === 1 ? t("connectApps.botPlugin.countOne") : t("connectApps.botPlugin.countMany", { count });
}

interface DetailContext {
  apps: ConnectedApps;
  mcp: ReturnType<typeof useMcpServers>;
  aliasDraft: string;
  setAliasDraft: (value: string) => void;
  bots: ReturnType<typeof useStore>["state"]["bots"];
  instances: ReturnType<typeof useStore>["state"]["instances"];
  openBotAccess: (botId: string) => void;
  items: PluginItem[];
  marketplaces: MarketplaceListing[] | null;
  installing: string | null;
  openItem: (item: PluginItem) => void;
  uninstallPlugin: (item: PluginItem) => void;
  scope: PluginScope;
  /** the plugin "For <bot>" (absent: no bot in reach) */
  botCard: ReactNode;
}

type DetailBase = Omit<PluginDetailProps, "onBack" | "onClose">;

function detailProps(item: PluginItem, context: DetailContext): DetailBase {
  if (item.kind === "app") return appDetail(item, context);
  if (item.kind === "plugin") return pluginDetail(item, context);
  return mcpDetail(item, context);
}

function appDetail(item: PluginItem, { apps, aliasDraft, setAliasDraft, bots, instances, openBotAccess }: DetailContext): DetailBase {
  const slug = item.id;
  const serviceStatus = apps.status[slug];
  const accounts = serviceStatus?.accounts ?? [];
  const busy = apps.busySlug === slug;
  const limited = botsWithLimitedServiceTools(bots, instances, slug);
  const rows: DetailAccount[] = accounts.length
    ? accounts.map((account) => ({
      id: account.id,
      label: account.alias || account.id,
      detail: `${account.alias ? `${account.id} · ` : ""}${account.status.toLowerCase()}`,
      status: /^active$/i.test(account.status) ? "connected" : /^(initiated|initializing)$/i.test(account.status) ? "pending" : "needs_auth",
      onRemove: () => {
        if (!window.confirm(disconnectAccountConfirmation(item.name, account))) return;
        apps.disconnectAccount(slug, account.id);
      },
      removeLabel: t("connectors.disconnectAria", { account: account.alias || account.id, service: item.name }),
    }))
    : [{ id: "default", label: t("connectApps.detail.noAccountNeeded"), status: "connected" }];
  return {
    item,
    subtitle: item.domain ?? slug,
    busy,
    onUninstall: accounts.length ? () => {
      if (!window.confirm(t("connectApps.detail.uninstallAppConfirm", { name: item.name }))) return;
      void apps.removeService(slug);
    } : undefined,
    accounts: rows,
    accountAction: accounts.length ? <AddAccountButton label={t("connectApps.detail.addAccount")} disabled={busy || !apps.configured} onClick={() => apps.setAliasSlug(slug)} /> : null,
    accountExtra: (
      <>
        {apps.aliasSlug === slug && !serviceStatus?.pending && (
          <AliasForm apps={apps} slug={slug} name={item.name} draft={aliasDraft} onDraft={setAliasDraft} hasAccounts={accounts.length > 0} />
        )}
        {serviceStatus?.pending && (
          <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-ink-secondary">
            <span>{apps.pendingUrl(slug) ? t("connectors.finishSetup") : t("connectors.finishSetupOrDisconnect")}</span>
            <AppActionButton apps={apps} slug={slug} />
          </div>
        )}
        {limited.length > 0 && (
          <div className="mt-2 text-[11.5px] leading-relaxed text-ink-secondary">
            <span>{t("connectors.grants.limited", { count: limited.length })}</span>{" "}
            {limited.slice(0, 4).map((candidate, index) => (
              <span key={candidate.id}>
                {index > 0 && ", "}
                <button type="button" onClick={() => openBotAccess(candidate.id)} className="font-medium text-ink underline underline-offset-2 hover:text-accent-text">
                  {candidate.name}
                </button>
              </span>
            ))}
            {limited.length > 4 && <span>{t("connectors.grants.more", { count: limited.length - 4 })}</span>}
          </div>
        )}
      </>
    ),
    tools: undefined,
    details: [
      { label: t("connectApps.detail.source"), value: pluginSourceLabel("composio") },
      { label: t("connectApps.detail.transport"), value: t("connectApps.transport.composio") },
      { label: t("connectApps.detail.accountsCount"), value: String(accounts.length) },
    ],
  };
}

function mcpDetail(item: PluginItem, { mcp }: DetailContext): DetailBase {
  const server = mcp.servers?.find((entry) => entry.name === item.id);
  if (!server) return { item, subtitle: "", busy: true, details: [] };
  const name = server.name;
  const remote = isRemoteMcpListing(server);
  const disabled = new Set(server.disabledTools ?? []);
  const probe = mcp.probe[name];
  const toolList = probe?.ok ? (probe.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description, enabled: !disabled.has(tool.name) })) : null;
  const signingIn = mcp.busy === `oauth:${name}` || Boolean(mcp.waiting[name]);
  const issuer = remote ? (server.authIssuer ?? safeHost(server.url)) : "";
  let account: DetailAccount;
  let accountAction: ReactNode = null;
  if (remote && server.auth === "connected") {
    account = { id: "oauth", label: issuer, detail: t("connectApps.detail.signedIn"), status: "connected", onRemove: () => void mcp.signOut(server), removeLabel: t("mcp.oauth.disconnectAria", { name }) };
  } else if (remote && (server.auth === "required" || server.auth === "expired" || server.auth === "error")) {
    account = { id: "oauth", label: issuer, detail: server.authError, status: "needs_auth" };
    accountAction = <SignInButton label={t(server.auth === "expired" ? "mcp.oauth.signInAgain" : "mcp.oauth.signIn")} busy={signingIn} disabled={mcp.busy !== null || Boolean(server.managedBy)} onClick={() => void mcp.signIn(server)} />;
  } else {
    const keys = remote ? server.headerKeys : server.envKeys;
    account = {
      id: "default",
      label: t("connectApps.detail.defaultAccount"),
      detail: keys.length ? t(remote ? "mcp.headersSaved" : "mcp.secretsSaved", { keys: keys.join(", ") }) : t("connectApps.detail.noSignIn"),
      status: server.enabled ? "connected" : "off",
    };
  }
  const oauthError = mcp.oauthError[name];
  const count = toolList ? t("connectApps.detail.toolsEnabled", { enabled: toolList.filter((tool) => tool.enabled).length, total: toolList.length })
    : disabled.size ? t("connectApps.detail.toolsOff", { count: disabled.size }) : t("connectApps.detail.toolsAll");
  return {
    item,
    subtitle: remote ? server.url : [server.command, ...server.args].join(" "),
    busy: mcp.busy !== null,
    onUninstall: () => void mcp.remove(server),
    onEdit: () => mcp.startEdit(server),
    onTest: () => void mcp.test(server),
    testing: mcp.busy === `test:${name}`,
    enabled: { value: server.enabled, onToggle: () => void mcp.toggle(server), label: t("mcp.toggleAria", { name, state: t(server.enabled ? "mcp.state.off" : "mcp.state.on") }) },
    accounts: [account],
    accountAction,
    accountExtra: (
      <>
        {remote && server.auth && server.auth !== "none" && server.auth !== "connected" && <McpAuthLine server={server} />}
        {mcp.waiting[name] && (
          <div role="status" className="mt-2 flex items-center gap-2 rounded-lg bg-raised/60 px-3 py-2 text-[12px] text-ink-secondary">
            <Loader2 size={13} className="shrink-0 animate-spin" /> {t("mcp.oauth.waiting")}
          </div>
        )}
        {mcp.clientDraft[name] && (
          <McpClientForm
            draft={mcp.clientDraft[name]!}
            disabled={mcp.busy !== null}
            onChange={(next) => mcp.setClientDraft((current) => ({ ...current, [name]: next }))}
            onCancel={() => mcp.forgetClientDraft(name)}
            onSubmit={() => void mcp.signIn(server)}
          />
        )}
        {oauthError && (
          <div role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">
            {typeof oauthError === "string" ? oauthError : t(oauthError.key, oauthError.params)}
          </div>
        )}
        {server.managedBy && <p className="mt-2 text-[11.5px] text-ink-secondary">{t("policy.mcpBlocked", { organization: server.managedBy })}</p>}
      </>
    ),
    tools: {
      list: toolList,
      loading: mcp.busy === `test:${name}`,
      error: probe && !probe.ok ? probe.error : undefined,
      note: t("connectApps.detail.toolsNote"),
      onToggle: (tool, enabled) => {
        const next = new Set(disabled);
        if (enabled) next.delete(tool);
        else next.add(tool);
        void mcp.setDisabledTools(server, [...next].sort());
      },
      onLoad: () => void mcp.test(server),
    },
    details: [
      { label: t("connectApps.detail.source"), value: pluginSourceLabel(item.source) },
      { label: t("connectApps.detail.transport"), value: remote ? (server.type === "sse" ? "SSE" : "HTTP") : "stdio" },
      { label: remote ? t("connectApps.detail.url") : t("connectApps.detail.command"), value: remote ? server.url : [server.command, ...server.args].join(" "), mono: true },
      { label: t("connectApps.detail.tools"), value: count },
    ],
    children: (
      <>
        {remote && isWhopServer(server) && <p className="rounded-2xl border border-border bg-card px-4 py-3 text-[12px] leading-relaxed text-ink-secondary sm:px-5">{t("whop.notice")}</p>}
        <McpMessages mcp={mcp} />
        {mcp.editing === name && <McpServerEditor mcp={mcp} />}
      </>
    ),
  };
}

/** A marketplace plugin: what it brought, each one a link to its own page. */
function pluginDetail(item: PluginItem, { items, marketplaces, installing, openItem, uninstallPlugin, scope, botCard }: DetailContext): DetailBase {
  const [plugin, marketplace] = item.id.split("@") as [string, string];
  const market = marketplaces?.find((entry) => entry.name === marketplace);
  const entry = market?.plugins.find((candidate) => candidate.name === plugin);
  const children = items.filter((candidate) => candidate.parent === item.key);
  const subtitle = `${market?.source ?? marketplace}${item.version ? ` · ${item.version}` : ""}`;
  // For a bot the page is that bot's install: the card says what it brings.
  if (scope === "bot") {
    return {
      item,
      subtitle,
      busy: installing !== null,
      details: [
        { label: t("connectApps.detail.source"), value: marketplace },
        ...(item.version ? [{ label: t("connectApps.detail.version"), value: item.version }] : []),
      ],
      children: (
        <>
          {item.description && <p className="px-1 text-[12.5px] leading-relaxed text-ink-secondary">{item.description}</p>}
          {botCard}
        </>
      ),
    };
  }
  return {
    item,
    subtitle,
    busy: installing !== null,
    onUninstall: () => uninstallPlugin(item),
    details: [
      { label: t("connectApps.detail.source"), value: marketplace },
      ...(item.version ? [{ label: t("connectApps.detail.version"), value: item.version }] : []),
      { label: t("connectApps.plugin.connectors"), value: String(entry?.servers.length ?? 0) },
      { label: t("connectApps.filter.skills"), value: String(entry?.skills.length ?? 0) },
    ],
    children: (
      <>
        {botCard}
        <section className="rounded-2xl border border-border bg-card px-4 py-3.5 sm:px-5">
          <h3 className="mb-1 text-[13px] font-semibold text-ink">{t("connectApps.plugin.brings")}</h3>
          {item.description && <p className="mb-2 text-[12.5px] leading-relaxed text-ink-secondary">{item.description}</p>}
          {children.length === 0 ? (
            <p className="text-[12px] text-ink-secondary">{t("connectApps.plugin.bringsNothing")}</p>
          ) : (
            <ul className="divide-y divide-hairline/60">
              {children.map((child) => (
                <li key={child.key}>
                  <button type="button" onClick={() => openItem(child)} className="flex w-full items-center gap-3 py-2 text-left hover:text-ink">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] text-ink">{child.name}</span>
                      <span className="block truncate text-[11px] text-ink-secondary">{child.kind === "skill" ? t("connectApps.filter.skills") : t("connectApps.filter.mcp")}</span>
                    </span>
                    <PluginStatusLabel status={child.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11.5px] text-ink-secondary">{t("connectApps.plugin.note")}</p>
        </section>
      </>
    ),
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
