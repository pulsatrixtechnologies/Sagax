// The apps a person has connected, as the Connect apps panel lists them:
// the same rows (buildPluginItems, one per app) read for the sidebar foot's
// stack of logos. Pure functions here; the hook that fetches them is
// useConnectedApps (components/SidebarFoot.tsx).
import { buildPluginItems, mergeSameApps, type PluginItem } from "./plugins-model";

type PluginSources = Parameters<typeof buildPluginItems>[0];

/** Most logos the foot shows side by side. */
export const FOOT_APP_LOGOS = 3;

/** The connected apps, one row per app (a catalog listing and the MCP
 * server it became are one), in the panel's order. Skills, marketplace
 * plugins and apps needing a sign-in are not "connected apps". */
export function connectedAppItems(sources: Pick<PluginSources, "servers" | "featured">): PluginItem[] {
  return mergeSameApps(buildPluginItems({ servers: sources.servers, featured: sources.featured }))
    .filter((item) => item.installed && item.status === "connected" && !item.parent && (item.kind === "mcp" || item.kind === "featured" || item.kind === "app"));
}
