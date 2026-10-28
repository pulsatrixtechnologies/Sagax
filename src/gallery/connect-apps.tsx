/** Isolated gallery for Playwright screenshots of Connect apps and Browse
 * bots in their window (no server). Not shipped in the app.
 * ?view=manage|org-settings|bots|bots-in-apps&skin=<id>&lang=<code>&role=member|admin
 * manage: the real Connect apps panel (PluginsPanel) on a stand-in /api
 * shaped like an organization member's (2026-10-26): GitHub added by hand
 * and again by a marketplace plugin, five plugins, the person's Claude
 * account with Gmail, Google Drive and Google Calendar, a Grok account.
 * Names are neutral. role=admin: the same person as an organization admin
 * (the organization's sources and access). org-settings: Settings >
 * Organization for that person. settings-subpage: a Settings sub-page in
 * the same window size, the navigation Connect apps' pages follow
 * (2026-10-28). The bot Rocket has its own plugins (For Rocket).
 * scripts/capture-connect-apps-manage.mjs clicks through the tabs. */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { X } from "lucide-react";
import { BotCatalogView } from "../components/bot-catalog/BotCatalogView";
import { CATEGORY_MODAL, cardActionClass } from "../components/category-modal";
import { PluginsPanel } from "../components/PluginsPanel";
import { PerspicaxOrgSettings } from "../components/PerspicaxOrgSettings";
import { SettingsSubPage } from "../components/SettingsSubPage";
import type { PerspicaxOrg } from "../lib/perspicax-org";
import { catalogCategories, catalogSections, catalogTemplates } from "../lib/bot-catalog";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

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

const crumbToApps = [{ label: t("connectApps.title"), onSelect: () => {} }];

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

