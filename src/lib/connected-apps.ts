// The apps a person has connected, for the sidebar foot's stack of logos:
// the MCP servers of this installation as the Connect apps panel lists them
// (buildPluginItems, one row per app), and the connectors the person's own
// Claude account brings (GET /api/me/harness-connectors, the panel's
// Providers list). Pure functions here; the hook that fetches them is
// useConnectedApps (components/SidebarFoot.tsx).
//
// 2026-10-26: on an organization server the person's Gmail, Google Drive and
// Google Calendar are claude.ai connectors (a name and a status, no address,
// no icon), and the server's own MCP servers sit on hosts whose favicon is
// a generic globe (mcp.twilio.com, api.githubcopilot.com). Each row therefore
// gets the provider's mark (providerMark): its site, whose icon is the real
// logo, or the logo itself.
import { appKey, buildPluginItems, mergeSameApps, providerMark, type PluginItem } from "./plugins-model";

type PluginSources = Parameters<typeof buildPluginItems>[0];

/** Most logos the foot shows side by side. */
export const FOOT_APP_LOGOS = 3;

/** A connector of the person's own engine account, as
 * /api/me/harness-connectors lists it ("Gmail", "Google Drive"). */
export interface AccountConnector {
  name: string;
  status: string;
}

/** The connected apps, one row per app, the person's own account connectors
 * first, then the servers in the panel's order; apps whose logo is known come
 * before the ones that would draw a monogram. Skills, marketplace plugins and
 * apps needing a sign-in are not "connected apps". */
export function connectedAppItems(sources: Pick<PluginSources, "servers" | "featured"> & { account?: readonly AccountConnector[] | null }): PluginItem[] {
  const featured = sources.featured ?? [];
  const servers = mergeSameApps(buildPluginItems({ servers: sources.servers, featured }))
    .filter((item) => item.installed && item.status === "connected" && !item.parent && (item.kind === "mcp" || item.kind === "featured" || item.kind === "app"))
    .map((item) => withCatalogMark(item, featured));
  const account = (sources.account ?? [])
    .filter((connector) => connector.status === "connected" && connector.name.trim() !== "")
    .map((connector) => accountConnectorItem(connector.name.trim(), featured));
  // one row per app: the same app from two places (a server and a
  // connector, or one server added twice) shows once
  const seen = new Set<string>();
  const rows: PluginItem[] = [];
  for (const item of [...account, ...servers]) {
    const marks = [appKey(item.name), item.logo ? `logo:${item.logo}` : "", item.domain ? `site:${item.domain}` : ""].filter(Boolean);
    if (marks.some((mark) => seen.has(mark))) continue;
    for (const mark of marks) seen.add(mark);
    rows.push(item);
  }
  const marked = (item: PluginItem) => Boolean(item.logo || item.domain);
  return [...rows.filter(marked), ...rows.filter((item) => !marked(item))];
}

/** A connector of the person's account as a row: the catalog listing of the
 * same app lends its logo, else the provider's site carries it. */
function accountConnectorItem(name: string, featured: NonNullable<PluginSources["featured"]>): PluginItem {
  const key = appKey(name);
  const listing = key ? featured.find((entry) => appKey(entry.name) === key) : undefined;
  const mark = providerMark(name);
  return {
    key: `account:${name}`,
    kind: "app",
    id: name,
    name,
    description: "",
    logo: listing?.iconUrl ?? mark.logo,
    domain: mark.site ?? listing?.site ?? listing?.domain ?? null,
    category: "other",
    installed: true,
    status: "connected",
    action: null,
    source: "claude",
  };
}

/** An app connected from the catalog is a server whose address is the MCP
 * host (gmailmcp.googleapis.com), whose favicon is a generic globe. Its
 * catalog listing, installed or not, knows the real logo and the provider's
 * own site: lend them to the row so the foot draws the same mark as the
 * panel's catalog card, not a grey circle. */
function withCatalogMark(item: PluginItem, featured: NonNullable<PluginSources["featured"]>): PluginItem {
  const key = appKey(item.name);
  const listing = featured.find((entry) => (entry.url && entry.url === item.description) || (key !== "" && appKey(entry.name) === key));
  if (!listing) return item;
  // the listing's logo first; the mark the row already has otherwise
  const logo = listing.iconUrl ?? item.logo ?? null;
  const domain = listing.site ?? item.domain;
  return logo !== (item.logo ?? null) || domain !== item.domain ? { ...item, logo, domain } : item;
}
