// Plugin search (Part B of the MCP sign-in and plugin catalog spec): the
// curated featured list (shared/plugin-catalog.json) plus the official MCP
// Registry, https://registry.modelcontextprotocol.io/v0/servers?search=.
//
// Registry rules: only the latest version of a server, only one with an
// https streamable-http or sse remote whose address has no template
// variables, one result per server name, at most 30 a page, 5 s timeout,
// answers cached 10 minutes. Results are community entries ("not reviewed")
// and always show the remote's domain, because a search for a brand can
// return a third party's server. A registry failure only empties the
// community part: the featured list always answers.
import { PLUGIN_CATALOG, type PluginCatalogEntry } from "../shared/plugin-catalog.ts";

export const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";
export const REGISTRY_TIMEOUT_MS = 5_000;
export const REGISTRY_CACHE_MS = 10 * 60_000;
export const REGISTRY_PAGE = 30;
const MAX_CACHE_ENTRIES = 200;
const MAX_QUERY = 100;

export interface PluginListing {
  /** A featured id, or `registry:<server name>`. */
  id: string;
  name: string;
  description: string;
  url: string;
  transport: "http" | "sse";
  domain: string;
  /** "oauth" | "api-key" | "none" for featured entries; registry entries say
   * "headers" when the remote declares required headers, else "unknown"
   * (the server decides when it is added). */
  auth: "oauth" | "api-key" | "none" | "headers" | "unknown";
  source: "featured" | "registry";
  /** Featured: reviewed by Sagax. Registry: community, not reviewed. */
  reviewed: boolean;
  /** An icon key for a bundled icon, or an https image from the registry. */
  icon?: string;
  iconUrl?: string;
  docsUrl?: string;
}

export function featuredListing(entry: PluginCatalogEntry): PluginListing {
  return {
    id: entry.id, name: entry.name, description: entry.description, url: entry.url, transport: entry.transport,
    domain: new URL(entry.url).hostname, auth: entry.auth, source: "featured", reviewed: true, icon: entry.icon, docsUrl: entry.docsUrl,
  };
}

export function featuredMatching(query: string): PluginListing[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return PLUGIN_CATALOG
    .filter((entry) => words.every((word) => `${entry.id} ${entry.name} ${entry.description} ${entry.domain}`.toLowerCase().includes(word)))
    .map(featuredListing);
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json | null => (value && typeof value === "object" && !Array.isArray(value) ? value as Json : null);
const text = (value: unknown, max: number): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** One registry row as a listing, or null when it is not something Sagax can add. */
export function registryListing(row: unknown): PluginListing | null {
  const entry = record(row);
  // 2025-09+ shape { server, _meta }; earlier rows were the server itself.
  const server = record(entry?.server) ?? entry;
  if (!server) return null;
  const meta = record(record(entry?._meta)?.["io.modelcontextprotocol.registry/official"]) ?? record(record(server._meta)?.["io.modelcontextprotocol.registry/official"]);
  if (meta && meta.isLatest === false) return null;
  if (meta && typeof meta.status === "string" && meta.status !== "active") return null;
  const name = text(server.name, 200);
  if (!name) return null;
  const remotes = Array.isArray(server.remotes) ? server.remotes.map(record).filter((remote): remote is Json => remote !== null) : [];
  for (const remote of remotes) {
    const type = remote.type === "streamable-http" ? "http" : remote.type === "sse" ? "sse" : null;
    const url = typeof remote.url === "string" ? remote.url : "";
    if (!type || !url.startsWith("https://") || /[{}]/.test(url) || url.length > 2_048) continue;
    let domain: string;
    try { domain = new URL(url).hostname; } catch { continue; }
    const headers = Array.isArray(remote.headers) ? remote.headers.map(record) : [];
    const needsHeaders = headers.some((header) => header?.isRequired === true);
    const icons = Array.isArray(server.icons) ? server.icons.map(record) : [];
    const iconUrl = icons.map((icon) => (typeof icon?.src === "string" ? icon.src : "")).find((src) => src.startsWith("https://") && src.length <= 2_048);
    const title = text(server.title, 80) || name.split("/").pop() || name;
    const website = typeof server.websiteUrl === "string" && server.websiteUrl.startsWith("https://") ? server.websiteUrl : undefined;
    return {
      id: `registry:${name}`, name: title, description: text(server.description, 300), url, transport: type, domain,
      auth: needsHeaders ? "headers" : "unknown", source: "registry", reviewed: false,
      ...(iconUrl ? { iconUrl } : {}), ...(website ? { docsUrl: website } : {}),
    };
  }
  return null;
}

export interface RegistryPage {
  results: PluginListing[];
  nextCursor: string | null;
  /** False when the registry could not be reached (search still answers). */
  available: boolean;
}

export interface RegistrySearchOptions {
  fetch?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}

/** A cached, bounded client for the registry's search. */
export function createRegistrySearch(options: RegistrySearchOptions = {}) {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { at: number; page: RegistryPage }>();

  async function search(query: string, cursor?: string): Promise<RegistryPage> {
    const q = query.trim().slice(0, MAX_QUERY);
    const key = `${q}\n${cursor ?? ""}`;
    const hit = cache.get(key);
    if (hit && now() - hit.at < REGISTRY_CACHE_MS) return hit.page;
    const url = new URL(REGISTRY_URL);
    if (q) url.searchParams.set("search", q);
    url.searchParams.set("limit", String(REGISTRY_PAGE));
    if (cursor) url.searchParams.set("cursor", cursor);
    let page: RegistryPage;
    try {
      const response = await fetcher(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? REGISTRY_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`registry answered ${response.status}`);
      const body = record(await response.json());
      const rows = Array.isArray(body?.servers) ? body.servers : [];
      const seen = new Set<string>();
      const results: PluginListing[] = [];
      for (const row of rows) {
        const listing = registryListing(row);
        if (!listing || seen.has(listing.id)) continue;
        seen.add(listing.id);
        results.push(listing);
        if (results.length >= REGISTRY_PAGE) break;
      }
      const next = record(body?.metadata)?.nextCursor ?? record(body?.metadata)?.next_cursor;
      page = { results, nextCursor: typeof next === "string" && next ? next.slice(0, 500) : null, available: true };
    } catch {
      // Offline or slow: degrade to the featured list; do not cache a failure.
      return { results: [], nextCursor: null, available: false };
    }
    if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: now(), page });
    return page;
  }

  /** The newest registry entry with exactly this server name. */
  async function lookup(serverName: string): Promise<PluginListing | null> {
    const page = await search(serverName);
    return page.results.find((listing) => listing.id === `registry:${serverName}`) ?? null;
  }

  return { search, lookup };
}
export type RegistrySearch = ReturnType<typeof createRegistrySearch>;
