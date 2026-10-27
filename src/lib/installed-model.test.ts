// Connect apps > Manage > Installed (2026-10-26): one line per thing. The
// shape an organization server really answers: GitHub added by hand, the
// same address brought again by a marketplace plugin under "github-github",
// and the plugin itself; a docs server on an MCP host.
import { describe, expect, it } from "vitest";

import { buildPluginItems } from "./plugins-model";
import type { PluginItem } from "./plugins-model";
import { discoverItems, installedEntries, privateSkills, readableName } from "./installed-model";

const servers = [
  { name: "twilio-docs", enabled: true, url: "https://mcp.twilio.com/docs", source: "twilio" },
  { name: "github", enabled: true, url: "https://api.githubcopilot.com/mcp/" },
  { name: "github-github", enabled: true, url: "https://api.githubcopilot.com/mcp", source: "claude-plugins-official" },
];

describe("installed entries", () => {
  it("names things for people", () => {
    expect(readableName("github-github")).toBe("GitHub");
    expect(readableName("github")).toBe("GitHub");
    expect(readableName("twilio-docs")).toBe("Twilio Docs");
    expect(readableName("linear-mcp")).toBe("Linear");
    expect(readableName("Google Drive")).toBe("Google Drive");
    expect(readableName("frontend-design")).toBe("Frontend Design");
  });

  it("folds GitHub added by hand and by a plugin into one GitHub entry, even when the plugin's own row is out of reach", () => {
    // the marketplace is listed, its GitHub plugin is not installed here
    const entries = installedEntries(buildPluginItems({ servers, marketplaces: [{ name: "claude-plugins-official", plugins: [{ name: "other", installed: false, servers: [], skills: [] }] }] }));
    const github = entries.filter((entry) => entry.name === "GitHub");
    expect(github).toHaveLength(1);
    expect(entries.map((entry) => entry.name)).toEqual(["GitHub", "Twilio Docs"]);
    expect(github[0]!.servers.sort()).toEqual(["github", "github-github"]);
    // one address, so one connector; the marketplace that brought it is named
    expect(github[0]!.brings).toEqual({ app: false, plugin: "claude-plugins-official", connectors: 1, skills: 0 });
    expect(github[0]!.domain).toBe("github.com");
    // a vendor source that is no listed marketplace does not read as a plugin
    expect(entries.find((entry) => entry.name === "Twilio Docs")!.brings.plugin).toBeNull();
    expect(installedEntries(buildPluginItems({ servers })).find((entry) => entry.name === "GitHub")!.brings).toMatchObject({ plugin: null, connectors: 1 });
  });

  it("folds the plugin, its server and its skills into the plugin's entry", () => {
    const items = buildPluginItems({
      servers,
      skills: [
        { name: "review", description: "", source: "claude-plugins-official", enabled: true },
        { name: "weekly-summary", description: "Mine", source: "local-import", enabled: true },
      ],
      marketplaces: [{ name: "claude-plugins-official", plugins: [
        { name: "github", installed: true, servers: ["github-github"], skills: ["review"] },
        { name: "frontend-design", installed: true, servers: [], skills: [] },
        { name: "pdf-tools", installed: false, servers: [], skills: [] },
      ] }],
    });
    const entries = installedEntries(items);
    expect(entries.map((entry) => entry.name)).toEqual(["Frontend Design", "GitHub", "Twilio Docs"]);
    const github = entries.find((entry) => entry.name === "GitHub")!;
    expect(github.primary.key).toBe("plugin:github@claude-plugins-official");
    expect(github.members.map((member) => member.key).sort()).toEqual(["mcp:github", "mcp:github-github", "plugin:github@claude-plugins-official", "skill:review"]);
    expect(github.brings).toEqual({ app: false, plugin: "claude-plugins-official", connectors: 1, skills: 1 });
    // a plugin's skill is not a private skill; the person's own is
    expect(privateSkills(items).map((skill) => skill.id)).toEqual(["weekly-summary"]);
    // Discover keeps what can still be added
    expect(discoverItems(items).map((item) => item.key)).toEqual(["plugin:pdf-tools@claude-plugins-official"]);
  });

  it("Discover keeps an app a conversation needs while it is not connected (its Connect apps pill lands on it)", () => {
    const app = (id: string, status: "connected" | "needs-auth"): PluginItem => ({ key: `app:${id}`, kind: "app", id, name: id, description: "", category: "productivity", installed: true, status, source: "catalog" } as PluginItem);
    const items = [app("notion", "needs-auth"), app("linear", "connected"), app("figma", "needs-auth")];
    expect(discoverItems(items, ["Notion", "linear"]).map((item) => item.key)).toEqual(["app:notion"]);
    expect(discoverItems(items)).toEqual([]);
  });

  it("says a sign-in is waiting when one part needs it, and an update when the plugin has one", () => {
    const entries = installedEntries(buildPluginItems({
      servers: [{ name: "vault", enabled: true, url: "https://vault.example.net/mcp", auth: "required", source: "tools" }],
      marketplaces: [{ name: "tools", plugins: [{ name: "vault", installed: true, servers: ["vault"], skills: [], updateAvailable: true, installedVersion: "1.0.0", version: "1.1.0" }] }],
    }));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("needs_auth");
    expect(entries[0]!.updateAvailable).toBe(true);
  });

  it("a catalog app with its server reads as an app", () => {
    const entries = installedEntries(buildPluginItems({
      servers: [{ name: "Linear", enabled: true, url: "https://mcp.linear.app/mcp", auth: "connected" }],
      featured: [{ id: "linear", name: "Linear", description: "Issues", url: "https://mcp.linear.app/mcp", domain: "linear.app", auth: "oauth", installed: true }],
    }));
    expect(entries).toHaveLength(1);
    expect(entries[0]!.status).toBe("connected");
    // without the catalog it is one connector; the catalog says it is the app
    expect(entries[0]!.brings).toMatchObject({ app: false, connectors: 1 });
    const withCatalog = installedEntries(buildPluginItems({
      servers: [
        { name: "Linear", enabled: true, url: "https://mcp.linear.app/mcp", auth: "connected" },
        { name: "Linear (beta)", enabled: true, url: "https://mcp.linear.app/sse", auth: "connected" },
      ],
    }), [{ url: "https://mcp.linear.app/mcp", iconUrl: "https://cdn.example.net/linear.png" }]);
    expect(withCatalog).toHaveLength(1);
    expect(withCatalog[0]!.brings).toMatchObject({ app: true, connectors: 1 });
    expect(withCatalog[0]!.logo).toBe("https://cdn.example.net/linear.png");
  });
});
