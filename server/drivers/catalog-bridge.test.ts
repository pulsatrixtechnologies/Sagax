import { describe, expect, it } from "vitest";

import { availableTools, catalogProfileFromEnv } from "./agents-catalog.ts";
import { applyCatalogBridge, catalogJsonBytes, findCatalogTools, resolveCatalogUse } from "./catalog-bridge.ts";

describe("Sagax catalog bridge", () => {
  const full = availableTools(catalogProfileFromEnv({ SAGAX_BOT_ID: "b1" }));

  it("leaves the catalog unchanged unless the bridge is on", () => {
    expect(applyCatalogBridge(full, {}).map((tool) => tool.name)).toEqual(full.map((tool) => tool.name));
    expect(applyCatalogBridge(full, { SAGAX_CATALOG_BRIDGE: "0" })).toBe(full);
  });

  it("lists find_tool and use_tool, finds a catalog tool, and refuses an unknown name", () => {
    const listed = applyCatalogBridge(full, { SAGAX_CATALOG_BRIDGE: "1" });
    expect(listed.map((tool) => tool.name)).toEqual(["find_tool", "use_tool"]);
    const found = findCatalogTools(full, "memory update");
    expect(found.matches.some((match) => match.name === "memory_update")).toBe(true);
    expect(resolveCatalogUse(full, { name: "memory_update", arguments: { text: "note" } })).toEqual({ name: "memory_update", arguments: { text: "note" } });
    expect(resolveCatalogUse(full, { name: "no_such_tool" })).toEqual({ error: "Unknown tool: no_such_tool" });
    expect(resolveCatalogUse(full, { name: "use_tool" })).toMatchObject({ error: expect.stringContaining("find_tool") });
    const fullBytes = catalogJsonBytes(full);
    const bridgeBytes = catalogJsonBytes(listed);
    expect(bridgeBytes, `full=${fullBytes} bridge=${bridgeBytes} tools=${full.length}`).toBeLessThan(fullBytes);
  });
});