// Connect apps > Manage > Installed (2026-10-26): one line per thing the
// person has, whatever brought it. The panel's rows (buildPluginItems) still
// keep one row per source: an MCP server added by hand, the same address
// brought again by a marketplace plugin ("github" and "github-github"), the
// plugin itself. Here they fold into one entry named for people ("GitHub")
// that says what it brings ("plugin (claude-plugins-official) · 1
// connector"). Pure functions only, shared by the view and its tests.
import { appKey, providerMark, WHOP_KEY, type PluginItem, type PluginStatus } from "./plugins-model";

/** What one installed entry brings, counted from the rows folded into it. */
export interface InstalledBrings {
  /** a catalog app or Whop (connected like an app) */
  app: boolean;
  /** the marketplace of the plugin that brought it */
  plugin: string | null;
  /** distinct MCP servers (by address) */
  connectors: number;
  skills: number;
}

export interface InstalledEntry {
  /** stable across loads: the key of the row that stands for the entry */
  key: string;
  /** a name for people: "GitHub", "Acme Docs" */
  name: string;
  logo: string | null;
  domain: string | null;
  /** the row that opens the entry's page: the plugin, else the app, else
   * the first server */
  primary: PluginItem;
  /** every row folded into the entry, the primary first */
  members: PluginItem[];
  brings: InstalledBrings;
  status: PluginStatus;
  updateAvailable: boolean;
  /** the MCP server names the entry mounts (what "For which bots" switches) */
  servers: string[];
}

/** Plain names of well-known apps (appKey of the readable name). */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  github: "GitHub",
  gitlab: "GitLab",
  gmail: "Gmail",
  googledrive: "Google Drive",
  googlecalendar: "Google Calendar",
  googledocs: "Google Docs",
  googlesheets: "Google Sheets",
  microsoft365: "Microsoft 365",
  onedrive: "OneDrive",
  sharepoint: "SharePoint",
  hubspot: "HubSpot",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  openai: "OpenAI",
  chatgpt: "ChatGPT",
  clickup: "ClickUp",
  paypal: "PayPal",
};

/** A server or plugin name as people say it: "github-github" is "GitHub",
 * "acme-docs" is "Acme Docs". A repeated word (a plugin that named its
 * server after itself) shows once; a name already written with capitals
 * stays as it is. */
export function readableName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  const all = trimmed.split(/[-_\s]+/).filter(Boolean);
  // "linear-mcp", "notion-server": the kind of thing is not its name
  const named = all.filter((word) => !/^(mcp|server)$/i.test(word));
  const words = named.length ? named : all;
  const kept = words.filter((word, index) => index === 0 || word.toLowerCase() !== words[index - 1]!.toLowerCase());
  const known = DISPLAY_NAMES[appKey(kept.join(""))];
  if (known) return known;
  if (/[A-Z]/.test(trimmed) && kept.length === all.length) return trimmed;
  return kept.map((word) => DISPLAY_NAMES[word.toLowerCase()] ?? (word.slice(0, 1).toUpperCase() + word.slice(1))).join(" ");
}

/** An MCP address without the parts that do not name another server. */
function addressKey(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url.trim().replace(/\/+$/, "").toLowerCase() || null;
  }
}

/** Where an MCP row's address lives: buildPluginItems keeps it as the
 * description (a command line for a stdio server). */
