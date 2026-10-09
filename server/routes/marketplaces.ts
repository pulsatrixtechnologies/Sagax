// Plugins > Manage > Marketplaces: the installation's own plugin
// marketplaces (server/plugin-marketplaces.ts).
//
//   GET    /api/marketplaces                              { marketplaces }
//   POST   /api/marketplaces { source, ref?, token? }      add or fetch again
//   POST   /api/marketplaces/:name/refresh
//   DELETE /api/marketplaces/:name                         (no plugin installed)
//   PUT    /api/marketplaces/:name/token { token }         the installation's token
//   DELETE /api/marketplaces/:name/token
//   POST   /api/marketplaces/:name/plugins/:plugin         install: MCP servers + skills
//   POST   /api/marketplaces/:name/plugins/:plugin/update  update them in place
//   DELETE /api/marketplaces/:name/plugins/:plugin         uninstall them
//
// Same scope as /api/mcp/servers: admin (never in CLIENT_ALLOW), so on an
// organization server the clone and the install happen on that server for
// its administrators, and on a personal server for its owner.
//
// The installation's token per marketplace (`workspace`, kept by
// server/marketplace-tokens.ts under the `workspace` key) lets a private
// GitHub marketplace work for everyone: an admin only (`mayManageTokens`),
// audited (`marketplace.token_set`, `marketplace.token_remove`), never sent
// back (`hasToken` only). Reads use it first, then the acting person's
// GitHub connection, then the organization's tokens.
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
  /** The installation's token per marketplace (server/bot-plugins.ts). */
  workspace?: {
    addWorkspaceMarketplace(input: { source: string; ref?: string; token?: string }, actor: string | undefined): Promise<MarketplaceView>;
    refreshWorkspaceMarketplace(name: string, actor: string | undefined): Promise<unknown>;
    setWorkspaceMarketplaceToken(name: string, token: string | null, actor: string | undefined): void;
    removeWorkspaceMarketplace(name: string): Promise<void>;
    workspaceTokenSources(): Set<string>;
  };
  /** Who may save or remove the installation's token: an admin only. */
  mayManageTokens?: (auth: RequestAuth) => boolean;
}

const TOKEN = /^[\x21-\x7e]{8,4096}$/;
/** undefined: none sent; null: not a token. */
function tokenField(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !TOKEN.test(value.trim())) return null;
  return value.trim();
}

const NAME = "[A-Za-z0-9][A-Za-z0-9._-]{0,63}";
const MARKET = new RegExp(`^/api/marketplaces/(${NAME})(?:/(refresh|token))?$`);
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
    const views = () => {
      const sources = deps.workspace?.workspaceTokenSources() ?? new Set<string>();
      return deps.store.list().map((market) => (deps.workspace ? { ...market, hasToken: sources.has(market.source) } : market));
    };
    const list = () => json(res, 200, { marketplaces: views() });
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
        const token = tokenField(body?.token);
        if (token === null) return json(res, 400, { error: "The token must be one line of printable characters.", code: "invalid_token" });
        if (token && (!deps.workspace || !deps.mayManageTokens?.(auth))) return json(res, 403, { error: "Only an admin can save a marketplace token for everyone.", code: "marketplace_token_admin_only" });
        const actor = deps.actor(auth);
        const added: MarketplaceView = deps.workspace
          ? await deps.workspace.addWorkspaceMarketplace({ source, ...(ref ? { ref } : {}), ...(token ? { token } : {}) }, actor)
          : await deps.store.add({ source, ...(ref ? { ref } : {}) }, actor);
        if (token) deps.audit(auth, { action: "marketplace.token_set", target: { kind: "marketplace", id: added.name, name: added.name }, after: { scope: "workspace", source: added.source } });
        const marketplaces = views();
        return json(res, 201, { marketplace: marketplaces.find((market) => market.name === added.name) ?? added, marketplaces });
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
        return json(res, done.status, { ...done.body, marketplaces: views() });
      }
      const plugin = PLUGIN.exec(path);
      if (plugin) {
        const [, marketplace, name] = plugin;
        if (method === "POST") {
          const done = await deps.install(marketplace!, name!, { req, auth });
          return json(res, done.status, { ...done.body, marketplaces: views() });
        }
        if (method === "DELETE") {
          const done = await deps.uninstall(marketplace!, name!);
          return json(res, done.status, { ...done.body, marketplaces: views() });
        }
        return json(res, 405, { error: "POST or DELETE" });
      }
      const market = MARKET.exec(path);
      if (market) {
        const [, name, action] = market;
        if (action === "refresh" && method === "POST") {
          if (deps.workspace) await deps.workspace.refreshWorkspaceMarketplace(name!, deps.actor(auth));
          else await deps.store.refresh(name!, deps.actor(auth));
          return list();
        }
        if (action === "token") {
          if (!deps.workspace) return json(res, 404, { error: "not found" });
          if (!deps.mayManageTokens?.(auth)) return json(res, 403, { error: "Only an admin can change a marketplace token for everyone.", code: "marketplace_token_admin_only" });
          if (method !== "PUT" && method !== "DELETE") return json(res, 405, { error: "PUT or DELETE" });
          let token: string | null = null;
          if (method === "PUT") {
            const body = await readBody(req) as Record<string, unknown> | null;
            const sent = tokenField(body?.token);
            if (!sent) return json(res, 400, { error: "send { token }: one line of printable characters", code: "invalid_token" });
            token = sent;
          }
          deps.workspace.setWorkspaceMarketplaceToken(name!, token, deps.actor(auth));
          deps.audit(auth, {
            action: token ? "marketplace.token_set" : "marketplace.token_remove",
            target: { kind: "marketplace", id: name!, name: name! },
            ...(token ? { after: { scope: "workspace" } } : { before: { scope: "workspace" } }),
          });
          return list();
        }
        if (!action && method === "DELETE") {
          if (deps.workspace) await deps.workspace.removeWorkspaceMarketplace(name!);
          else await deps.store.remove(name!);
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
