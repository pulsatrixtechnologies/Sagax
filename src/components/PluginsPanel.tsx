// Plugins: one panel in three views, after the "Connect apps" screens people
// know from desktop assistants.
//
//   - Connect apps (main): every connected app, MCP server, catalog plugin
//     and skill in one list, with search across all of them, category chips
//     (Connected apps / MCP servers / Skills are chips too) and a section per
//     category. "N connected" opens Manage.
//   - Manage: installed plugins, private skills, Add manually / Paste config
//     for MCP servers, and the settings that apply to all of them.
//   - Detail: one plugin's accounts, tools (a switch per MCP tool, applied to
//     every bot) and details, with Uninstall.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, TriangleAlert } from "lucide-react";

import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { managedConnectorUnavailableReason } from "../../shared/connector-availability";
import type { SkillsLibrarySkillWire } from "../../shared/wire";
import { buildPluginItems, marketplacePluginKey, type PluginFilter, type PluginItem } from "@/lib/plugins-model";
import {
  ClaudeMcpSwitch,
  McpAuthLine,
  McpClientForm,
  McpImportForm,
  McpMessages,
  McpServerEditor,
  isRemoteMcpListing,
  useMcpServers,
  type McpServerListing,
} from "./McpServersPanel";
import { HarnessConnectorsSection } from "./HarnessConnectorsSection";
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

export * from "./plugins/connected-apps";

interface MarketplaceListing {
  name: string;
  source: string;
  ref?: string;
  description?: string;
  plugins: Array<{ name: string; description?: string; version?: string; category?: string; installed: boolean; servers: string[]; skills: string[] }>;
}

interface FeaturedListing { id: string; name: string; description: string; url: string; domain: string; auth: string; installed?: boolean }

