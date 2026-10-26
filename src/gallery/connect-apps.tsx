/** Isolated gallery for Playwright screenshots of Connect apps and Browse
 * bots in their window (the presentational views with sample rows, no
 * server). Not shipped in the app.
 * ?view=apps|apps-section|bots|bots-in-apps|manage&skin=<id>&lang=<code>
 * manage: the real Connect apps panel (PluginsPanel) on a stand-in /api
 * shaped like an organization member's (2026-10-26): GitHub added by hand
 * and again by a marketplace plugin, five plugins, the person's Claude
 * account with Gmail, Google Drive and Google Calendar, a Grok account.
 * Names are neutral. scripts/capture-connect-apps-manage.mjs clicks
 * through Manage's four tabs. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { X } from "lucide-react";
import { ConnectAppsView } from "../components/plugins/ConnectAppsView";
import { BotCatalogView } from "../components/bot-catalog/BotCatalogView";
import { CATEGORY_MODAL, cardActionClass } from "../components/category-modal";
import { ScopeToggle } from "../components/plugins/ScopeToggle";
import { PluginsPanel } from "../components/PluginsPanel";
import { catalogCategories, catalogSections, catalogTemplates } from "../lib/bot-catalog";
import type { PluginFilter, PluginItem } from "../lib/plugins-model";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const app = (id: string, name: string, description: string, category: PluginItem["category"], recommended = false): PluginItem => ({
  key: `featured:${id}`, kind: "featured", id, name, description, category, installed: false, status: "available", action: "connect", source: "catalog", recommended,
});

const ITEMS: PluginItem[] = [
  app("notion", "Notion", "Pages, bases de données et notes d'équipe", "productivity", true),
  app("linear", "Linear", "Billets, projets et cycles", "productivity", true),
  app("slack", "Slack", "Canaux, messages et fils", "communication", true),
  app("gmail", "Gmail", "Courriels et brouillons", "communication"),
  app("asana", "Asana", "Tâches et projets", "productivity"),
  app("trello", "Trello", "Tableaux et cartes", "productivity"),
  app("todoist", "Todoist", "Listes de tâches", "productivity"),
  app("airtable", "Airtable", "Bases et vues", "productivity"),
  app("clickup", "ClickUp", "Tâches, documents et objectifs", "productivity"),
  app("teams", "Microsoft Teams", "Conversations et réunions", "communication"),
  app("zoom", "Zoom", "Réunions et enregistrements", "communication"),
  app("figma", "Figma", "Fichiers de design et commentaires", "design"),
  app("github", "GitHub", "Dépôts, PR et billets", "code"),
];

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className={CATEGORY_MODAL.backdrop}>
      <div role="dialog" aria-modal="true" className={CATEGORY_MODAL.frame}>
        <div className={CATEGORY_MODAL.content}>
          <button type="button" aria-label="Fermer" className={CATEGORY_MODAL.close}><X size={18} /></button>
          {children}
        </div>
      </div>
    </div>
  );
}

const CONNECT = <button type="button" className={cardActionClass("quiet")}>Connecter</button>;
const crumbToApps = [{ label: t("connectApps.title"), onSelect: () => {} }];

/** Connect apps' home, or (section) Productivity opened alone with View all. */
function Apps({ section }: { section?: boolean }) {
  const [filter, setFilter] = useState<PluginFilter>("all");
  const [search, setSearch] = useState("");
  return (
    <Frame>
      <ConnectAppsView
        items={ITEMS}
        loading={false}
        search={search}
        onSearch={setSearch}
        filter={section ? "productivity" : filter}
        onFilter={setFilter}
        onOpenManage={() => {}}
        onBrowseBots={() => {}}
        onViewAll={() => {}}
        onOpenItem={() => {}}
        renderAction={() => CONNECT}
        subpage={section ? { title: t("connectApps.filter.productivity"), trail: crumbToApps, onBack: () => {} } : undefined}
        scope={<ScopeToggle scope="workspace" botName="Rocket" onScope={() => {}} />}
      />
    </Frame>
  );
}

const TEMPLATES = catalogTemplates([]);

/** Browse Bots alone, or (inApps) opened from Connect apps in its window. */
function Bots({ inApps }: { inApps?: boolean }) {
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const sections = catalogSections({ organization: true, entries: [] }, TEMPLATES, { category, query, showArchived: false, app: null });
  return (
    <Frame>
      <BotCatalogView
        trail={inApps ? crumbToApps : undefined}
        organization
        categories={catalogCategories(sections.flatMap((entry) => entry.items))}
        category={category}
        onCategory={setCategory}
        query={query}
        onQuery={setQuery}
        sections={sections}
        expanded={null}
        onExpand={() => {}}
        showArchived={false}
        onShowArchived={() => {}}
        hasArchived={false}
        creatorAvatar={() => undefined}
        onOpen={() => {}}
        renderAction={() => <button type="button" className={cardActionClass()}>{t("botCatalog.action.use")}</button>}
        onTemplateTool={() => {}}
      />
    </Frame>
  );
}

