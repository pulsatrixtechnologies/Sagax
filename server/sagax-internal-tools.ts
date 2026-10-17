// Sagax's own tools that stay inside what the person and their bot already
// own (JC, 2026-10-16): they never ask for approval, whatever the engine or
// the bot's level, as the agents tools never did on Claude, Codex and the
// chat engines. The rule is a reviewed list of exact names, never a prefix
// or a server's own claim:
//
// - the Data tools (server/data/tools.ts DATA_TOOLS): the bot's own DuckDB
//   database, and only where DuckDB itself cannot reach further: on an
//   organization server, where it is confined to the scope's own folders
//   with no network at all (data/engine.ts confineConnection; an https load
//   is downloaded by the server through the private-address guard). In
//   solo DuckDB is not confined, so SQL could read any file the person can
//   (`read_csv(chr(47)||...)`, `$$/etc/hosts$$`, `../../`): there only a
//   load of a file inside the bot's own workspace answers itself, and every
//   SQL, describe, show, export or remote load keeps its card
//   (sagaxInternalSelfAnswers);
// - the agents tools a member's bot runs in its own scope
//   (member-tool-scope.ts MEMBER_OWN_SCOPE_AGENT_TOOLS): each one is served
//   by a Sagax route that checks who the bot is and who it speaks for. The
//   host-level ones (act, add_mcp_server, attach_file, vm_exec, ...) are not
//   on that list and keep their card.
//
// Engines that ask anyway (Grok Build in default mode asks about every MCP
// call behind its use_tool) reach the server's approval path, which answers
// these with `sagax-internal` (auto-approve.ts) after the grant guard, the
// safety review and the person's own rules.
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve, sep } from "node:path";

import { DATA_TOOL_NAMES as DATA_SURFACE_TOOL_NAMES } from "../shared/data-surface.ts";
import { blockedAddressReason } from "./media-proxy-guard.ts";
import { memberOwnScopeTool } from "./member-tool-scope.ts";

/** The built-in Data server's name (reserved: mcp-registry.ts). */
export const DATA_MCP_SERVER = "data";

/** The Data tools, by exact name (shared/data-surface.ts). */
export const DATA_TOOL_NAMES: readonly string[] = DATA_SURFACE_TOOL_NAMES;

/** The Data tool a provider's tool name names, or null. Accepts the
 * spellings the engines use for Sagax's own `data` MCP server:
 * `mcp__data__data_load` (Claude), `data__data_load` (ACP titles, the
 * chat engines), `data.data_load` and `data:data_load`. */
export function dataToolName(name: string | undefined): string | null {
  const match = /^(?:mcp(?:__|[.:]))?data(?:__|[.:/])([a-z][a-z0-9_]{0,63})$/.exec(name?.trim() ?? "");
  return match && DATA_TOOL_NAMES.includes(match[1]!) ? match[1]! : null;
}

/** Whether a server Sagax did not mount itself could have spelled this
 * tool name (2026-10-17, leftovers of #690): a server named `mcp` whose
 * tool is `data__data_sql` reads `mcp__data__data_sql` on a chat engine,
 * the very spelling of the built-in Data tool on Claude. A built-in is
 * recognized by identity: its name is Sagax's only when no other server of
 * the turn could have produced it. `foreignServers`: the names of every
 * server mounted for the turn that is not Sagax's own (the configured ones,
 * the person's own connections). */
export function foreignToolSpelling(name: string | undefined, foreignServers: Iterable<string> = []): boolean {
  const folded = name?.trim().toLowerCase() ?? "";
  if (!folded) return false;
  for (const raw of foreignServers) {
    const server = raw.trim().toLowerCase();
    if (!server) continue;
    for (const lead of [server, `mcp__${server}`, `mcp.${server}`, `mcp:${server}`]) {
      if (folded.startsWith(`${lead}__`) || folded.startsWith(`${lead}.`) || folded.startsWith(`${lead}:`) || folded.startsWith(`${lead}/`)) return true;
    }
  }
  return false;
}

/** Why a tool is one of Sagax's own person-scoped tools, or null. A name
 * another server of the turn could have spelled is never one
 * (foreignToolSpelling). */
export function sagaxInternalTool(name: string | undefined, foreignServers?: Iterable<string>): "data" | "agents" | null {
  if (foreignServers && foreignToolSpelling(name, foreignServers)) return null;
  if (dataToolName(name)) return "data";
  return memberOwnScopeTool(name?.trim()) ? "agents" : null;
}

