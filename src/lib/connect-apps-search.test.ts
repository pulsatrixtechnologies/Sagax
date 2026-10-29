import { describe, expect, it } from "vitest";

import { buildPluginItems } from "@/lib/plugins-model";
import { catalogSections, catalogTemplates, type CatalogItem } from "@/lib/bot-catalog";
import { foldedMatch, GROUP_PREVIEW, moveActive, searchConnectApps, visibleResults, type SearchGroupId } from "./connect-apps-search";

const items = buildPluginItems({
  servers: [{ name: "docs-server", enabled: true, url: "https://mcp.example.com/docs", auth: "none" }],
  featured: [{ id: "linear", name: "Linear", description: "Issues and projects", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "oauth" }],
  skills: [{ name: "release-notes", description: "Writes release notes", source: "local-import", enabled: true }],
  marketplaces: [{ name: "example-market", plugins: [{ name: "code-review", description: "Reviews a pull request", installed: false, servers: [], skills: [] }] }],
});
const catalog: CatalogItem[] = catalogSections(
  { organization: true, entries: [
    { id: "b1", name: "Quill", title: "Release notes", description: "Turns merged changes into notes", look: { color: "green" }, owner: { principalId: "p2", name: "Example teammate" }, source: "shared", archived: false, primary: false },
    { id: "b2", name: "Compass", title: "Onboarding guide", description: "First week", look: { color: "purple" }, owner: { principalId: "p3", name: "Example admin" }, source: "organization", archived: false, primary: false, catalog: { published: true, featured: true } },
  ] },
  catalogTemplates([], undefined, { xai: [{ slug: "market-bot", name: "Market Researcher", creator: "xAI", description: "Release radar", categories: ["Research"], color: "blue", shape: "pebble", url: "https://x.ai/bot/market-bot" }] }),
  { category: "all", query: "", showArchived: true, app: null },
).flatMap((section) => section.items);
const pages = [{ id: "pg1", title: "Release dashboard", status: "Published" }];
const sources = [{ id: "github", name: "GitHub connection" }, { id: "market:example-market", name: "example-market", detail: "example-org/market" }];
const ids = (query: string) => searchConnectApps({ query, items, catalog, pages, sources }).map((group) => group.id);

describe("Connect Apps' one search (2026-10-29)", () => {
  it("is empty without text: every tab shows its own list", () => {
    expect(searchConnectApps({ query: "  ", items, catalog, pages, sources })).toEqual([]);
  });

  it("looks everywhere and groups by kind, in one order", () => {
    // a skill, a bot (shared), templates (an xAI Marketplace bot too) and a page
    expect(ids("release")).toEqual(["skills", "bots", "templates", "pages"]);
    expect(ids("code review")).toEqual(["plugins"]);
    expect(ids("linear")).toEqual(["apps"]);
    expect(ids("docs-server")).toEqual(["mcp"]);
    expect(ids("github")).toEqual(["sources"]);
    expect(ids("example-org")).toEqual(["sources"]);
  });

  it("finds a bot by name, role or creator, a template from the xAI Bot Marketplace, accents and case ignored", () => {
    const bots = (query: string) => searchConnectApps({ query, items, catalog, pages, sources }).find((group) => group.id === "bots")?.results.map((result) => result.kind === "catalog" ? result.item.key : "");
    expect(bots("QUILL")).toEqual(["bot:b1"]);
    expect(bots("onboarding")).toEqual(["bot:b2"]);
    expect(bots("example admin")).toEqual(["bot:b2"]);
    const templates = searchConnectApps({ query: "market researcher", items, catalog, pages, sources }).find((group) => group.id === "templates");
    expect(templates?.results).toHaveLength(1);
    expect(foldedMatch("Équipe Ventes", "equipe")).toBe(true);
  });

  it("lists a bot once even when it is in two sections (Featured and Organization)", () => {
    const group = searchConnectApps({ query: "compass", items, catalog, pages, sources }).find((entry) => entry.id === "bots");
    expect(group?.results).toHaveLength(1);
  });

  it("the keyboard walks the rows on screen and wraps", () => {
    const many = Array.from({ length: GROUP_PREVIEW + 3 }, (_, index) => ({ id: `p${index}`, title: `Report ${index}` }));
    const groups = searchConnectApps({ query: "report", items: [], catalog: [], pages: many, sources: [] });
    expect(visibleResults(groups, new Set())).toHaveLength(GROUP_PREVIEW);
    expect(visibleResults(groups, new Set<SearchGroupId>(["pages"]))).toHaveLength(GROUP_PREVIEW + 3);
    expect(moveActive(-1, 3, 1)).toBe(0);
    expect(moveActive(-1, 3, -1)).toBe(2);
    expect(moveActive(2, 3, 1)).toBe(0);
    expect(moveActive(0, 3, -1)).toBe(2);
    expect(moveActive(0, 0, 1)).toBe(-1);
  });
});
