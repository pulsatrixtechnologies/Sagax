// Families of agents tools listed as one tool (agents-merged.ts): pinned as
// the JSON the engines that list the whole catalog receive, measured against
// the same catalog by tool, and read everywhere as the tool they run.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MERGED_AGENT_TOOLS, readMergedCall } from "../../shared/merged-agent-tools.ts";
import { permissionRoute, readBridgeCall, unwrapAgentsBridge } from "../../shared/searched-tool-call.ts";
import { availableTools, catalogProfileFromEnv, withDeferredRareTools } from "./agents-catalog.ts";
import { mergeByAction } from "./agents-merged.ts";

const GOLDENS = join(dirname(fileURLToPath(import.meta.url)), "agents-catalog-goldens");
const UPDATE = process.env.UPDATE_AGENTS_CATALOG_GOLDENS === "1";
const FULL = {
  direct: { SAGAX_SKILL_AUTHORING_ENABLED: "1", SAGAX_SHARED_COMPUTERS_ENABLED: "1", SAGAX_VOICE_NOTES: "1", SAGAX_CHIEF_OF_STAFF: "1" },
  room: { SAGAX_ROOM_TURN: "1", SAGAX_GROUP_TURN: "1", SAGAX_OWN_THREAD_CREATION: "1", SAGAX_SKILL_AUTHORING_ENABLED: "1", SAGAX_SHARED_COMPUTERS_ENABLED: "1", SAGAX_VOICE_NOTES: "1", SAGAX_CHIEF_OF_STAFF: "1" },
  external: { SAGAX_EXTERNAL_RUNTIME: "1" },
} as const;
const bytes = (tools: unknown[]) => Buffer.byteLength(JSON.stringify({ tools }));

describe("agents tools listed by family", () => {
  for (const [name, env] of Object.entries(FULL)) {
    it(`pins and measures the ${name} listing`, () => {
      const tools = availableTools(catalogProfileFromEnv(env));
      const merged = mergeByAction(tools);
      const file = join(GOLDENS, `${name}-merged.tools-list.json`);
      const text = `${JSON.stringify({ tools: merged }, null, 2)}\n`;
      if (UPDATE || !existsSync(file)) writeFileSync(file, text);
      expect(text).toBe(readFileSync(file, "utf8"));
      const before = bytes(tools), after = bytes(merged);
      console.log(`[agents-merged] ${name}: ${tools.length} tools, ${before} B -> ${merged.length} tools, ${after} B (-${(100 * (before - after) / before).toFixed(1)}%)`);
      expect(after).toBeLessThanOrEqual(before);
      // Nothing lost: every tool is listed on its own or as an action of its family.
      const listed = new Set(merged.flatMap((tool) => {
        const actions = (tool.inputSchema as { properties?: { tool?: { enum?: string[] } } } | undefined)?.properties?.tool?.enum;
        return Object.hasOwn(MERGED_AGENT_TOOLS, tool.name) && actions ? actions : [tool.name];
      }));
      expect([...listed].sort()).toEqual(tools.map((tool) => tool.name).sort());
      // Every description and argument of a merged tool is still there.
      for (const tool of tools) {
        const family = merged.find((entry) => (entry.inputSchema as { properties?: { tool?: { enum?: string[] } } }).properties?.tool?.enum?.includes(tool.name));
        if (!family) continue;
        expect(family.description).toContain(`- ${tool.name}: ${tool.description}`);
        for (const argument of Object.keys((tool.inputSchema as { properties?: object }).properties ?? {})) {
          expect(Object.keys((family.inputSchema as { properties: object }).properties)).toContain(argument);
        }
      }
    });
  }

  it("merges every family member of the widest profiles, with no clashing argument", () => {
    const merged = mergeByAction(availableTools(catalogProfileFromEnv(FULL.direct)));
    for (const [family, members] of Object.entries(MERGED_AGENT_TOOLS)) {
      const tool = merged.find((entry) => entry.name === family);
      expect(tool, family).toBeDefined();
      expect((tool!.inputSchema as { properties: { tool: { enum: string[] } } }).properties.tool.enum).toEqual(members);
    }
  });

  it("defers a family behind tool search only when every member was", () => {
    const profile = catalogProfileFromEnv(FULL.direct);
    const merged = mergeByAction(withDeferredRareTools(availableTools(profile), profile));
    expect(merged.find((tool) => tool.name === "cloud_agents")?._meta).toEqual({ "anthropic/alwaysLoad": false });
  });

  it("reads a family call everywhere as the tool it runs, and refuses one that names none", () => {
    expect(readMergedCall("artifacts", { tool: "delete_artifact", artifact_id: "a1" }))
      .toEqual({ kind: "call", tool: "delete_artifact", arguments: { artifact_id: "a1" } });
    expect(readBridgeCall("artifacts", { tool: "list_bots" })).toMatchObject({ kind: "refused" });
    expect(readBridgeCall("artifacts", {})).toMatchObject({ kind: "refused" });
    expect(unwrapAgentsBridge("mcp__agents__cloud_agents", { tool: "get_cloud_agent", cloud_agent_id: "ca_1" }))
      .toEqual({ name: "mcp__agents__get_cloud_agent", input: { cloud_agent_id: "ca_1" }, unwrapped: true });
    // use_tool may not reach a family tool: it names the tool itself
    expect(readBridgeCall("use_tool", { name: "artifacts", arguments: { tool: "list_artifacts" } })).toMatchObject({ kind: "refused" });
  });

  it("approves a family call as the tool it runs, never as the family", () => {
    // a pre-allowed target runs unasked; any other asks about the real tool
    expect(permissionRoute("mcp__agents__artifacts", { tool: "list_artifacts" }, new Set(), ["mcp__agents__list_artifacts"])).toEqual({ kind: "allow" });
    expect(permissionRoute("mcp__agents__artifacts", { tool: "delete_artifact", artifact_id: "a1" }, new Set(), ["mcp__agents__list_artifacts"]))
      .toEqual({ kind: "ask", tool: "mcp__agents__delete_artifact", input: { artifact_id: "a1" }, searched: true });
    expect(permissionRoute("mcp__agents__artifacts", { tool: "nope" }, new Set(), [])).toMatchObject({ kind: "deny" });
  });
});
