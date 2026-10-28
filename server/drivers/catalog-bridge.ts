// find_tool / use_tool for Sagax's own agents catalog.
//
// On unless SAGAX_CATALOG_BRIDGE=0. The model is shown two tools:
// find_tool searches the catalog, use_tool calls one result by name.
// Nothing is removed. Every catalog tool stays findable, and the call
// goes through the same checks and approvals as a listed tool.
// SAGAX_CATALOG_BRIDGE=0 lists the catalog in full, exactly as before.

export interface CatalogBridgeTool {
  name: string;
  description?: string;
}

export function catalogBridgeOn(env: Record<string, string | undefined>): boolean {
  return env.SAGAX_CATALOG_BRIDGE !== "0";
}

export function catalogBridgeDefinitions(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
  return [
    {
      name: "find_tool",
      description: "Find a tool in Sagax's own catalog by a few words. Returns names and short descriptions. Call use_tool with one name.",
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
      name: "use_tool",
      description: "Call one Sagax catalog tool by the name find_tool returned, with that tool's arguments.",
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

export function findCatalogTools(tools: readonly CatalogBridgeTool[], query: string, limit = 8): { matches: Array<{ name: string; description: string }> } {
  const words = query.toLowerCase().split(/[^a-z0-9_]+/).filter((word) => word.length > 1);
  if (!words.length) return { matches: [] };
  const cap = Math.min(20, Math.max(1, Math.floor(limit) || 8));
  const matches = tools
    .filter((tool) => tool.name !== "find_tool" && tool.name !== "use_tool")
    .map((tool) => {
      const hay = `${tool.name} ${tool.description ?? ""}`.toLowerCase();
      const score = words.reduce((count, word) => count + (hay.includes(word) ? 1 : 0), 0);
      return { tool, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, cap)
    .map((row) => ({ name: row.tool.name, description: (row.tool.description ?? "").replace(/\s+/g, " ").trim().slice(0, 160) }));
  return { matches };
}

export function resolveCatalogUse(tools: readonly CatalogBridgeTool[], args: { name?: unknown; arguments?: unknown }): { name: string; arguments: Record<string, unknown> } | { error: string } {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name || name === "find_tool" || name === "use_tool") return { error: "use_tool needs a catalog tool name from find_tool." };
  if (!tools.some((tool) => tool.name === name)) return { error: `Unknown tool: ${name}` };
  const input = args.arguments && typeof args.arguments === "object" && !Array.isArray(args.arguments) ? args.arguments as Record<string, unknown> : {};
  return { name, arguments: input };
}

export function catalogJsonBytes(tools: readonly unknown[]): number {
  return Buffer.byteLength(JSON.stringify(tools));
}
