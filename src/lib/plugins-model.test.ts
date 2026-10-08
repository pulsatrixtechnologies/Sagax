import { describe, expect, it } from "vitest";

import { appKey, buildPluginItems, categoryFromTags, connectedSummary, installedPlugins, mainSections, matchesFilter, matchesType } from "./plugins-model";

const sources = {
  cards: [
    { slug: "slack", label: "Slack", blurb: "Post updates", logo: null, domain: "slack.com", categories: ["collaboration & communication"] },
    { slug: "notion", label: "Notion", blurb: "Pages", logo: null, domain: "notion.so", categories: ["productivity"] },
    { slug: "weather", label: "Weather", blurb: "Forecasts", logo: null, domain: null, noAuth: true },
    { slug: "bitwarden", label: "Bitwarden", blurb: "Vault", logo: null, domain: "bitwarden.com", categories: ["password managers"] },
  ],
  status: { slack: { connected: true, accounts: [{ id: "a1", status: "ACTIVE" }] } },
  servers: [
    { name: "docs", enabled: true, url: "https://mcp.example.com/mcp", auth: "required" },
    { name: "notes", enabled: false, command: "npx" },
  ],
  featured: [
    { id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "mcp.linear.app", site: "linear.app", category: "code", auth: "oauth" },
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
    expect(byKey["featured:linear"]).toMatchObject({ action: "connect", category: "code", domain: "linear.app", recommended: true });
    // a catalog plugin already added shows once, as the server it became
    expect(byKey["featured:same"]).toBeUndefined();
    expect(byKey["skill:release-notes"]).toMatchObject({ source: "local", installed: true });
  });

  it("files apps under the categories their catalog tags give, Other without a tag", () => {
    expect(categoryFromTags(["password managers"])).toBe("passwords");
    expect(categoryFromTags(["design & creative tools"])).toBe("design");
    expect(categoryFromTags(["developer tools"])).toBe("code");
    expect(categoryFromTags(["collaboration & communication"])).toBe("communication");
    expect(categoryFromTags(["document & file management"])).toBe("productivity");
    expect(categoryFromTags(["crm"])).toBe("sales");
    expect(categoryFromTags(["accounting"])).toBe("finance");
    expect(categoryFromTags(["analytics"])).toBe("data");
    expect(categoryFromTags(["customer support"])).toBe("support");
    expect(categoryFromTags(["ai", "email marketing"])).toBe("marketing");
    expect(categoryFromTags(["ai"])).toBe("other");
    expect(categoryFromTags([])).toBe("other");
    expect(categoryFromTags(undefined)).toBe("other");
    const byKey = Object.fromEntries(buildPluginItems(sources).map((item) => [item.key, item]));
    // no tag: Other, never a guess from the name
    expect(byKey["app:weather"]!.category).toBe("other");
  });

  it("keeps Connected apps, MCP servers and Skills as a type filter, not category chips", () => {
    const items = buildPluginItems(sources);
    expect(items.filter((item) => matchesType(item, "apps")).map((item) => item.kind)).toEqual(["app", "app", "app", "app"]);
    expect(new Set(items.filter((item) => matchesType(item, "mcp")).map((item) => item.kind))).toEqual(new Set(["mcp", "featured"]));
    expect(items.filter((item) => matchesType(item, "skills")).map((item) => item.key)).toEqual(["skill:release-notes"]);
    // a category never lists skills
    expect(items.filter((item) => matchesFilter(item, "other")).some((item) => item.kind === "skill")).toBe(false);
    expect(mainSections(items, "", "all", "mcp")).toHaveLength(1);
  });

  it("shows sections per category, one list for a search across apps and skills", () => {
    const items = buildPluginItems(sources);
    const sections = mainSections(items, "", "all");
    expect(sections.map((section) => section.id)).toEqual(["recommended", "passwords", "productivity", "communication", "code", "mcp", "skills", "other"]);
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

describe("marketplace plugins in the list", () => {
  const withMarket = {
    ...sources,
    servers: [...sources.servers, { name: "devjc-notes", enabled: true, url: "https://notes.example.com/mcp", source: "devjc" }],
    skills: [...sources.skills, { name: "triage", description: "Triage", source: "devjc", enabled: false }],
    marketplaces: [{
      name: "devjc",
      plugins: [
        { name: "notes", description: "Notes for bots", version: "1.0.0", installed: true, servers: ["devjc-notes"], skills: ["triage"] },
        { name: "figma-kit", description: "Design helpers", category: "design", installed: false, servers: [], skills: [] },
      ],
    }],
  };

  it("shows a marketplace's plugins under its own chip, with what they brought folded under them", () => {
    const items = buildPluginItems(withMarket);
    const byKey = Object.fromEntries(items.map((item) => [item.key, item]));
    expect(byKey["plugin:notes@devjc"]).toMatchObject({ kind: "plugin", installed: true, source: "devjc", version: "1.0.0" });
    expect(byKey["plugin:figma-kit@devjc"]).toMatchObject({ action: "add", category: "design" });
    expect(byKey["mcp:devjc-notes"]).toMatchObject({ source: "devjc", parent: "plugin:notes@devjc" });
    expect(byKey["skill:triage"]).toMatchObject({ parent: "plugin:notes@devjc" });
    const sections = mainSections(items, "", "all", "any", ["devjc"]);
    expect(sections.find((section) => section.id === "source:devjc")!.items.map((item) => item.key))
      .toEqual(["plugin:notes@devjc", "plugin:figma-kit@devjc"]);
    // installed once, as the plugin, not again as its server
    expect(installedPlugins(items).map((item) => item.key)).toContain("plugin:notes@devjc");
    expect(installedPlugins(items).map((item) => item.key)).not.toContain("mcp:devjc-notes");
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


describe("one row per app across sources", () => {
  const asanaLogo = "https://logos.example.test/asana.svg";
  const merged = {
    cards: [
      { slug: "asana", label: "Asana", blurb: "Tasks", logo: asanaLogo, domain: null, categories: ["productivity"] },
      { slug: "notion", label: "Notion", blurb: "Pages", logo: "https://logos.example.test/notion.svg", domain: null, categories: ["productivity"] },
    ],
    featured: [
      { id: "asana", name: "Asana", description: "Read and update tasks", url: "https://mcp.asana.com/sse", domain: "mcp.asana.com", site: "asana.com", category: "productivity", auth: "oauth" },
      { id: "atlassian", name: "Atlassian", description: "Jira and Confluence", url: "https://mcp.atlassian.com/v1/mcp", domain: "mcp.atlassian.com", site: "atlassian.com", category: "productivity", auth: "oauth" },
    ],
    servers: [{ name: "Notion MCP", enabled: true, url: "https://mcp.notion.com/mcp", auth: "connected" }],
  };

  it("matches names whatever their case, accents and MCP suffix", () => {
    expect(appKey("Asana")).toBe(appKey("asana"));
    expect(appKey("Notion MCP")).toBe("notion");
    expect(appKey("Café (beta)")).toBe("cafe");
  });

  it("shows Asana once, as the connected app with its real logo, still recommended", () => {
    const items = buildPluginItems(merged);
    const asana = items.filter((item) => appKey(item.name) === "asana");
    expect(asana).toHaveLength(1);
    expect(asana[0]).toMatchObject({ key: "app:asana", logo: asanaLogo, recommended: true, merged: ["featured:asana"] });
    const sections = mainSections(items, "", "all");
    for (const section of sections) {
      expect(section.items.filter((item) => appKey(item.name) === "asana").length).toBeLessThanOrEqual(1);
    }
    expect(sections.find((section) => section.id === "recommended")!.items.map((item) => item.key)).toContain("app:asana");
  });

  it("offers the MCP server when connected apps cannot be connected here, with the app's logo", () => {
    const items = buildPluginItems({ ...merged, composioUsable: false });
    const asana = items.filter((item) => appKey(item.name) === "asana");
    expect(asana).toHaveLength(1);
    expect(asana[0]).toMatchObject({ key: "featured:asana", logo: asanaLogo, action: "connect" });
  });

  it("keeps what is installed and drops the offers of the same app", () => {
    const items = buildPluginItems(merged);
    const notion = items.filter((item) => appKey(item.name) === "notion");
    expect(notion.map((item) => item.key)).toEqual(["mcp:Notion MCP"]);
    // the installed server borrows the app's logo and category
    expect(notion[0]).toMatchObject({ installed: true, logo: "https://logos.example.test/notion.svg", category: "productivity" });
  });

  it("draws a catalog server with its provider's site, not its MCP host", () => {
    const atlassian = buildPluginItems(merged).find((item) => item.key === "featured:atlassian")!;
    expect(atlassian.domain).toBe("atlassian.com");
  });
});

describe("the connected count", () => {
  it("counts connected apps, servers, Whop, marketplace plugins and Claude connectors", () => {
    const items = buildPluginItems({
      cards: [{ slug: "slack", label: "Slack", blurb: "", logo: null, domain: null }],
      // an app connected that the catalog does not list is counted too
      status: { slack: { connected: true }, gong: { connected: true, accounts: [{ id: "a", status: "ACTIVE" }] } },
      servers: [
        { name: "docs", enabled: true, url: "https://mcp.example.com/mcp", auth: "connected" },
        { name: "off", enabled: false, command: "npx" },
        { name: "biz", enabled: true, url: "https://mcp.whop.com/mcp", auth: "connected" },
        { name: "kit-notes", enabled: true, url: "https://kit.example.com/mcp", source: "kit" },
      ],
      whop: { description: "Whop", server: "biz", connected: true },
      marketplaces: [{ name: "kit", plugins: [{ name: "notes", installed: true, servers: ["kit-notes"], skills: [] }] }],
    });
    expect(items.find((item) => item.key === "app:gong")).toMatchObject({ installed: true, status: "connected" });
    const summary = connectedSummary(items, 3);
    // slack, gong, docs, Whop, the kit plugin (its server folds under it), and 3 Claude connectors
    expect(summary.count).toBe(8);
    expect(connectedSummary(items).count).toBe(5);
  });
});
