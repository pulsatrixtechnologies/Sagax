// One adapter per web search provider: the request each one takes and its
// answer normalized to { title, url, snippet, published }. The key is put on
// the HTTP request here and nowhere else: it is never in an error, a log
// line, the tool's arguments or its result. An error names the provider and
// the HTTP status, never the provider's body (which may echo the request).
import {
  WEB_SEARCH_DEFAULT_RESULTS,
  WEB_SEARCH_MAX_RESULTS,
  WEB_SEARCH_PROVIDER_INFO,
  type WebSearchProviderId,
} from "../../shared/web-search.ts";

export interface WebSearchConfig {
  provider: WebSearchProviderId;
  /** The person's key, read from the sealed store just before the call. */
  key?: string;
  /** SearXNG: the instance's base URL. */
  baseUrl?: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  published?: string;
}

export type WebSearchFetch = (url: string, init: RequestInit) => Promise<Response>;

export class WebSearchError extends Error {
  readonly code: "no_key" | "no_base_url" | "refused_key" | "rate_limited" | "upstream" | "timeout" | "bad_answer" | "base_url";
  readonly status?: number;
  constructor(code: WebSearchError["code"], message: string, status?: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const SNIPPET_CHARS = 600;
const TITLE_CHARS = 200;
const TIMEOUT_MS = 15_000;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]{0,200}>/g, "").replace(/\s+/g, " ").trim().slice(0, max);
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function result(title: unknown, url: unknown, snippet: unknown, published?: unknown): WebSearchResult | null {
  const link = httpUrl(url);
  if (!link) return null;
  const date = clean(published, 40);
  return {
    title: clean(title, TITLE_CHARS) || link,
    url: link,
    snippet: clean(snippet, SNIPPET_CHARS),
    ...(date ? { published: date } : {}),
  };
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row)) : [];
}

function joined(value: unknown): string {
  return Array.isArray(value) ? value.filter((part) => typeof part === "string").join(" … ") : "";
}

/** A SearXNG base URL as typed: http(s), no credentials, no query. */
export function normalizeBaseUrl(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new WebSearchError("base_url", "Enter the instance's address, starting with http:// or https://.");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) {
    throw new WebSearchError("base_url", "Enter the instance's address, starting with http:// or https://, without a query.");
  }
  return url.toString().replace(/\/+$/, "");
}

interface PlannedRequest {
  url: string;
  init: RequestInit;
  parse(body: unknown): Array<WebSearchResult | null>;
}

