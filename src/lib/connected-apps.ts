// The apps a person has connected, as the Connect apps panel lists them:
// the same rows (buildPluginItems, one per app) read for the sidebar foot's
// stack of logos. Pure functions here; the hook that fetches them is
// useConnectedApps (components/SidebarFoot.tsx).
import { appKey, buildPluginItems, mergeSameApps, type PluginItem } from "./plugins-model";

type PluginSources = Parameters<typeof buildPluginItems>[0];

/** Most logos the foot shows side by side. */
export const FOOT_APP_LOGOS = 3;

/** The connected apps, one row per app (a catalog listing and the MCP
 * server it became are one), in the panel's order. Skills, marketplace
 * plugins and apps needing a sign-in are not "connected apps". */
export function connectedAppItems(sources: Pick<PluginSources, "servers" | "featured">): PluginItem[] {
  const items = mergeSameApps(buildPluginItems({ servers: sources.servers, featured: sources.featured }))
    .filter((item) => item.installed && item.status === "connected" && !item.parent && (item.kind === "mcp" || item.kind === "featured" || item.kind === "app"));
  return items.map((item) => withCatalogMark(item, sources.featured ?? []));
}

/** An app connected from the catalog is a server whose address is the MCP
 * host (gmailmcp.googleapis.com), whose favicon is a generic globe. Its
 * catalog listing, installed or not, knows the real logo and the provider's
 * own site: lend them to the row so the foot draws the same mark as the
 * panel's catalog card, not a grey circle. */
function withCatalogMark(item: PluginItem, featured: NonNullable<PluginSources["featured"]>): PluginItem {
  if (item.logo) return item;
  const key = appKey(item.name);
  const listing = featured.find((entry) => (entry.url && entry.url === item.description) || (key !== "" && appKey(entry.name) === key));
  if (!listing) return item;
  const logo = listing.iconUrl ?? null;
  const domain = listing.site ?? item.domain;
  return logo || domain !== item.domain ? { ...item, logo, domain } : item;
}
