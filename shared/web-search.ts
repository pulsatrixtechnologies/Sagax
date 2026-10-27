// Web search with the person's own key (2026-10-26): the providers a person
// may pick in Settings > Models and voice > Web search, shared by the server
// (server/web-search/) and the settings page. The key itself never leaves the
// server once saved: the page only learns whether one is saved.

export const WEB_SEARCH_PROVIDERS = ["brave", "exa", "parallel", "firecrawl", "searxng"] as const;
export type WebSearchProviderId = (typeof WEB_SEARCH_PROVIDERS)[number];

export interface WebSearchProviderInfo {
  id: WebSearchProviderId;
  /** The provider's own name (not translated). */
  label: string;
  /** A key is required to search (SearXNG: optional, for an instance behind a proxy). */
  keyRequired: boolean;
  /** The person gives the base URL of their own instance. */
  baseUrl: boolean;
  /** Where the person creates a key. */
  keysUrl?: string;
}

export const WEB_SEARCH_PROVIDER_INFO: Readonly<Record<WebSearchProviderId, WebSearchProviderInfo>> = {
  brave: { id: "brave", label: "Brave Search", keyRequired: true, baseUrl: false, keysUrl: "https://api-dashboard.search.brave.com/app/keys" },
  exa: { id: "exa", label: "Exa", keyRequired: true, baseUrl: false, keysUrl: "https://dashboard.exa.ai/api-keys" },
  parallel: { id: "parallel", label: "Parallel", keyRequired: true, baseUrl: false, keysUrl: "https://platform.parallel.ai/" },
  firecrawl: { id: "firecrawl", label: "Firecrawl", keyRequired: true, baseUrl: false, keysUrl: "https://www.firecrawl.dev/app/api-keys" },
  searxng: { id: "searxng", label: "SearXNG", keyRequired: false, baseUrl: true },
};

export function isWebSearchProvider(value: unknown): value is WebSearchProviderId {
  return typeof value === "string" && (WEB_SEARCH_PROVIDERS as readonly string[]).includes(value);
}

/** What GET /api/me/web-search answers: never the key, only whether one is saved. */
export interface WebSearchSettingsView {
  provider: WebSearchProviderId | null;
  baseUrl: string | null;
  keyConfigured: boolean;
  /** Last four characters of the saved key, for the masked line. */
  last4: string | null;
  /** Searches can run: a provider, plus its key or base URL. */
  ready: boolean;
}

/** The tool a bot on an engine without its own web search is given. */
export const WEB_SEARCH_TOOL_NAME = "sagax_web_search";
export const WEB_SEARCH_DEFAULT_RESULTS = 5;
export const WEB_SEARCH_MAX_RESULTS = 10;
export const WEB_SEARCH_QUERY_MAX = 400;