// ?view=manage: the stand-in /api an organization member's panel reads
// (&role=admin: an organization admin's).
const admin = params.get("role") === "admin";
const ORG: PerspicaxOrg = {
  org: { name: "Example Org", identity: { kind: "perspicax", issuer: "https://px.example.test" } },
  link: { state: "ok" }, viewerRole: admin ? "admin" : "member",
  settings: {
    pluginMarketplaces: { mode: "list", allow: ["example-org/*", "anthropics/claude-plugins-official"] },
    github: { clientId: "Ov23liExample0001", fromEnvironment: false },
    githubTokens: [{ id: "gt_0000000000000001", label: "Private repositories", hint: "4f2a" }],
  },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const MANAGE_API: Record<string, unknown> = {
  "/api/instances": { instances: [
    { instanceId: "claude-main", driverKind: "claudeAgent", displayName: "Claude", access: "subscription", snapshot: { state: "available", authenticated: true, account: { email: "person@example.com", method: "login" } } },
    { instanceId: "grok-main", driverKind: "grokAgent", displayName: "Grok", access: "subscription", snapshot: { state: "available", authenticated: true, account: { method: "login" } } },
  ] },
  "/api/config": { viewer: { role: admin ? "admin" : "member", principalId: "p-1" }, features: {} },
  "/api/bots": { bots: [
    { id: "bot-a", name: "Rocket", instanceId: "claude-main", model: "default", ownerUserId: "p-1", threads: [], messages: [] },
    { id: "bot-b", name: "Atlas", instanceId: "grok-main", model: "default", ownerUserId: "p-1", mcpServers: ["twilio-docs"], threads: [], messages: [] },
  ], groups: [], sections: [] },
  "/api/org": ORG,
  // Sources > GitHub: one list of credentials (2026-10-28)
  "/api/me/github/credentials": { canManageOrg: admin, deviceFlow: true, credentials: [
    { id: "gt_0000000000000011", label: "Second GitHub organization", hint: "9c1d", owner: "mine", chosenBy: 1 },
    { id: "gt_0000000000000001", label: "Private repositories", hint: "4f2a", owner: "org", chosenBy: 0 },
  ] },
  "/api/me/connections": { github: { state: "none", deviceFlow: true }, servers: [
    { name: "notes", kind: "remote", type: "http", url: "https://mcp.notion.com/mcp", domain: "mcp.notion.com", auth: "oauth", tokenConfigured: false, enabled: true, addedAt: 1, authState: "connected" },
  ], sandbox: true },
  "/api/mcp/servers": { servers: [
    { name: "twilio-docs", type: "http", url: "https://mcp.twilio.com/docs", enabled: true, source: "twilio", headerKeys: [], auth: "none" },
    { name: "github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, headerKeys: ["Authorization"], auth: "none" },
    { name: "github-github", type: "http", url: "https://api.githubcopilot.com/mcp/", enabled: true, source: "claude-plugins-official", headerKeys: ["Authorization"], auth: "none" },
  ], reserved: [] },
  "/api/marketplaces": { marketplaces: [
    { name: "claude-plugins-official", source: "anthropics/claude-plugins-official", visibility: "org", plugins: [
      { name: "github", description: "GitHub's MCP server", installed: true, servers: ["github-github"], skills: [], category: "development" },
      { name: "frontend-design", description: "Distinctive interfaces", installed: true, servers: [], skills: ["frontend-design"], category: "design", homepage: "https://claude.com/plugins" },
      { name: "code-review", description: "Reviews a pull request", installed: true, servers: [], skills: ["code-review"], category: "development", updateAvailable: true, installedVersion: "1.0.0", version: "1.1.0", homepage: "https://github.com/anthropics/claude-plugins-official" },
      { name: "pdf-tools", description: "Read and fill PDF forms", installed: false, servers: [], skills: ["pdf"], category: "productivity" },
      { name: "sentry", description: "Errors and releases", installed: false, servers: ["sentry"], skills: [], category: "monitoring" },
    ] },
    { name: "example-ops", source: "example-org/ops-marketplace", visibility: "org", mine: true, hasToken: true, credential: { chosen: { id: "gt_0000000000000011", label: "Second GitHub organization", owner: "mine" }, used: { via: "credential", label: "Second GitHub organization", at: 1 } }, plugins: [
      { name: "ops-flow", description: "Service desk routines", installed: true, servers: [], skills: ["triage", "dispatch", "time-review"], category: "productivity", homepage: "https://www.wikipedia.org" },
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
  // Rocket's own plugins (the "For Rocket" scope): Code Review on it, GitHub not
  "/api/bots/bot-a/plugins": {
    marketplaces: [{ name: "claude-plugins-official", source: "anthropics/claude-plugins-official", visibility: "org", addedAt: 1, updatedAt: 1, plugins: [
      { name: "github", description: "GitHub's MCP server", installed: false, external: false, category: "development", contents: { agents: [], commands: [], skills: [] } },
      { name: "code-review", description: "Reviews a pull request", installed: true, external: false, category: "development", contents: { agents: ["reviewer"], commands: ["review"], skills: ["code-review"] } },
    ] }],
    plugins: [{ key: "code-review@claude-plugins-official", name: "code-review", marketplace: "claude-plugins-official", enabled: true, removed: [], declaredMcpServers: [] }],
    policy: { mode: "any" }, engine: { loadsPlugins: true }, canChange: true,
  },
  "/api/routines": { routines: [], runs: [] },
  "/api/webhooks": { webhooks: [], attempts: [] },
};

if (["manage", "org-settings", "settings-subpage"].includes(params.get("view") ?? "manage")) {
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

/** A Settings sub-page (General > About me) in Connect apps' window size:
 * the navigation the panel's own pages follow. */
function SettingsSubpageSample() {
  return (
    <div className={CATEGORY_MODAL.backdrop}>
      <div role="dialog" aria-label="Settings" className={CATEGORY_MODAL.frame}>
        <div className={CATEGORY_MODAL.content}>
          <button type="button" aria-label="Close" className={CATEGORY_MODAL.close}><X size={18} /></button>
          <SettingsSubPage pageId="about-me" sectionLabel={t("settings.section.general")} title="About me" onBack={() => {}}>
            <div className="rounded-[14px] border-[0.5px] border-border p-4 text-[13px] text-ink-secondary">Text a bot reads about you.</div>
          </SettingsSubPage>
        </div>
      </div>
    </div>
  );
}

/** Settings > Organization as the settings window draws it. */
function OrgSettings() {
  return (
    <div className="mx-auto max-w-[760px] px-6 py-8" data-gallery-org-settings>
      <PerspicaxOrgSettings org={ORG} onChanged={() => {}} />
    </div>
  );
}

const VIEWS: Record<string, () => React.ReactNode> = {
  manage: () => <Manage />,
  "org-settings": () => <OrgSettings />,
  "settings-subpage": () => <SettingsSubpageSample />,
  bots: () => <Bots />,
  "bots-in-apps": () => <Bots inApps />,
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <div className="min-h-screen bg-app text-ink">{(VIEWS[params.get("view") ?? "manage"] ?? VIEWS.manage!)()}</div>
    </StoreProvider>
  </StrictMode>,
);
