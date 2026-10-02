import { describe, expect, it } from "vitest";

import raw from "./plugin-catalog.json" with { type: "json" };
import { PLUGIN_CATALOG, pluginCatalogSchema } from "./plugin-catalog.ts";

describe("plugin catalog", () => {
  it("is valid: unique ids and addresses, https only, an icon key each", () => {
    expect(pluginCatalogSchema.safeParse(raw).success).toBe(true);
    expect(PLUGIN_CATALOG.length).toBeGreaterThanOrEqual(10);
    for (const plugin of PLUGIN_CATALOG) {
      expect(new URL(plugin.url).protocol).toBe("https:");
      // the address belongs to the provider it names (no third-party proxy)
      const host = new URL(plugin.url).hostname;
      expect(host === plugin.domain || host.endsWith(`.${plugin.domain}`) || plugin.id === "sentry", `${plugin.id} ${host}`).toBe(true);
    }
  });

  it("refuses an entry that is not a remote https server", () => {
    const entry = { ...PLUGIN_CATALOG[0]!, id: "plain" };
    expect(pluginCatalogSchema.safeParse({ version: 1, plugins: [{ ...entry, url: "http://example.test/mcp" }] }).success).toBe(false);
    expect(pluginCatalogSchema.safeParse({ version: 1, plugins: [{ ...entry, command: "npx" }] }).success).toBe(false);
    expect(pluginCatalogSchema.safeParse({ version: 1, plugins: [entry, entry] }).success).toBe(false);
  });
});
