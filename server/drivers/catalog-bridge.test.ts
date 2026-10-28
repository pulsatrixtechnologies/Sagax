import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import { applyCatalogBridge, catalogJsonBytes, findCatalogTools, resolveCatalogUse } from "./catalog-bridge.ts";

describe("Sagax catalog bridge", () => {
  const full = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1" }));

  // #1374, #1314: the full list unless SAGAX_CATALOG_BRIDGE=1 on a compact prompt (Claude Code)
  const ON = { SAGAX_CATALOG_BRIDGE: "1", SAGAX_COMPACT_TOOLS: "{}" };
  it("lists the full catalog unless SAGAX_CATALOG_BRIDGE=1 on a compact prompt", () => {
    expect(applyCatalogBridge(full, {})).toBe(full);
    expect(applyCatalogBridge(full, { SAGAX_CATALOG_BRIDGE: "1" })).toBe(full);
    expect(applyCatalogBridge(full, { SAGAX_CATALOG_BRIDGE: "0", SAGAX_COMPACT_TOOLS: "{}" })).toBe(full);
    expect(applyCatalogBridge(full, ON).map((tool) => tool.name)).toEqual(["find_tool", "use_tool"]);
  });

  it("finds every catalog tool with its arguments and refuses an unknown name", () => {
    const listed = applyCatalogBridge(full, ON);
    expect(listed.map((tool) => tool.name)).toEqual(["find_tool", "use_tool"]);
    const found = findCatalogTools(full, "memory update");
    const memory = found.matches.find((match) => match.name === "memory_update");
    expect(memory?.inputSchema).toEqual(full.find((tool) => tool.name === "memory_update")?.inputSchema);
    for (const tool of full) {
      expect(resolveCatalogUse(full, { name: tool.name, arguments: { text: "note" } })).toEqual({ name: tool.name, arguments: { text: "note" } });
    }
    expect(resolveCatalogUse(full, { name: "no_such_tool" })).toEqual({ error: "Unknown tool: no_such_tool" });
    expect(resolveCatalogUse(full, { name: "use_tool" })).toMatchObject({ error: expect.stringContaining("find_tool") });
    const fullBytes = catalogJsonBytes(full);
    const bridgeBytes = catalogJsonBytes(listed);
    expect(bridgeBytes, `full=${fullBytes} bridge=${bridgeBytes} tools=${full.length}`).toBeLessThan(fullBytes);
  });
});