// ?view=manage: the stand-in /api an organization member's panel reads.
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MANAGE_API: Record<string, unknown> = {
  "/api/instances": { instances: [
    { instanceId: "claude-main", driverKind: "claudeAgent", displayName: "Claude", access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "person@example.com", method: "login" } } },
    { instanceId: "grok-main", driverKind: "grokAgent", displayName: "Grok", access: "subscription", snapshot: { state: "available", authenticated: true, account: { method: "login" } } },
  ] },
  "/api/config": { viewer: { role: "member", principalId: "p-1" }, features: {} },
  "/api/bots": { bots: [
    { id: "bot-a", name: "Rocket", instanceId: "claude-main", model: "default", ownerUserId: "p-1", threads: [], messages: [] },
    { id: "bot-b", name: "Atlas", instanceId: "grok-main", model: "default", ownerUserId: "p-1", mcpServers: ["twilio-docs"], threads: [], messages: [] },
  ], groups: [], sections: [] },
  "/api/org": {
    org: { name: "Example Org", identity: { kind: "perspicax", issuer: "https://px.example.test" } },
    link: { state: "ok" }, viewerRole: "member", settings: { pluginMarketplaces: { mode: "any" }, github: { clientId: null, fromEnvironment: false } },
  },
  "/api/me/connections": { github: { state: "none", deviceFlow: false }, servers: [], sandbox: true },
  "/api/mcp/servers": { servers: [
    { name: "twilio-docs", type: "http", url: "https://mcp.twilio.com/docs", enabled: true, source: "twilio", headerKeys: [], auth: "none" },
    { name: "github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, headerKeys: ["Authorization"], auth: "none" },
    { name: "github-github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, source: "claude-plugins-official", headerKeys: ["Authorization"], auth: "none" },
  ], reserved: [] },
  "/api/marketplaces": { marketplaces: [
    { name: "claude-plugins-official", source: "anthropics/claude-plugins-official", visibility: "org", plugins: [
      { name: "github", description: "GitHub's MCP server", installed: true, servers: ["github-github"], skills: [], category: "development" },
      { name: "frontend-design", description: "Distinctive interfaces", installed: true, servers: [], skills: ["frontend-design"], category: "design" },
      { name: "code-review", description: "Reviews a pull request", installed: true, servers: [], skills: ["code-review"], category: "development", updateAvailable: true, installedVersion: "1.0.0", version: "1.1.0" },
      { name: "pdf-tools", description: "Read and fill PDF forms", installed: false, servers: [], skills: ["pdf"], category: "productivity" },
      { name: "sentry", description: "Errors and releases", installed: false, servers: ["sentry"], skills: [], category: "monitoring" },
    ] },
    { name: "example-ops", source: "example-org/ops-marketplace", visibility: "org", mine: true, plugins: [
      { name: "ops-flow", description: "Service desk routines", installed: true, servers: [], skills: ["triage", "dispatch", "time-review"], category: "productivity" },
      { name: "ops-flow-tenant", description: "This organization's boards and rules", installed: true, servers: [], skills: ["tenant-rules"], category: "productivity" },
    ] },
  ] },
  "/api/skills-library": { skills: [
    { name: "frontend-design", description: "Distinctive interfaces", source: "claude-plugins-official", enabled: true },
    { name: "code-review", description: "Reviews a pull request", source: "claude-plugins-official", enabled: true },
    { name: "triage", description: "", source: "example-ops", enabled: true },
    { name: "dispatch", description: "", source: "example-ops", enabled: true },
    { name: "time-review", description: "", source: "example-ops", enabled: true },
    { name: "tenant-rules", description: "", source: "example-ops", enabled: true },
    { name: "weekly-summary", description: "Friday recap of my threads", source: "local-import", enabled: true },
  ] },
  "/api/plugins/search": { featured: [
    { id: "notion", name: "Notion", description: "Pages, databases and notes", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", site: "notion.so", auth: "oauth", category: "productivity" },
    { id: "linear", name: "Linear", description: "Issues, projects and cycles", url: "https://mcp.linear.app/mcp", domain: "mcp.linear.app", site: "linear.app", auth: "oauth", category: "productivity" },
    { id: "slack", name: "Slack", description: "Channels and messages", url: "https://mcp.slack.com/mcp", domain: "mcp.slack.com", site: "slack.com", auth: "oauth", category: "communication" },
    { id: "figma", name: "Figma", description: "Design files and comments", url: "https://mcp.figma.com/mcp", domain: "mcp.figma.com", site: "figma.com", auth: "oauth", category: "design" },
    { id: "stripe", name: "Stripe", description: "Payments and customers", url: "https://mcp.stripe.com", domain: "mcp.stripe.com", site: "stripe.com", auth: "oauth", category: "finance" },
  ], results: [], nextCursor: null, registryAvailable: true },
  "/api/me/harness-connectors": { manageUrl: "https://claude.ai/customize/connectors", canManage: true, enabled: true, claude: { available: true, connectors: [
    { name: "Gmail", status: "connected" },
    { name: "Google Drive", status: "connected" },
    { name: "Google Calendar", status: "connected" },
    { name: "Canva", status: "needs_auth" },
  ] }, codex: { available: false } },
  "/api/pages": { pages: [] },
  "/api/routines": { routines: [], runs: [] },
  "/api/webhooks": { webhooks: [], attempts: [] },
};

if (params.get("view") === "manage") {
  const realFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
    const body = MANAGE_API[url.pathname];
    if (body !== undefined && (!init?.method || init.method === "GET")) return json(body);
    if (url.pathname.startsWith("/api/bots/") && url.pathname.endsWith("/plugins")) return json({ error: "not here" }, 404);
    return json({ error: "gallery" }, 404);
  }) as typeof window.fetch;
}

function Manage() {
  return <PluginsPanel />;
}

const VIEWS: Record<string, () => React.ReactNode> = {
  manage: () => <Manage />,
  apps: () => <Apps />,
  "apps-section": () => <Apps section />,
  bots: () => <Bots />,
  "bots-in-apps": () => <Bots inApps />,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="min-h-screen bg-app text-ink">{(VIEWS[params.get("view") ?? "apps"] ?? VIEWS.apps!)()}</div>
    </StoreProvider>
  </StrictMode>,
);
