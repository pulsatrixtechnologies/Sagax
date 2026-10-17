// 2026-10-17 (#695 follow-up): a saved server whose name Sagax now reserves
// is shown in the MCP settings with a rename (a free name offered) and a
// removal, instead of disappearing silently.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { McpReservedServers, type McpServers } from "./McpServersPanel";

afterEach(() => setLocale("en"));

const mcp = (reserved: Array<{ name: string; suggestedName?: string }>, busy: string | null = null) =>
  ({ reserved, busy, renameReserved: async () => undefined, remove: async () => undefined }) as unknown as McpServers;

describe("reserved MCP server names", () => {
  it("warns on each reserved server with its suggested name, rename and remove", () => {
    const html = renderToStaticMarkup(createElement(McpReservedServers, { mcp: mcp([{ name: "mcp", suggestedName: "mcp-server" }, { name: "a__b" }]) }));
    expect(html).toContain("“mcp” is not used: its name is reserved");
    expect(html).toContain("“a__b” is not used: its name is reserved");
    expect(html).toContain('value="mcp-server"');
    expect(html).toContain("Rename");
    expect(html).toContain("Remove");
    expect(html.match(/role="alert"/g)).toHaveLength(2);
  });

  it("renders nothing without a reserved server, and in French", () => {
    expect(renderToStaticMarkup(createElement(McpReservedServers, { mcp: mcp([]) }))).toBe("");
    setLocale("fr");
    expect(renderToStaticMarkup(createElement(McpReservedServers, { mcp: mcp([{ name: "mcp" }]) }))).toContain("« mcp » n&#x27;est pas utilisé");
  });
});
