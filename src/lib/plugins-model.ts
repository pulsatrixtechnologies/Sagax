// The Plugins panel's one list: connected apps (Composio), MCP servers the
// person added, the reviewed plugin catalog and local skills, read as rows
// of one kind. Pure functions only, so the three views and their tests share
// the same sorting, search and sections.

export type PluginKind = "app" | "mcp" | "featured" | "skill";
export type PluginCategory = "productivity" | "communication" | "design" | "code" | "passwords" | "other";
/** A chip of the main view: everything, a category, a kind, or a source. */
export type PluginFilter = "all" | PluginCategory | "apps" | "mcp" | "skills" | `source:${string}`;
export type PluginStatus = "connected" | "needs_auth" | "pending" | "off" | "available";

export interface PluginItem {
  /** `${kind}:${id}`, unique across the list */
  key: string;
  kind: PluginKind;
  id: string;
  name: string;
  description: string;
  logo?: string | null;
  domain?: string | null;
  category: PluginCategory;
  /** added or connected on this installation */
  installed: boolean;
  status: PluginStatus;
  /** what the row's button does: Add (nothing to sign in to), Connect (an
   * account), or nothing (installed: the row opens the detail page) */
  action: "add" | "connect" | null;
  /** where it came from: "manual", "catalog", "composio", "local" or a
   * marketplace name */
  source: string;
}

/** Words that place an app in a category, matched against its slug, name
 * and domain. Anything unmatched is "other". */
const CATEGORY_WORDS: Array<[PluginCategory, string[]]> = [
  ["passwords", ["1password", "bitwarden", "lastpass", "dashlane", "keeper", "nordpass", "passbolt", "proton pass", "protonpass", "passportal"]],
  ["design", ["figma", "canva", "miro", "adobe", "sketch", "framer", "webflow", "dribbble", "behance", "higgsfield", "invision", "spline"]],
  ["code", ["github", "gitlab", "bitbucket", "sentry", "vercel", "netlify", "supabase", "neon", "cloudflare", "huggingface", "context7", "deepwiki",
    "linear", "jira", "posthog", "datadog", "docker", "heroku", "render", "railway", "circleci", "pagerduty", "postman", "stackoverflow", "npm", "aws", "azure", "gcp"]],
  ["communication", ["slack", "gmail", "outlook", "discord", "teams", "zoom", "telegram", "whatsapp", "twilio", "intercom", "twitter", "reddit",
    "mailchimp", "sendgrid", "front", "zendesk", "freshdesk", "linkedin", "facebook", "instagram", "messenger", "signal", "webex", "meet"]],
  ["productivity", ["notion", "asana", "trello", "todoist", "clickup", "monday", "airtable", "calendar", "drive", "docs", "sheets", "slides",
    "dropbox", "box", "evernote", "calendly", "onedrive", "sharepoint", "confluence", "atlassian", "coda", "obsidian", "zapier", "hubspot",
    "salesforce", "stripe", "paypal", "quickbooks", "xero", "excel", "word", "powerpoint", "office", "basecamp", "wrike", "smartsheet"]],
];

export function categoryFor(...parts: Array<string | null | undefined>): PluginCategory {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  for (const [category, words] of CATEGORY_WORDS) {
    if (words.some((word) => text.includes(word))) return category;
  }
  return "other";
}

export const CATEGORY_ORDER: PluginCategory[] = ["productivity", "communication", "design", "code", "passwords", "other"];

interface AppCard { slug: string; label: string; blurb: string; logo: string | null; domain: string | null; noAuth?: boolean }
interface AppStatus { connected: boolean; pending?: boolean; status?: string; accounts?: Array<{ id: string; status: string }> }
interface McpListing {
  name: string;
  enabled: boolean;
  url?: string;
  command?: string;
  auth?: string;
  managedBy?: string;
  source?: string;
}
interface FeaturedListing { id: string; name: string; description: string; url: string; domain: string; auth: string; installed?: boolean }
interface SkillListing { name: string; description: string; source: string; enabled: boolean }

export interface PluginSources {
  cards?: readonly AppCard[] | null;
  status?: Readonly<Record<string, AppStatus>>;
  servers?: readonly McpListing[] | null;
  featured?: readonly FeaturedListing[] | null;
  skills?: readonly SkillListing[] | null;
  /** Whop, an MCP server connected like an app (#2411): its server's name
   * once added, and whether it is signed in and on. */
  whop?: { description: string; server?: string; connected: boolean } | null;
}

export const WHOP_KEY = "whop:whop";

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Every row, deduplicated: a featured plugin already added shows once, as
 * the MCP server it became. */
