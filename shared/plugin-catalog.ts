// The curated Plugins list (iOS parity 15, and the desktop's Plugins tab;
// docs/superpowers/specs/2026-09-30-mcp-sign-in-and-plugin-catalog-design.md
// Part B). Every entry is a real remote MCP server at its provider's own
// official address. `icon` is a key: clients draw a bundled icon for it, or
// the provider's monogram; nothing is hot-linked.
import { z } from "zod";

import catalog from "./plugin-catalog.json" with { type: "json" };

export const PLUGIN_AUTH = ["oauth", "api-key", "none"] as const;

export const pluginCatalogEntrySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  name: z.string().min(1).max(60),
  description: z.string().min(1).max(200),
  url: z.string().url().refine((value) => value.startsWith("https://"), { error: "url must be https" }),
  transport: z.enum(["http", "sse"]),
  auth: z.enum(PLUGIN_AUTH),
  icon: z.string().regex(/^[a-z0-9-]{1,40}$/),
  domain: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/),
  docsUrl: z.string().url().refine((value) => value.startsWith("https://"), { error: "docsUrl must be https" }),
  /** For a server without dynamic client registration. */
  clientId: z.string().min(1).max(512).optional(),
  /** For auth "api-key": the header the key goes in. */
  apiKeyHeader: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
}).strict();

export type PluginCatalogEntry = z.infer<typeof pluginCatalogEntrySchema>;

export const pluginCatalogSchema = z.object({
  version: z.literal(1),
  plugins: z.array(pluginCatalogEntrySchema).max(200),
}).strict().superRefine((value, ctx) => {
  const ids = new Set<string>();
  const urls = new Set<string>();
  for (const [index, plugin] of value.plugins.entries()) {
    if (ids.has(plugin.id)) ctx.addIssue({ code: "custom", path: ["plugins", index, "id"], message: `duplicate id ${plugin.id}` });
    if (urls.has(plugin.url)) ctx.addIssue({ code: "custom", path: ["plugins", index, "url"], message: `duplicate url ${plugin.url}` });
    if (plugin.auth === "api-key" && !plugin.apiKeyHeader) ctx.addIssue({ code: "custom", path: ["plugins", index], message: "api-key needs apiKeyHeader" });
    ids.add(plugin.id);
    urls.add(plugin.url);
  }
});

/** The featured list, validated once. */
export const PLUGIN_CATALOG: readonly PluginCatalogEntry[] = Object.freeze(pluginCatalogSchema.parse(catalog).plugins);