type Page = { page: "main" } | { page: "manage" } | { page: "detail"; key: string; from: "main" | "manage" };

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
  const [filter, setFilter] = useState<PluginFilter>(state.pluginsSurface === "mcp" ? "mcp" : "all");
  const [featured, setFeatured] = useState<FeaturedListing[] | null>(null);
  const [skills, setSkills] = useState<SkillsLibrarySkillWire[] | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [aliasDraft, setAliasDraft] = useState("");
  const [marketplaces, setMarketplaces] = useState<MarketplaceListing[] | null>(null);
  const [marketBusy, setMarketBusy] = useState<string | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [panelNotice, setPanelNotice] = useState<string | null>(null);

  const loadFeatured = useCallback(() => api("/api/plugins/search")
    .then((result) => setFeatured(result.featured ?? []))
    .catch(() => setFeatured([])), []);
  const loadSkills = useCallback(() => api("/api/skills-library")
    .then((result) => setSkills(result.skills ?? []))
    // the skills library is an option: off, there are no private skills
    .catch(() => setSkills([])), []);
  const loadMarketplaces = useCallback(() => api("/api/marketplaces")
    .then((result) => setMarketplaces(result.marketplaces ?? []))
    // only an admin or this computer's owner manages marketplaces
    .catch(() => setMarketplaces([])), []);
  useEffect(() => {
    void loadFeatured();
    void loadSkills();
    void loadMarketplaces();
  }, [loadFeatured, loadSkills, loadMarketplaces]);

  const close = useCallback(() => dispatch({ type: "togglePlugins", open: false }), [dispatch]);
  const back = useCallback(() => setPage((current) => current.page === "detail" ? { page: current.from } : { page: "main" }), []);

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

  const items = useMemo(() => buildPluginItems({
    cards: apps.cards,
    status: apps.status,
    servers: mcp.servers,
    featured,
    skills,
    marketplaces,
  }), [apps.cards, apps.status, mcp.servers, featured, skills, marketplaces]);

  const refreshAll = () => {
    void apps.loadConnectionInventory(true);
    void mcp.load(true);
    void loadFeatured();
    void loadSkills();
    void loadMarketplaces();
  };
  const refreshing = apps.refreshing || mcp.busy === "load";

  const openItem = (item: PluginItem) => setPage((current) => ({ page: "detail", key: item.key, from: current.page === "manage" ? "manage" : "main" }));

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
  const addMarketplace = (source: string, ref: string) => marketAction("add", async () => {
    const result = await api("/api/marketplaces", { method: "POST", body: JSON.stringify({ source, ...(ref ? { ref } : {}) }) });
    setMarketplaces(result.marketplaces ?? []);
  });
  const refreshMarketplace = (name: string) => void marketAction(`refresh:${name}`, async () => {
    const result = await api(`/api/marketplaces/${encodeURIComponent(name)}/refresh`, { method: "POST", body: "{}" });
    setMarketplaces(result.marketplaces ?? []);
  });
  const removeMarketplace = (name: string) => {
    if (!window.confirm(t("connectApps.market.removeConfirm", { name }))) return;
    void marketAction(`remove:${name}`, async () => {
      const result = await api(`/api/marketplaces/${encodeURIComponent(name)}`, { method: "DELETE" });
      setMarketplaces(result.marketplaces ?? []);
      if (filter === `source:${name}`) setFilter("all");
    });
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
    if (item.kind === "plugin") {
      if (item.installed) return null;
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

  const renderBelow = (item: PluginItem) => item.kind === "app" && apps.aliasSlug === item.id && !apps.status[item.id]?.pending
    ? <AliasForm apps={apps} slug={item.id} name={item.name} draft={aliasDraft} onDraft={setAliasDraft} hasAccounts={Boolean(apps.status[item.id]?.accounts?.length)} />
    : null;

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

  const detailItem = page.page === "detail" ? items.find((item) => item.key === page.key) : undefined;
  // An item that went away (uninstalled, or removed elsewhere) leaves its page.
  const detailMissing = page.page === "detail" && !detailItem && mcp.servers !== null && apps.cards !== null && skills !== null && marketplaces !== null;
  useEffect(() => {
    if (detailMissing) back();
  }, [detailMissing, back]);

  let content;
  if (page.page === "manage") {
    content = (
      <ManageView
        items={items}
        countLabel={(item) => countLabel(item, apps, mcp.servers, marketplaces)}
        sourceLabel={pluginSourceLabel}
        onBack={back}
        onClose={close}
        onOpenItem={openItem}
        onAddManually={mcp.startAdd}
        onPasteConfig={mcp.toggleImport}
        addDisabled={mcp.busy !== null || mcp.restricted}
        addTitle={mcp.restricted && mcp.policy ? t("policy.managedBy", { organization: mcp.policy.organizationName }) : undefined}
        refreshing={refreshing}
        onRefresh={refreshAll}
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
          marketplaces={marketplaces}
          busy={marketBusy}
          error={marketError}
          onAdd={addMarketplace}
          onRefresh={refreshMarketplace}
          onRemove={removeMarketplace}
        />
        <section className="mt-6">
          <h3 className="mb-2 text-[13px] font-semibold text-ink">{t("connectApps.manage.settings")}</h3>
          <ClaudeMcpSwitch />
        </section>
        <section className="mt-6">
          <HarnessConnectorsSection placement="settings" />
        </section>
      </ManageView>
    );
  } else if (page.page === "detail" && detailItem) {
    content = (
      <PluginDetailView
        {...detailProps(detailItem, { apps, mcp, skills, aliasDraft, setAliasDraft, reloadSkills: loadSkills, bots: state.bots, instances: state.instances,
          items, marketplaces, installing, openItem, uninstallPlugin: (item) => void uninstallPlugin(item),
          openBotAccess: (botId) => {
            close();
            dispatch({ type: "toggleSettings", open: true, botId, section: "access" });
          } })}
        onBack={back}
        onClose={close}
      />
    );
  } else if (page.page === "detail") {
    content = (
      <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-ink-secondary">
        <Loader2 size={14} className="animate-spin" /> {t("connectors.loadingCatalog")}
      </div>
    );
  } else {
    content = (
      <ConnectAppsView
        items={items}
        loading={apps.cards === null || mcp.servers === null}
        search={search}
        onSearch={setSearch}
        filter={filter}
        onFilter={(next) => {
          setFilter(next);
          if (next === "mcp" || next === "apps" || next === "all") {
            dispatch({ type: "togglePlugins", open: true, surface: next === "mcp" ? "mcp" : "apps" });
          }
        }}
        sourceLabel={pluginSourceLabel}
        extraSources={(marketplaces ?? []).map((market) => market.name)}
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
  const pending = serviceStatus?.pending;
  const failed = Boolean(serviceStatus?.status && /^(expired|failed)$/i.test(serviceStatus.status));
  const accounts = serviceStatus?.accounts ?? [];
  const busy = apps.busySlug === slug;
  const unavailable = Boolean(managedConnectorUnavailableReason(apps.mode, slug));
  return (
    <button
      type="button"
      disabled={!apps.configured || apps.inventoryPhase !== "ready" || busy || unavailable}
      title={unavailable ? t("connectors.selfHostOnlyReason") : undefined}
      onClick={() => apps.primaryAction(slug)}
      className="ui-button min-w-[76px] disabled:opacity-40"
    >
      {unavailable ? t("connectors.selfHostOnly") : busy ? <Loader2 size={13} className="mx-auto animate-spin" /> : connectorActionLabel(apps.inventoryPhase, {
        busy,
        included: false,
        canContinue: Boolean(pending && apps.pendingUrls[slug]),
        pending,
        hasAccounts: accounts.length > 0,
        failed,
      })}
    </button>
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

/** Installed card subline: what the plugin brings. */
function countLabel(item: PluginItem, apps: ConnectedApps, servers: McpServerListing[] | null, marketplaces: MarketplaceListing[] | null): string {
  if (item.kind === "plugin") {
    const [plugin, marketplace] = item.id.split("@");
    const entry = marketplaces?.find((market) => market.name === marketplace)?.plugins.find((candidate) => candidate.name === plugin);
    return t("connectApps.count.plugin", { servers: entry?.servers.length ?? 0, skills: entry?.skills.length ?? 0 });
  }
  if (item.kind === "app") {
    const count = apps.status[item.id]?.accounts?.length ?? 0;
    if (count === 0) return t("connectApps.count.connectorOne");
    return count === 1 ? t("connectApps.count.accountOne") : t("connectApps.count.accountMany", { count });
  }
  const server = servers?.find((entry) => entry.name === item.id);
  if (server && isRemoteMcpListing(server)) return t("connectApps.count.mcpRemote", { type: server.type === "sse" ? "SSE" : "HTTP" });
  return t("connectApps.count.mcpLocal");
}

interface DetailContext {
  apps: ConnectedApps;
  mcp: ReturnType<typeof useMcpServers>;
  skills: SkillsLibrarySkillWire[] | null;
  aliasDraft: string;
  setAliasDraft: (value: string) => void;
  reloadSkills: () => Promise<unknown>;
  bots: ReturnType<typeof useStore>["state"]["bots"];
  instances: ReturnType<typeof useStore>["state"]["instances"];
  openBotAccess: (botId: string) => void;
  items: PluginItem[];
  marketplaces: MarketplaceListing[] | null;
  installing: string | null;
  openItem: (item: PluginItem) => void;
  uninstallPlugin: (item: PluginItem) => void;
}

type DetailBase = Omit<PluginDetailProps, "onBack" | "onClose">;

function detailProps(item: PluginItem, context: DetailContext): DetailBase {
  if (item.kind === "app") return appDetail(item, context);
  if (item.kind === "skill") return skillDetail(item, context);
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
            <span>{apps.pendingUrls[slug] ? t("connectors.finishSetup") : t("connectors.finishSetupOrDisconnect")}</span>
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
        <McpMessages mcp={mcp} />
        {mcp.editing === name && <McpServerEditor mcp={mcp} />}
      </>
    ),
  };
}

/** A marketplace plugin: what it brought, each one a link to its own page. */
function pluginDetail(item: PluginItem, { items, marketplaces, installing, openItem, uninstallPlugin }: DetailContext): DetailBase {
  const [plugin, marketplace] = item.id.split("@") as [string, string];
  const market = marketplaces?.find((entry) => entry.name === marketplace);
  const entry = market?.plugins.find((candidate) => candidate.name === plugin);
  const children = items.filter((candidate) => candidate.parent === item.key);
  return {
    item,
    subtitle: `${market?.source ?? marketplace}${item.version ? ` · ${item.version}` : ""}`,
    busy: installing !== null,
    onUninstall: () => uninstallPlugin(item),
    details: [
      { label: t("connectApps.detail.source"), value: marketplace },
      ...(item.version ? [{ label: t("connectApps.detail.version"), value: item.version }] : []),
      { label: t("connectApps.plugin.connectors"), value: String(entry?.servers.length ?? 0) },
      { label: t("connectApps.filter.skills"), value: String(entry?.skills.length ?? 0) },
    ],
    children: (
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
    ),
  };
}

function skillDetail(item: PluginItem, { skills, reloadSkills }: DetailContext): DetailBase {
  const skill = skills?.find((entry) => entry.name === item.id);
  return {
    item,
    subtitle: pluginSourceLabel(item.source),
    busy: false,
    details: [
      { label: t("connectApps.detail.source"), value: pluginSourceLabel(item.source) },
      { label: t("connectApps.detail.usedBy"), value: skill?.assignedBots.length ? skill.assignedBots.map((bot) => bot.name).join(", ") : t("connectApps.detail.usedByNone") },
      ...(skill?.version ? [{ label: t("connectApps.detail.version"), value: skill.version }] : []),
    ],
    children: <SkillBody name={item.id} enabled={item.status !== "off"} description={item.description} warnings={skill?.warnings ?? []} onChanged={reloadSkills} />,
  };
}

/** A skill's text, read before it is turned on: turning it on is the review. */
function SkillBody({ name, enabled, description, warnings, onChanged }: { name: string; enabled: boolean; description: string; warnings: string[]; onChanged: () => Promise<unknown> }) {
  const [text, setText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api(`/api/skills-library/${encodeURIComponent(name)}`)
      .then((result) => !cancelled && setText(typeof result.text === "string" ? result.text : ""))
      .catch((cause) => !cancelled && setError(cause instanceof Error ? cause.message : String(cause)));
    return () => {
      cancelled = true;
    };
  }, [name]);
  const toggle = async () => {
    setSaving(true);
    setError(null);
    try {
      await api(`/api/skills-library/${encodeURIComponent(name)}`, { method: "PATCH", body: JSON.stringify({ enabled: !enabled }) });
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="rounded-2xl border border-border bg-card px-4 py-3.5 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-[12.5px] leading-relaxed text-ink-secondary">{description}</p>
        <button type="button" disabled={saving || text === null} onClick={() => void toggle()} className={enabled ? "ui-button text-[12px]" : "ui-button ui-button-primary text-[12px]"}>
          {saving ? <Loader2 size={13} className="animate-spin" /> : t(enabled ? "connectApps.skill.turnOff" : "connectApps.skill.turnOn")}
        </button>
      </div>
      {!enabled && <p className="mt-2 text-[11.5px] text-ink-secondary">{t("connectApps.skill.reviewHint")}</p>}
      {warnings.length > 0 && <ul className="mt-2 list-disc pl-5 text-[11.5px] text-warning">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      {error && <p role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</p>}
      {text !== null && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-inset px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink">{text}</pre>}
    </section>
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