const rowAddress = (item: PluginItem) => (item.kind === "mcp" && /^https?:\/\//i.test(item.description) ? addressKey(item.description) : null);

const STATUS_RANK: Record<PluginStatus, number> = { needs_auth: 0, pending: 1, connected: 2, available: 3, off: 4 };

/** The entry's state: a sign-in waiting anywhere first, else connected when
 * one part is, else off. */
function entryStatus(members: readonly PluginItem[]): PluginStatus {
  const sorted = [...members].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
  return sorted[0]?.status ?? "off";
}

/** A catalog listing (GET /api/plugins/search): an installed server at its
 * address is that app, with its logo. */
export interface CatalogApp {
  url: string;
  iconUrl?: string;
  site?: string;
  domain?: string;
}

/** Installed rows (skills kept apart) folded into entries: rows with the same
 * readable app, the same MCP address, or a parent plugin are one. Skills a
 * plugin brought count on the plugin; private skills are not entries. */
export function installedEntries(items: readonly PluginItem[], catalog: readonly CatalogApp[] = []): InstalledEntry[] {
  const apps = new Map<string, CatalogApp>();
  for (const listing of catalog) {
    const key = addressKey(listing.url);
    if (key) apps.set(key, listing);
  }
  const installed = items.filter((item) => item.installed && !(item.kind === "skill" && !item.parent));
  const installedKeys = new Set(installed.map((item) => item.key));
  // the marketplaces in reach: a server's source names one only if it is
  // listed (a catalog or vendor source is not a plugin)
  const markets = new Set(items.filter((item) => item.kind === "plugin").map((item) => item.source));
  // union-find over the rows
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let at = key;
    while (parent.get(at) !== at) at = parent.get(at)!;
    parent.set(key, at);
    return at;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const item of installed) parent.set(item.key, item.key);
  const byMark = new Map<string, string>();
  const claim = (mark: string | null, key: string) => {
    if (!mark) return;
    const seen = byMark.get(mark);
    if (seen) union(seen, key);
    else byMark.set(mark, key);
  };
  for (const item of installed) {
    if (item.parent && installedKeys.has(item.parent)) union(item.parent, item.key);
    if (item.kind === "skill") continue;
    claim(rowAddress(item) ? `url:${rowAddress(item)}` : null, item.key);
    const key = appKey(readableName(item.name));
    claim(key ? `app:${key}` : null, item.key);
  }
  const groups = new Map<string, PluginItem[]>();
  for (const item of installed) {
    const root = find(item.key);
    groups.set(root, [...(groups.get(root) ?? []), item]);
  }
  const entries: InstalledEntry[] = [];
  for (const members of groups.values()) {
    // a group of skills only (their plugin is not installed) is not an entry
    if (members.every((member) => member.kind === "skill")) continue;
    const rank = (item: PluginItem) => (item.kind === "plugin" ? 0 : item.key === WHOP_KEY || item.kind === "app" || item.kind === "featured" ? 1 : item.kind === "mcp" ? 2 : 3);
    const ordered = [...members].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    const primary = ordered[0]!;
    const plugin = ordered.find((member) => member.kind === "plugin");
    const servers = ordered.filter((member) => member.kind === "mcp");
    const addresses = new Set(servers.map((server) => rowAddress(server) ?? `name:${server.id}`));
    const listing = servers.map((server) => apps.get(rowAddress(server) ?? "")).find(Boolean);
    const app = Boolean(listing) || ordered.some((member) => member.key === WHOP_KEY || member.kind === "app" || member.kind === "featured" || (member.kind === "mcp" && Boolean(member.merged?.some((key) => key.startsWith("featured:")))));
    const name = readableName((ordered.find((member) => member.kind !== "mcp" && member.kind !== "skill") ?? primary).name);
    const listedLogo = listing?.iconUrl ?? ordered.find((member) => member.logo)?.logo ?? null;
    const listedDomain = listing?.site ?? ordered.find((member) => member.kind !== "mcp" && member.domain)?.domain ?? ordered.find((member) => member.domain)?.domain ?? listing?.domain ?? null;
    const mark = listedLogo || listedDomain ? { logo: listedLogo, site: listedDomain } : providerMark(name, servers[0]?.description);
    entries.push({
      key: primary.key,
      name,
      logo: listedLogo ?? mark.logo,
      domain: listedDomain ?? mark.site,
      primary,
      members: ordered,
      brings: {
        app,
        // a server a marketplace plugin brought still names that marketplace
        // when the plugin's own row is not in reach (a member's listing)
        plugin: plugin ? plugin.source : servers.find((server) => markets.has(server.source))?.source ?? null,
        connectors: app && addresses.size > 0 ? addresses.size - 1 : addresses.size,
        skills: ordered.filter((member) => member.kind === "skill").length,
      },
      status: entryStatus(ordered.filter((member) => member.kind !== "skill")),
      updateAvailable: ordered.some((member) => member.updateAvailable),
      servers: servers.map((server) => server.id),
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Private skills: the person's own, not brought by an installed plugin. */
export function privateSkills(items: readonly PluginItem[]): PluginItem[] {
  return items.filter((item) => item.kind === "skill" && !item.parent).sort((a, b) => a.name.localeCompare(b.name));
}

/** Catalog rows for Discover: what can still be added (installed ones live
 * in Installed; the engines' connectors in My accounts). */
export function discoverItems(items: readonly PluginItem[]): PluginItem[] {
  return items.filter((item) => !item.installed && item.source !== "grok");
}