export function buildPluginItems(sources: PluginSources): PluginItem[] {
  const items: PluginItem[] = [];
  const status = sources.status ?? {};
  for (const card of sources.cards ?? []) {
    const state = status[card.slug];
    const accounts = state?.accounts ?? [];
    const failed = Boolean(state?.status && /^(expired|failed)$/i.test(state.status));
    const connected = Boolean(card.noAuth) || Boolean(state?.connected) || accounts.length > 0;
    items.push({
      key: `app:${card.slug}`,
      kind: "app",
      id: card.slug,
      name: card.label,
      description: card.blurb,
      logo: card.logo,
      domain: card.domain,
      category: categoryFor(card.slug, card.label, card.domain),
      installed: connected,
      status: state?.pending ? "pending" : failed && !accounts.length ? "needs_auth" : connected ? "connected" : "available",
      action: connected ? null : card.noAuth ? "add" : "connect",
      source: "composio",
    });
  }
  if (sources.whop) {
    items.push({
      key: WHOP_KEY,
      kind: "featured",
      id: "whop",
      name: "Whop",
      description: sources.whop.description,
      domain: "whop.com",
      category: "other",
      installed: sources.whop.connected,
      status: sources.whop.connected ? "connected" : "available",
      action: sources.whop.connected ? null : "connect",
      source: "catalog",
    });
  }
  const serverUrls = new Set<string>();
  for (const server of sources.servers ?? []) {
    if (server.url) serverUrls.add(server.url);
    const domain = hostOf(server.url);
    const needsAuth = server.auth === "required" || server.auth === "expired" || server.auth === "error";
    items.push({
      key: `mcp:${server.name}`,
      kind: "mcp",
      id: server.name,
      name: server.name,
      description: server.url ?? server.command ?? "",
      domain,
      category: categoryFor(server.name, domain),
      installed: true,
      status: !server.enabled || server.managedBy ? "off" : needsAuth ? "needs_auth" : "connected",
      action: null,
      source: server.source ?? "manual",
      ...(sources.whop?.server === server.name ? { parent: WHOP_KEY } : {}),
    });
  }
  for (const listing of sources.featured ?? []) {
    if (listing.installed || serverUrls.has(listing.url)) continue;
    items.push({
      key: `featured:${listing.id}`,
      kind: "featured",
      id: listing.id,
      name: listing.name,
      description: listing.description,
      domain: listing.domain,
      category: categoryFor(listing.id, listing.name, listing.domain),
      installed: false,
      status: "available",
      action: listing.auth === "oauth" ? "connect" : "add",
      source: "catalog",
    });
  }
  for (const skill of sources.skills ?? []) {
    items.push({
      key: `skill:${skill.name}`,
      kind: "skill",
      id: skill.name,
      name: skill.name,
      description: skill.description,
      category: "other",
      installed: true,
      status: skill.enabled ? "connected" : "off",
      action: null,
      source: skill.source === "local-import" ? "local" : skill.source,
    });
  }
  return items;
}

export function matchesQuery(item: PluginItem, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = `${item.name} ${item.id} ${item.description} ${item.domain ?? ""} ${item.source}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

export function matchesFilter(item: PluginItem, filter: PluginFilter): boolean {
  if (filter === "all") return true;
  if (filter === "apps") return item.kind === "app";
  if (filter === "mcp") return item.kind === "mcp" || item.kind === "featured";
  if (filter === "skills") return item.kind === "skill";
  if (filter.startsWith("source:")) return item.source === filter.slice("source:".length);
  return item.kind !== "skill" && item.category === filter;
}

/** Installed first, then by name: what the person has is what they look for. */
function byInstalledThenName(a: PluginItem, b: PluginItem): number {
  return Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name);
}

export interface PluginSection {
  /** "recommended", a category, "mcp", "skills", "results", a filter */
  id: string;
  filter: PluginFilter | null;
  items: PluginItem[];
  total: number;
}

export const SECTION_PREVIEW = 6;

/** Apps and catalog plugins fill the category sections; the person's own
 * servers and skills have theirs. */
const catalogued = (item: PluginItem) => item.kind === "app" || item.kind === "featured";

/** The main view's sections. With a search, one list of matches across
 * apps and skills; with a chip, everything under it; otherwise a short
 * preview per category, each with View all. */
export function mainSections(items: readonly PluginItem[], query: string, filter: PluginFilter, extraSources: readonly string[] = []): PluginSection[] {
  const visible = items.filter((item) => matchesQuery(item, query) && matchesFilter(item, filter));
  if (query.trim()) {
    const sorted = [...visible].sort(byInstalledThenName);
    return [{ id: "results", filter: null, items: sorted, total: sorted.length }];
  }
  if (filter !== "all") {
    const sorted = [...visible].sort(byInstalledThenName);
    return [{ id: filter, filter, items: sorted, total: sorted.length }];
  }
  const sections: PluginSection[] = [];
  const preview = (id: string, sectionFilter: PluginFilter | null, list: PluginItem[]) => {
    if (list.length) sections.push({ id, filter: sectionFilter, items: list.slice(0, SECTION_PREVIEW), total: list.length });
  };
  preview("recommended", "mcp", visible.filter((item) => item.kind === "featured"));
  for (const source of extraSources) {
    preview(`source:${source}`, `source:${source}`, visible.filter((item) => item.source === source).sort(byInstalledThenName));
  }
  for (const category of CATEGORY_ORDER) {
    if (category === "other") continue;
    preview(category, category, visible.filter((item) => catalogued(item) && item.category === category).sort(byInstalledThenName));
  }
  preview("mcp", "mcp", visible.filter((item) => item.kind === "mcp").sort(byInstalledThenName));
  preview("skills", "skills", visible.filter((item) => item.kind === "skill").sort(byInstalledThenName));
  preview("other", "other", visible.filter((item) => catalogued(item) && item.category === "other").sort(byInstalledThenName));
  return sections;
}

/** Installed plugins for the Manage page (skills have their own list). */
export function installedPlugins(items: readonly PluginItem[]): PluginItem[] {
  return items.filter((item) => item.installed && item.kind !== "skill").sort((a, b) => a.name.localeCompare(b.name));
}

/** The header's "N connected": what reaches bots, with up to four icons. */
export function connectedSummary(items: readonly PluginItem[]): { count: number; icons: PluginItem[] } {
  const connected = installedPlugins(items).filter((item) => item.status === "connected");
  return { count: connected.length, icons: connected.slice(0, 4) };
}
