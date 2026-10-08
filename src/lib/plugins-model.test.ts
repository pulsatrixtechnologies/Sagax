import { describe, expect, it } from "vitest";

import { buildPluginItems, categoryFor, connectedSummary, installedPlugins, mainSections, matchesFilter } from "./plugins-model";

const sources = {
  cards: [
    { slug: "slack", label: "Slack", blurb: "Post updates", logo: null, domain: "slack.com" },
    { slug: "notion", label: "Notion", blurb: "Pages", logo: null, domain: "notion.so" },
    { slug: "weather", label: "Weather", blurb: "Forecasts", logo: null, domain: null, noAuth: true },
    { slug: "bitwarden", label: "Bitwarden", blurb: "Vault", logo: null, domain: "bitwarden.com" },
  ],
  status: { slack: { connected: true, accounts: [{ id: "a1", status: "ACTIVE" }] } },
  servers: [
    { name: "docs", enabled: true, url: "https://mcp.example.com/mcp", auth: "required" },
    { name: "notes", enabled: false, command: "npx" },
  ],
  featured: [
    { id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "oauth" },
    { id: "same", name: "Docs", description: "Already added", url: "https://mcp.example.com/mcp", domain: "example.com", auth: "none" },
  ],
  skills: [{ name: "release-notes", description: "Writes notes", source: "local-import", enabled: true }],
};

describe("the Plugins panel's one list", () => {
  it("reads every source into rows with the right button and status", () => {
    const items = buildPluginItems(sources);
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    expect(byKey["app:slack"]).toMatchObject({ installed: true, status: "connected", action: null, category: "communication" });
    expect(byKey["app:notion"]).toMatchObject({ installed: false, action: "connect", category: "productivity" });
    expect(byKey["app:weather"]).toMatchObject({ installed: true, status: "connected" });
    expect(byKey["mcp:docs"]).toMatchObject({ installed: true, status: "needs_auth", source: "manual" });
    expect(byKey["mcp:notes"]).toMatchObject({ status: "off" });
    expect(byKey["featured:linear"]).toMatchObject({ action: "connect", category: "code" });
    // a catalog plugin already added shows once, as the server it became
    expect(byKey["featured:same"]).toBeUndefined();
    expect(byKey["skill:release-notes"]).toMatchObject({ source: "local", installed: true });
  });

  it("files apps under the reference categories", () => {
    expect(categoryFor("1password")).toBe("passwords");
    expect(categoryFor("figma", "Figma")).toBe("design");
    expect(categoryFor("github")).toBe("code");
    expect(categoryFor("gmail")).toBe("communication");
    expect(categoryFor("googlecalendar")).toBe("productivity");
    expect(categoryFor("acme-internal")).toBe("other");
  });

  it("keeps Connected apps, MCP servers and Skills as filters, not tabs", () => {
    const items = buildPluginItems(sources);
    expect(items.filter((item) => matchesFilter(item, "apps")).map((item) => item.kind)).toEqual(["app", "app", "app", "app"]);
    expect(new Set(items.filter((item) => matchesFilter(item, "mcp")).map((item) => item.kind))).toEqual(new Set(["mcp", "featured"]));
    expect(items.filter((item) => matchesFilter(item, "skills")).map((item) => item.key)).toEqual(["skill:release-notes"]);
  });

  it("shows sections per category, one list for a search across apps and skills", () => {
    const items = buildPluginItems(sources);
    const sections = mainSections(items, "", "all");
    expect(sections.map((section) => section.id)).toEqual(["recommended", "productivity", "communication", "code", "passwords", "mcp", "skills", "other"]);
    const search = mainSections(items, "notes", "all");
    expect(search).toHaveLength(1);
    expect(search[0]!.items.map((item) => item.key).sort()).toEqual(["mcp:notes", "skill:release-notes"]);
    expect(mainSections(items, "", "passwords")[0]!.items.map((item) => item.id)).toEqual(["bitwarden"]);
  });

  it("counts connected plugins for the header, skills apart", () => {
    const items = buildPluginItems(sources);
    expect(installedPlugins(items).map((item) => item.key)).toEqual(["mcp:docs", "mcp:notes", "app:slack", "app:weather"]);
    const summary = connectedSummary(items);
    expect(summary.count).toBe(2);
    expect(summary.icons.map((item) => item.key)).toEqual(["app:slack", "app:weather"]);
  });
});

describe("Whop, an MCP server connected like an app", () => {
  it("is one app row with Connect until signed in, then shows as connected and folds its server under it", () => {
    const before = buildPluginItems({ ...sources, whop: { description: "Sell on Whop", connected: false } });
    expect(before.find((item) => item.key === "whop:whop")).toMatchObject({ name: "Whop", action: "connect", installed: false });
    const after = buildPluginItems({
      ...sources,
      servers: [...sources.servers, { name: "business", enabled: true, url: "https://mcp.whop.com/mcp", auth: "connected" }],
      whop: { description: "Sell on Whop", server: "business", connected: true },
    });
    expect(after.find((item) => item.key === "whop:whop")).toMatchObject({ installed: true, status: "connected", action: null });
    expect(after.find((item) => item.key === "mcp:business")).toMatchObject({ parent: "whop:whop" });
    expect(installedPlugins(after).map((item) => item.key)).toContain("whop:whop");
    expect(installedPlugins(after).map((item) => item.key)).not.toContain("mcp:business");
  });
});

