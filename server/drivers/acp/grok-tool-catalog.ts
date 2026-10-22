// Grok's own MCP catalog, said to the model once, so it calls tools
// directly instead of searching for them.
//
// Grok defers every MCP tool behind search_tool and use_tool. A bot asked
// "what connector do you have access to (mcp)" searched each server, then
// called tools one by one to see what they did (JC 2026-10-21: 25 calls).
// Each search is a full model round over the whole context (~20k tokens on
// grok 1.0.62). Sagax already asks Grok for its catalog before every prompt
// (`_x.ai/mcp/list`, grok.ts configureSession): it lists every server, its
// status and its tools by the exact name use_tool takes. That list, names
// only, rides the volatile half once per session (and again only when it
// changes), so:
//   - a question about connectors or tools is answered with no call;
//   - a known tool is called with use_tool directly, no search first.
// Measured on the local bench (perf/instant-tool-turns): see the PR.
import { GROK_KNOWN_TOOLS_SECTION } from "./grok-tool-usage.ts";

export interface GrokCatalogServer {
  name: string;
  /** ready, or why not (unavailable, failed, needs sign-in) */
  status: string;
  tools: string[];
}

const NAME = /^[\w .()@:-]{1,80}$/;
const TOOL = /^[A-Za-z0-9][\w.-]{0,63}$/;

/** The servers of an `_x.ai/mcp/list` answer (the request's `result`),
 * enabled ones only; undefined when the answer is unreadable. */
export function readGrokCatalog(result: unknown): GrokCatalogServer[] | undefined {
  const value = result as { servers?: unknown } | null | undefined;
  if (!value || !Array.isArray(value.servers)) return undefined;
  const servers: GrokCatalogServer[] = [];
  for (const raw of value.servers as Array<Record<string, any> | null>) {
    const name = typeof raw?.name === "string" ? raw.name.trim() : "";
    if (!name || !NAME.test(name)) continue;
    const session = raw?.session && typeof raw.session === "object" ? raw.session : {};
    if (session.enabled === false) continue;
    const status = session.authRequired === true && session.status !== "ready"
      ? "needs sign-in"
      : typeof session.status === "string" ? session.status.toLowerCase() : "unknown";
    const tools = Array.isArray(session.tools)
      ? session.tools
        .filter((tool: { name?: unknown; enabled?: unknown } | null) => tool && typeof tool.name === "string" && tool.enabled !== false && TOOL.test(tool.name))
        .map((tool: { name: string }) => tool.name)
      : [];
    servers.push({ name, status, tools: [...new Set<string>(tools)].sort((a, b) => a.localeCompare(b)) });
  }
  return servers.sort((a, b) => a.name.localeCompare(b.name));
}

// The last catalog per Grok session, so the volatile section (built right
// after configureSession, same turn) can read it. Bounded.
const CATALOGS_MAX = 256;
const catalogs = new Map<string, GrokCatalogServer[]>();

export function rememberGrokCatalog(sessionId: string, result: unknown): void {
  const servers = readGrokCatalog(result);
  if (!sessionId || !servers) return;
  catalogs.delete(sessionId);
  catalogs.set(sessionId, servers);
  while (catalogs.size > CATALOGS_MAX) catalogs.delete(catalogs.keys().next().value!);
}

export function grokCatalogFor(sessionId: string | undefined): GrokCatalogServer[] | undefined {
  return sessionId ? catalogs.get(sessionId) : undefined;
}

/** A server with more tools than this shows only the ones this bot uses
 * (known, pinned) and a count: Sagax's own agents server has ~70. */
export const GROK_CATALOG_SERVER_TOOLS_MAX = 40;
/** The whole section stays under this many characters (~900 tokens). */
export const GROK_CATALOG_CHARS_MAX = 3_600;

/** The section naming the catalog (and the bot's known and pinned tools),
 * or null when there is nothing to say. Same id as the known-tools section
 * it replaces, so prompt-split sends one or the other. Stable text for a
 * stable catalog: alphabetical, no counts that drift. */
export function grokCatalogSection(input: {
  catalog: readonly GrokCatalogServer[] | undefined;
  /** `<server>__<tool>` this bot used before (grok-tool-usage.ts) */
  known?: readonly string[];
  /** `<server>__<tool>` a feature opened for this conversation (turn-reach.ts) */
  pinned?: readonly string[];
  /** provider lines (turn-reach.ts) */
  lines?: readonly string[];
}): { id: string; text: string } | null {
  const catalog = input.catalog ?? [];
  const favored = new Set([...(input.known ?? []), ...(input.pinned ?? [])]);
  const ready = catalog.filter((server) => server.status === "ready" && server.tools.length > 0);
  const notReady = catalog.filter((server) => server.status !== "ready");
  const pinnedLines = input.lines?.filter(Boolean) ?? [];
  if (!ready.length && !notReady.length && !favored.size && !pinnedLines.length) return null;
  const rows: string[] = [];
  for (const server of ready) {
    if (server.tools.length <= GROK_CATALOG_SERVER_TOOLS_MAX) {
      rows.push(`- ${server.name}: ${server.tools.join(", ")}`);
      continue;
    }
    const mine = server.tools.filter((tool) => favored.has(`${server.name}__${tool}`));
    rows.push(`- ${server.name} (${server.tools.length} tools; search_tool for the others)${mine.length ? `: ${mine.join(", ")}` : ""}`);
  }
  // known or pinned tools on a server the catalog does not list yet
  const listed = new Set(ready.map((server) => server.name));
  const extra = [...favored].filter((name) => !listed.has(name.slice(0, name.indexOf("__")))).sort((a, b) => a.localeCompare(b));
  let text = (ready.length
    ? "Your MCP tools on this turn, by server. Call any of them directly with use_tool (tool_name <server>__<tool>), with no search_tool first; this list is complete, so answer what connectors, tools or access you have from it without calling a tool."
    : "MCP tools you can call directly with use_tool, with no search_tool first.") +
    (rows.length ? `\n${rows.join("\n")}` : "") +
    (extra.length ? `\n- also: ${extra.join(", ")}` : "") +
    (notReady.length ? `\nNot connected now: ${notReady.map((server) => `${server.name} (${server.status})`).join(", ")}.` : "") +
    (pinnedLines.length ? `\n${pinnedLines.join("\n")}` : "") +
    "\nPass tool_input from the tool's name and the request; if a call reports bad arguments, search_tool that one tool once. Independent reads go together in the same step.";
  if (text.length > GROK_CATALOG_CHARS_MAX) {
    // too many servers: keep the instructions and the server names
    const names = ready.map((server) => `${server.name} (${server.tools.length})`).join(", ");
    text = `Your MCP servers on this turn, with their tool counts: ${names}. Answer what connectors or access you have from this without calling a tool; use search_tool to find a tool, and call a tool you already saw directly with use_tool.` +
      (notReady.length ? ` Not connected now: ${notReady.map((server) => server.name).join(", ")}.` : "");
    text = text.slice(0, GROK_CATALOG_CHARS_MAX);
  }
  return { id: GROK_KNOWN_TOOLS_SECTION, text };
}

/** Test seam. */
export function resetGrokCatalogs(): void {
  catalogs.clear();
}
