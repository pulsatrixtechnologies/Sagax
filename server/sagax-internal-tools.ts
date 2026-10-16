// Sagax's own tools that stay inside what the person and their bot already
// own (JC, 2026-10-16): they never ask for approval, whatever the engine or
// the bot's level, as the agents tools never did on Claude, Codex and the
// chat engines. The rule is a reviewed list of exact names, never a prefix
// or a server's own claim:
//
// - the Data tools (server/data/tools.ts DATA_TOOLS): the bot's own DuckDB
//   database. On an organization server it is confined to the bot's own
//   folders and https (data/engine.ts confineConnection), so a load can no
//   longer read the server's files or its private network;
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
import { DATA_TOOL_NAMES as DATA_SURFACE_TOOL_NAMES } from "../shared/data-surface.ts";
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

/** Why a tool is one of Sagax's own person-scoped tools, or null. */
export function sagaxInternalTool(name: string | undefined): "data" | "agents" | null {
  if (dataToolName(name)) return "data";
  return memberOwnScopeTool(name?.trim()) ? "agents" : null;
}