/** The HTTP request a provider takes for one query. Exported for tests. */
export function planWebSearch(config: WebSearchConfig, query: string, count: number): PlannedRequest {
  const info = WEB_SEARCH_PROVIDER_INFO[config.provider];
  const key = config.key?.trim() ?? "";
  if (info.keyRequired && !key) throw new WebSearchError("no_key", `No ${info.label} key is saved. Add it in Settings > Models > Web search.`);
  const json = { accept: "application/json" };
  switch (config.provider) {
    case "brave": {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query);
      url.searchParams.set("count", String(count));
      return {
        url: url.toString(),
        init: { method: "GET", headers: { ...json, "x-subscription-token": key } },
        parse: (body) => rows((body as { web?: { results?: unknown } } | null)?.web?.results)
          .map((row) => result(row.title, row.url, [row.description, joined(row.extra_snippets)].filter(Boolean).join(" "), row.page_age ?? row.age)),
      };
    }
    case "exa":
      return {
        url: "https://api.exa.ai/search",
        init: {
          method: "POST",
          headers: { ...json, "content-type": "application/json", "x-api-key": key },
          body: JSON.stringify({ query, numResults: count, contents: { highlights: { numSentences: 3 }, text: { maxCharacters: SNIPPET_CHARS } } }),
        },
        parse: (body) => rows((body as { results?: unknown } | null)?.results)
          .map((row) => result(row.title, row.url, joined(row.highlights) || row.summary || row.text, row.publishedDate)),
      };
    case "parallel":
      return {
        url: "https://api.parallel.ai/v1beta/search",
        init: {
          method: "POST",
          headers: { ...json, "content-type": "application/json", "x-api-key": key, "parallel-beta": "search-extract-2025-10-10" },
          body: JSON.stringify({ objective: query, search_queries: [query], max_results: count, excerpts: { max_chars_per_result: SNIPPET_CHARS } }),
        },
        parse: (body) => rows((body as { results?: unknown } | null)?.results)
          .map((row) => result(row.title, row.url, joined(row.excerpts), row.publish_date)),
      };
    case "firecrawl":
      return {
        url: "https://api.firecrawl.dev/v2/search",
        init: {
          method: "POST",
          headers: { ...json, "content-type": "application/json", authorization: `Bearer ${key}` },
          body: JSON.stringify({ query, limit: count }),
        },
        parse: (body) => {
          const data = (body as { data?: unknown } | null)?.data;
          // v2 answers { data: { web: [...] } }; v1 answered { data: [...] }.
          const list = Array.isArray(data) ? data : (data as { web?: unknown } | null)?.web;
          return rows(list).map((row) => result(row.title, row.url, row.description ?? row.snippet, row.date));
        },
      };
    case "searxng": {
      const base = config.baseUrl ? normalizeBaseUrl(config.baseUrl) : "";
      if (!base) throw new WebSearchError("no_base_url", "No SearXNG address is saved. Add it in Settings > Models > Web search.");
      const url = new URL(`${base}/search`);
      url.searchParams.set("q", query);
      url.searchParams.set("format", "json");
      return {
        url: url.toString(),
        init: { method: "GET", headers: { ...json, ...(key ? { authorization: `Bearer ${key}` } : {}) } },
        parse: (body) => rows((body as { results?: unknown } | null)?.results)
          .map((row) => result(row.title, row.url, row.content, row.publishedDate)),
      };
    }
  }
}

/** Run one search. `count` is clamped to 1..WEB_SEARCH_MAX_RESULTS. */
export async function runWebSearch(
  config: WebSearchConfig,
  query: string,
  options: { count?: number; fetch?: WebSearchFetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<WebSearchResult[]> {
  const count = Math.max(1, Math.min(WEB_SEARCH_MAX_RESULTS, Math.trunc(options.count ?? WEB_SEARCH_DEFAULT_RESULTS) || WEB_SEARCH_DEFAULT_RESULTS));
  const label = WEB_SEARCH_PROVIDER_INFO[config.provider].label;
  const plan = planWebSearch(config, query, count);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(plan.url, { ...plan.init, signal, redirect: "error" });
  } catch {
    if (timeout.aborted) throw new WebSearchError("timeout", `${label} did not answer in time.`);
    throw new WebSearchError("upstream", `${label} could not be reached.`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new WebSearchError("refused_key", `${label} refused the key (HTTP ${response.status}). Check it in Settings > Models > Web search.`, response.status);
  }
  if (response.status === 429) throw new WebSearchError("rate_limited", `${label} is limiting searches on this key (HTTP 429). Try again later.`, 429);
  if (!response.ok) throw new WebSearchError("upstream", `${label} answered HTTP ${response.status}.`, response.status);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new WebSearchError("bad_answer", `${label} did not answer with search results.`);
  }
  const seen = new Set<string>();
  const out: WebSearchResult[] = [];
  for (const row of plan.parse(body)) {
    if (!row || seen.has(row.url)) continue;
    seen.add(row.url);
    out.push(row);
    if (out.length >= count) break;
  }
  return out;
}

/** The results as the model reads them: numbered, plain text. */
export function formatWebSearchResults(query: string, provider: WebSearchProviderId, results: readonly WebSearchResult[]): string {
  const label = WEB_SEARCH_PROVIDER_INFO[provider].label;
  if (!results.length) return `No results from ${label} for: ${query}`;
  const lines = [`${results.length} result${results.length === 1 ? "" : "s"} from ${label} for: ${query}`];
  results.forEach((row, index) => {
    lines.push("", `${index + 1}. ${row.title}`, `   ${row.url}`);
    if (row.published) lines.push(`   ${row.published}`);
    if (row.snippet) lines.push(`   ${row.snippet}`);
  });
  return lines.join("\n");
}