// ── what a Data call may do without a card (2026-10-16 security review) ──
//
// Data runs DuckDB inside the Sagax process: in solo on the person's own
// computer, unconfined; on an organization server confined to the scope's
// folders with no network (data/engine.ts). A text check of SQL cannot be
// trusted to stop a file read on an unconfined engine (string building,
// dollar quoting, relative paths), so (2026-10-17 re-review):
// - unconfined (solo): only data_load of a local file inside the bot's own
//   workspace answers itself; data_sql, data_describe, data_show,
//   data_export and every remote or database load keep their card;
// - confined (organization): the engine is the boundary; a call still keeps
//   its card when it visibly reaches out (a load of a file elsewhere, a
//   database connection, plain http, a non-https remote or a private,
//   loopback, link-local or metadata address, SQL that names a file or a
//   URL, an ATTACH, COPY, INSTALL or LOAD). Anything this cannot read keeps
//   its card too.

const DATA_SQL_REACHES_OUT = /\b(?:attach|copy|install|load|pragma|getenv|read_text|read_blob)\b/i;
/** Ways to build a place out of sight of QUOTED_PLACE: dollar quoting, chr()
 * and char() codes, an escaped string. The confined engine refuses them
 * anyway; here they only keep the card (defense in depth). */
const DATA_SQL_HIDDEN_PLACE = /\$[A-Za-z_]*\$|\b(?:chr|char|unhex|from_base64|decode)\s*\(|\bE'/i;
/** The arguments of the Data tools that carry SQL or a relation. */
const DATA_SQL_KEYS: ReadonlySet<string> = new Set(["sql", "target", "query", "table", "filter", "where"]);
const QUOTED_PLACE = /['"`]\s*(?:[/~\\]|[A-Za-z]:[\\/]|[A-Za-z][A-Za-z0-9+.-]*:\/\/)/;
const LOCAL_NAME = /(?:^localhost$|\.localhost$|\.local$|\.internal$|\.lan$|\.home$|\.corp$|\.svc$|\.cluster\.local$)/i;

function parsedObject(input: string | undefined): Record<string, unknown> | null {
  if (!input) return null;
  try {
    const value = JSON.parse(input) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function sqlTexts(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (!DATA_SQL_KEYS.has(key)) continue;
    if (typeof value === "string") out.push(value);
    else if (value !== undefined && value !== null) out.push(JSON.stringify(value));
  }
  return out;
}

/** An https URL on a public-looking host. A literal address must be public
 * (media-proxy-guard.ts ranges); a name must not be a local one. A name
 * that resolves to a private address is refused when the server downloads
 * it on an organization server (data/download.ts, the private-address
 * guard). In solo a remote load never answers itself
 * (sagaxInternalSelfAnswers). */
export function dataPublicHttps(source: string): boolean {
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password) return false;
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!host) return false;
  if (/^[\d.]+$/.test(host) || host.includes(":")) return blockedAddressReason(host) === null;
  if (!host.includes(".") || LOCAL_NAME.test(host)) return false;
  return true;
}

function insideRoots(path: string, roots: readonly string[]): boolean {
  const local = path === "~" || path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : path;
  if (!isAbsolute(local)) return false;
  const real = (value: string) => { try { return realpathSync(value); } catch { return value; } };
  let probe = resolve(local);
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const target = real(probe);
  return roots.some((root) => {
    const base = real(resolve(root));
    return target === base || target.startsWith(base + sep);
  });
}

/** Whether one of Sagax's own tool calls answers itself (no card). The
 * agents tools in the bot's own scope always do (each route checks who the
 * bot is). A Data call: see the block above; `roots` are the folders the
 * turn's Data scope reaches (its workspace and task folders), `confined`
 * says DuckDB itself is confined to them with no network (an organization
 * server, data/engine.ts). */
export function sagaxInternalSelfAnswers(name: string | undefined, input: string | undefined, roots: readonly string[], confined: boolean): boolean {
  const kind = sagaxInternalTool(name);
  if (kind === null) return false;
  if (kind === "agents") return true;
  const tool = dataToolName(name);
  const args = parsedObject(input);
  // Unconfined (solo): no SQL, describe, show or export answers itself.
  if (!confined && tool !== "data_load") return false;
  if (!args) return confined && (input === undefined || input.trim() === "" || input.trim() === "{}") ? tool !== "data_load" : false;
  if (tool === "data_load") {
    const source = typeof args.source === "string" ? args.source.trim() : "";
    const sourceKind = typeof args.kind === "string" ? args.kind : "auto";
    if (!source || sourceKind === "postgres" || sourceKind === "mysql") return false;
    if (/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(source)) return confined && dataPublicHttps(source);
    if (sourceKind === "url" || sourceKind === "gsheet") return false;
    // a relative path is read from the server's working folder: never
    if (!confined && (source.split(/[\\/]/).includes("..") || !(isAbsolute(source) || source === "~" || source.startsWith("~/")))) return false;
    return insideRoots(source, roots);
  }
  // data_export writes where the tool itself allows (its export roots). The
  // SQL a call carries must not name a file or a URL nor reach outside.
  return !sqlTexts(args).some((text) => QUOTED_PLACE.test(text) || DATA_SQL_REACHES_OUT.test(text) || DATA_SQL_HIDDEN_PLACE.test(text));
}
