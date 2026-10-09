// Plugins > Manage > Marketplaces: the installation's own plugin
// marketplaces (server/plugin-marketplaces.ts).
//
//   GET    /api/marketplaces                              { marketplaces }
//   POST   /api/marketplaces { source, ref? }              add or fetch again
//   POST   /api/marketplaces/:name/refresh
//   DELETE /api/marketplaces/:name                         (no plugin installed)
//   POST   /api/marketplaces/:name/plugins/:plugin         install: MCP servers + skills
//   POST   /api/marketplaces/:name/plugins/:plugin/update  update them in place
//   DELETE /api/marketplaces/:name/plugins/:plugin         uninstall them
//
// Same scope as /api/mcp/servers: admin (never in CLIENT_ALLOW), so on an
// organization server the clone and the install happen on that server for
// its administrators, and on a personal server for its owner.
import type { IncomingMessage } from "node:http";

import { MarketplaceError, type MarketplaceView, type PluginMarketplaces } from "../plugin-marketplaces.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface MarketplaceRouteDeps {
  store: PluginMarketplaces;
  mayManage: (auth: RequestAuth) => boolean;
  actor: (auth: RequestAuth) => string | undefined;
  install: (marketplace: string, plugin: string, request: { req: IncomingMessage; auth: RequestAuth }) =>
    Promise<{ status: number; body: Record<string, unknown> }>;
  uninstall: (marketplace: string, plugin: string) => Promise<{ status: number; body: Record<string, unknown> }>;
  /** Update an installed plugin in place: its servers keep their names,
   * switches and bot selections, its skills their review state. */
  update: (marketplace: string, plugin: string, request: { req: IncomingMessage; auth: RequestAuth }) =>
    Promise<{ status: number; body: Record<string, unknown> }>;
  /** One admin activity row for a plugin updated (written on success). */
  audit: (auth: RequestAuth, row: { action: string; target: { kind: string; id: string; name: string }; before?: Record<string, unknown>; after?: Record<string, unknown> }) => void;
}

const NAME = "[A-Za-z0-9][A-Za-z0-9._-]{0,63}";
const MARKET = new RegExp(`^/api/marketplaces/(${NAME})(?:/(refresh))?$`);
const PLUGIN = new RegExp(`^/api/marketplaces/(${NAME})/plugins/(${NAME})$`);
const UPDATE = new RegExp(`^/api/marketplaces/(${NAME})/plugins/(${NAME})/update$`);

export function createMarketplaceRoutes(deps: MarketplaceRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/marketplaces" && !path.startsWith("/api/marketplaces/")) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const fail = (error: unknown) => {
      if (error instanceof MarketplaceError) return json(res, error.status, { error: error.message, code: error.code });
      throw error;
    };
    const list = () => json(res, 200, { marketplaces: deps.store.list() });
    if (method !== "GET" && !deps.mayManage(auth)) {
      return json(res, 403, { error: "forbidden: only an admin or this computer's owner can change marketplaces" });
    }
    if (method !== "GET" && method !== "DELETE" && !/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    try {
      if (path === "/api/marketplaces") {
        if (method === "GET") return list();
        if (method !== "POST") return json(res, 405, { error: "GET or POST" });
        const body = await readBody(req) as Record<string, unknown> | null;
        const source = typeof body?.source === "string" ? body.source.trim() : "";
        const ref = typeof body?.ref === "string" && body.ref.trim() ? body.ref.trim() : undefined;
        if (!source || source.length > 500) return json(res, 400, { error: "Enter owner/repo, an https git address or the address of a marketplace.json." });
        const added: MarketplaceView = await deps.store.add({ source, ...(ref ? { ref } : {}) }, deps.actor(auth));
        return json(res, 201, { marketplace: added, marketplaces: deps.store.list() });
      }
      const update = UPDATE.exec(path);
      if (update) {
        if (method !== "POST") return json(res, 405, { error: "POST" });
        const [, marketplace, name] = update;
        const before = deps.store.installed().find((entry) => entry.key === `${name}@${marketplace}`);
        if (!before) return json(res, 404, { error: "That plugin is not installed.", code: "not_installed" });
        const done = await deps.update(marketplace!, name!, { req, auth });
        if (done.status < 400) {
          const after = deps.store.installed().find((entry) => entry.key === `${name}@${marketplace}`);
          const revisionOf = (entry: typeof before | undefined) => ({
            ...(entry?.version ? { version: entry.version } : {}),
            ...(entry?.revision ? { revision: entry.revision.slice(0, 80) } : {}),
          });
          deps.audit(auth, {
            action: "plugin.update",
            target: { kind: "plugin", id: `${name}@${marketplace}`, name: name! },
            before: { ...revisionOf(before), servers: before.servers, skills: before.skills },
            after: { ...revisionOf(after), servers: after?.servers ?? [], skills: after?.skills ?? [] },
          });
        }
        return json(res, done.status, { ...done.body, marketplaces: deps.store.list() });
      }
      const plugin = PLUGIN.exec(path);
      if (plugin) {
        const [, marketplace, name] = plugin;
        if (method === "POST") {
          const done = await deps.install(marketplace!, name!, { req, auth });
          return json(res, done.status, { ...done.body, marketplaces: deps.store.list() });
        }
        if (method === "DELETE") {
          const done = await deps.uninstall(marketplace!, name!);
          return json(res, done.status, { ...done.body, marketplaces: deps.store.list() });
        }
        return json(res, 405, { error: "POST or DELETE" });
      }
      const market = MARKET.exec(path);
      if (market) {
        const [, name, action] = market;
        if (action === "refresh" && method === "POST") {
          await deps.store.refresh(name!, deps.actor(auth));
          return list();
        }
        if (!action && method === "DELETE") {
          await deps.store.remove(name!);
          return list();
        }
        return json(res, 405, { error: "method not allowed" });
      }
      return json(res, 404, { error: "not found" });
    } catch (error) {
      return fail(error);
    }
  };
}
