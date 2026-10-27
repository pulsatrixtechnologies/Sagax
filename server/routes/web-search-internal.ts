// POST /api/internal/web-search: sagax_web_search (2026-10-26). Behind the
// agents capability (see internal-route.ts). The server reads the turn's
// person's provider and key from the sealed store (server/web-search/store.ts),
// adds the key to the HTTP request (server/web-search/providers.ts) and
// answers only the results, wrapped as untrusted data. The key is not in the
// request body, the answer, an error or a log line.
import { wrapUntrusted } from "../../shared/safety-review.ts";
import { WEB_SEARCH_QUERY_MAX } from "../../shared/web-search.ts";
import { formatWebSearchResults, runWebSearch, WebSearchError, type WebSearchConfig, type WebSearchFetch } from "../web-search/providers.ts";
import { readyConfig } from "../web-search/store.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export const WEB_SEARCH_INTERNAL_PATH = "/api/internal/web-search";

export interface WebSearchInternalDeps {
  /** The saved settings of the person this turn is for (the speaker, or the
   * owner for a routine), key included; null when there are none. */
  config(capability: InternalCapabilityView): WebSearchConfig | null;
  /** A refusal for an address the server must not call (an organization
   * server's own network), or null. */
  refuseAddress?(url: string): Promise<string | null>;
  fetch?: WebSearchFetch;
}

export function createWebSearchInternalRoutes(deps: WebSearchInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === WEB_SEARCH_INTERNAL_PATH)) return PASS;
    const body = await readBody();
    const query = typeof body.query === "string" ? body.query.replace(/\s+/g, " ").trim().slice(0, WEB_SEARCH_QUERY_MAX) : "";
    if (!query) return json(res, 400, { error: "query: what to search for." });
    const config = deps.config(capability);
    if (!config || !readyConfig(config)) {
      return json(res, 404, { error: "No web search provider is set up for this person. They can add one in Settings > Models and voice > Web search." });
    }
    if (config.baseUrl && deps.refuseAddress) {
      const refusal = await deps.refuseAddress(config.baseUrl);
      if (refusal) return json(res, 403, { error: refusal });
    }
    try {
      const results = await runWebSearch(config, query, {
        ...(typeof body.count === "number" ? { count: body.count } : {}),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
      });
      return json(res, 200, { text: wrapUntrusted("web search", formatWebSearchResults(query, config.provider, results)) });
    } catch (error) {
      if (error instanceof WebSearchError) return json(res, 502, { error: error.message, code: error.code });
      return json(res, 502, { error: "The web search failed." });
    }
  };
}
