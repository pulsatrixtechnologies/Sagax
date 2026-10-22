import { afterEach, describe, expect, it } from "vitest";
import {
  GROK_CATALOG_CHARS_MAX,
  grokCatalogFor,
  grokCatalogSection,
  readGrokCatalog,
  rememberGrokCatalog,
  resetGrokCatalogs,
} from "./grok-tool-catalog.ts";
import { GROK_KNOWN_TOOLS_SECTION } from "./grok-tool-usage.ts";

afterEach(() => resetGrokCatalogs());

// the shape grok 1.0.62 answers `_x.ai/mcp/list` with (measured 2026-10-22)
const LIST = {
  sessionMcpResolved: true,
  servers: [
    { name: "remote", source: "local", type: "stdio", session: { enabled: true, status: "ready", tools: [
      { name: "status", description: "Status", enabled: true }, { name: "diagnostics", description: "Health", enabled: true },
      { name: "shell", description: "Run", enabled: false },
    ] } },
    { name: "perspicax", source: "local", type: "stdio", session: { enabled: true, status: "ready", tools: [
      { name: "cw_psa_get_ticket", enabled: true }, { name: "api_list", enabled: true },
    ] } },
    { name: "vercel", source: "local", session: { enabled: true, status: "unavailable", authRequired: true } },
    { name: "off", session: { enabled: false, status: "ready", tools: [{ name: "x" }] } },
  ],
};

describe("readGrokCatalog", () => {
  it("keeps enabled servers and tools, by name, sorted", () => {
    expect(readGrokCatalog(LIST)).toEqual([
      { name: "perspicax", status: "ready", tools: ["api_list", "cw_psa_get_ticket"] },
      { name: "remote", status: "ready", tools: ["diagnostics", "status"] },
      { name: "vercel", status: "needs sign-in", tools: [] },
    ]);
    expect(readGrokCatalog(null)).toBeUndefined();
    expect(readGrokCatalog({ servers: "x" })).toBeUndefined();
  });

  it("remembers the last catalog per session", () => {
    rememberGrokCatalog("s1", LIST);
    expect(grokCatalogFor("s1")?.map((server) => server.name)).toEqual(["perspicax", "remote", "vercel"]);
    expect(grokCatalogFor("s2")).toBeUndefined();
    rememberGrokCatalog("s1", { garbage: true });
    expect(grokCatalogFor("s1")).toHaveLength(3);
  });
});

describe("grokCatalogSection", () => {
  it("names every ready tool by its use_tool name, with the no-search and no-call rules", () => {
    const section = grokCatalogSection({ catalog: readGrokCatalog(LIST) })!;
    expect(section.id).toBe(GROK_KNOWN_TOOLS_SECTION);
    expect(section.text).toContain("- perspicax: api_list, cw_psa_get_ticket");
    expect(section.text).toContain("- remote: diagnostics, status");
    expect(section.text).toContain("no search_tool first");
    expect(section.text).toContain("without calling a tool");
    expect(section.text).toContain("Not connected now: vercel (needs sign-in)");
    expect(section.text).not.toContain("shell");
  });

  it("is the same text for the same catalog (sent once per session)", () => {
    const a = grokCatalogSection({ catalog: readGrokCatalog(LIST), known: ["perspicax__api_list"] });
    const b = grokCatalogSection({ catalog: readGrokCatalog({ ...LIST, servers: [...LIST.servers].reverse() }), known: ["perspicax__api_list"] });
    expect(a).toEqual(b);
  });

  it("shows only the bot's own tools of a very large server, with a count", () => {
    const tools = Array.from({ length: 70 }, (_, i) => ({ name: `tool_${String(i).padStart(2, "0")}`, enabled: true }));
    const catalog = readGrokCatalog({ servers: [{ name: "agents", session: { enabled: true, status: "ready", tools } }] });
    const section = grokCatalogSection({ catalog, known: ["agents__tool_07"], pinned: ["agents__tool_42"] })!;
    expect(section.text).toContain("- agents (70 tools; search_tool for the others): tool_07, tool_42");
    expect(section.text).not.toContain("tool_08");
  });

  it("offers pinned tools and their lines even before the catalog is read", () => {
    const section = grokCatalogSection({ catalog: undefined, pinned: ["agents__remote_session_snapshot"], lines: ["Remote session open on MAC-DEMO-01."] })!;
    expect(section.text).toContain("also: agents__remote_session_snapshot");
    expect(section.text).toContain("Remote session open on MAC-DEMO-01.");
    expect(grokCatalogSection({ catalog: [] })).toBeNull();
  });

  it("stays under its budget with many servers", () => {
    const servers = Array.from({ length: 40 }, (_, s) => ({ name: `server_${s}`, session: { enabled: true, status: "ready",
      tools: Array.from({ length: 30 }, (_, i) => ({ name: `a_rather_long_tool_name_${i}`, enabled: true })) } }));
    const section = grokCatalogSection({ catalog: readGrokCatalog({ servers }) })!;
    expect(section.text.length).toBeLessThanOrEqual(GROK_CATALOG_CHARS_MAX);
    expect(section.text).toContain("server_0 (30)");
  });
});
