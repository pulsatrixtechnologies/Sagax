// find_tool / use_tool for Sagax's own agents catalog.
//
// The model is shown two tools: find_tool searches the catalog and returns
// each match's arguments (its input schema), use_tool calls one result by
// name. Nothing is removed. Every catalog tool stays findable, and the call
// goes through the same checks and approvals as a listed tool.
//
// #1374: off unless SAGAX_CATALOG_BRIDGE=1, and only on a compact prompt
// (SAGAX_COMPACT_TOOLS, which the Claude Code driver alone sets). #1314:
// Grok, Codex and Pi keep the full list. They discover a tool from that
// list, and hiding one would make it unreachable. A use_tool is read as the
// tool it runs by every layer that decides on a call
// (shared/searched-tool-call.ts).
import { BRIDGE_FIND_TOOL, BRIDGE_USE_TOOL, readBridgeCall } from "../../shared/searched-tool-call.ts";

export interface CatalogBridgeTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
}

export function catalogBridgeOn(env: Record<string, string | undefined>): boolean {
  return env.SAGAX_CATALOG_BRIDGE === "1" && !!env.SAGAX_COMPACT_TOOLS;
}

export function catalogBridgeDefinitions(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return [
    {
      name: BRIDGE_FIND_TOOL,
      description: "Find a tool in Sagax's own catalog by a few words. Returns each match's name, description and arguments (inputSchema). Call use_tool with one name and arguments that follow that schema.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "What you want to do, in a few words." },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        required: ["query"],
      },
    },
    {
      name: BRIDGE_USE_TOOL,
      description: "Call one Sagax catalog tool by the name find_tool returned, with that tool's arguments as find_tool described them.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          arguments: { type: "object", additionalProperties: true },
        },
        required: ["name"],
      },
    },
  ];
}

export function applyCatalogBridge<T extends CatalogBridgeTool>(tools: readonly T[], env: Record<string, string | undefined>): readonly T[] | ReturnType<typeof catalogBridgeDefinitions> {
  return catalogBridgeOn(env) ? catalogBridgeDefinitions() : tools;
}

/** A description is kept whole up to this; past it, cut on a word. */
const DESCRIPTION_MAX = 1_000;

export interface CatalogMatch {
  name: string;
  description: string;
  /** The tool's own arguments, exactly as a direct listing shows them. */
  inputSchema: unknown;
  annotations?: unknown;
}

export function findCatalogTools(tools: readonly CatalogBridgeTool[], query: string, limit = 8): { matches: CatalogMatch[] } {
  const words = query.toLowerCase().split(/[^a-z0-9_]+/).filter((word) => word.length > 1);
  if (!words.length) return { matches: [] };
  const cap = Math.min(20, Math.max(1, Math.floor(limit) || 8));
  const matches = tools
    .filter((tool) => tool.name !== BRIDGE_FIND_TOOL && tool.name !== BRIDGE_USE_TOOL)
    .map((tool) => {
      const hay = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
      const score = words.reduce((count, word) => count + (hay.includes(word) ? 1 : 0), 0);
      return { tool, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, cap)
    .map(({ tool }): CatalogMatch => {
      const text = (tool.description ?? "").replace(/\s+/g, " ").trim();
      const description = text.length <= DESCRIPTION_MAX ? text : `${text.slice(0, DESCRIPTION_MAX).replace(/\s+\S*$/, "")} …`;
      return {
        name: tool.name,
        description,
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
        ...(tool.annotations !== undefined ? { annotations: tool.annotations } : {}),
      };
    });
  return { matches };
}

export function resolveCatalogUse(tools: readonly CatalogBridgeTool[], args: unknown): { name: string; arguments: Record<string, unknown> } | { error: string } {
  const call = readBridgeCall(BRIDGE_USE_TOOL, args);
  if (!call || call.kind !== "call") return { error: call?.kind === "refused" ? call.reason : "use_tool needs a catalog tool name from find_tool." };
  if (!tools.some((tool) => tool.name === call.tool)) return { error: `Unknown tool: ${call.tool}` };
  return { name: call.tool, arguments: call.arguments };
}

/** What the agents proxy does with one tools/call when the bridge is on:
 * answer find_tool itself, refuse a use_tool that runs nothing, or go on
 * with the call use_tool runs (same name and arguments as a direct call).
 * Any other name goes on unchanged. */
export function routeBridgeCall(tools: readonly CatalogBridgeTool[], name: string, args: unknown):
  | { kind: "answer"; text: string; isError: boolean }
  | { kind: "call"; name: string; arguments: unknown } {
  if (name === BRIDGE_FIND_TOOL) {
    const record = args && typeof args === "object" && !Array.isArray(args) ? args as { query?: unknown; limit?: unknown } : {};
    const query = typeof record.query === "string" ? record.query : "";
    const limit = typeof record.limit === "number" ? record.limit : 8;
    return { kind: "answer", text: JSON.stringify(findCatalogTools(tools, query, limit)), isError: false };
  }
  if (name !== BRIDGE_USE_TOOL) return { kind: "call", name, arguments: args };
  const resolved = resolveCatalogUse(tools, args);
  if ("error" in resolved) return { kind: "answer", text: resolved.error, isError: true };
  return { kind: "call", name: resolved.name, arguments: resolved.arguments };
}

export function catalogJsonBytes(tools: readonly unknown[]): number {
  return Buffer.byteLength(JSON.stringify(tools));
}
