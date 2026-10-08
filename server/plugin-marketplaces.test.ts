import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readMarketplaceManifest } from "./bot-plugins.ts";
import { isManifestUrl, marketplaceServerName, PluginMarketplaces, pluginInstallPlan } from "./plugin-marketplaces.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "sagax-marketplaces-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function write(root: string, files: Record<string, string | object>) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), typeof content === "string" ? content : JSON.stringify(content));
  }
}

const SKILL = "---\nname: release-notes\ndescription: Writes release notes.\n---\n\n# Release notes\n";

function marketplaceRepo(root: string) {
  write(root, {
    ".claude-plugin/marketplace.json": {
      name: "devjc", owner: { name: "JC" },
      plugins: [
        { name: "notes", source: "./plugins/notes", description: "Notes server and a skill", version: "1.2.0" },
        { name: "remote-one", source: { source: "github", repo: "acme/remote-plugin" }, description: "Elsewhere" },
        { name: "by-url", source: { source: "git", url: "https://git.example.com/team/plugin.git" } },
        { name: "../escape", source: "./x" },
        { name: "nosource" },
      ],
    },
    "plugins/notes/.claude-plugin/plugin.json": { name: "notes", version: "1.2.0", mcpServers: { search: { type: "http", url: "https://mcp.example.com/search" } } },
    "plugins/notes/.mcp.json": { mcpServers: { notes: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/server.js"], env: { NOTES_DIR: "${CLAUDE_PLUGIN_ROOT}/data" } } } },
    "plugins/notes/skills/release-notes/SKILL.md": SKILL,
    "plugins/notes/skills/broken/SKILL.md": "no frontmatter",
    "plugins/notes/agents/helper.md": "agent",
    "plugins/notes/commands/go.md": "command",
  });
}

describe("marketplace manifest", () => {
  it("reads the Claude Code format: path, github and git sources; drops invalid entries", () => {
    const root = join(dir, "repo");
    marketplaceRepo(root);
    const manifest = readMarketplaceManifest(root);
    expect(manifest.name).toBe("devjc");
    expect(manifest.plugins.map((plugin) => [plugin.name, plugin.source.kind])).toEqual([
      ["notes", "path"], ["remote-one", "git"], ["by-url", "git"],
    ]);
    expect(manifest.plugins[0]).toMatchObject({ version: "1.2.0", source: { path: "./plugins/notes" } });
    expect(manifest.plugins[1]!.source).toMatchObject({ git: { id: "acme/remote-plugin" } });
  });

  it("tells a manifest address from a repository", () => {
    expect(isManifestUrl("https://example.com/.claude-plugin/marketplace.json")).toBe(true);
    expect(isManifestUrl("acme/plugins")).toBe(false);
    expect(isManifestUrl("https://github.com/acme/plugins")).toBe(false);
    expect(isManifestUrl("http://example.com/marketplace.json")).toBe(false);
  });
});

describe("install mapping: a plugin becomes MCP servers and skills", () => {
  it("maps .mcp.json and plugin.json servers, the plugin root, and valid skills", () => {
    const root = join(dir, "repo");
    marketplaceRepo(root);
    const pluginRoot = join(root, "plugins", "notes");
    const plan = pluginInstallPlan(pluginRoot);
    expect(plan.servers).toEqual([
      { name: "notes", entry: { command: "node", args: [`${pluginRoot}/server.js`], env: { NOTES_DIR: `${pluginRoot}/data` } } },
      { name: "search", entry: { type: "http", url: "https://mcp.example.com/search" } },
    ]);
    expect(plan.skills.map((skill) => skill.name)).toEqual(["release-notes"]);
    expect(plan.skipped).toEqual([expect.stringContaining("skill broken")]);
  });

  it("names servers safely and puts the plugin in front on a clash", () => {
    expect(marketplaceServerName("Notes Server", "notes", new Set())).toBe("notes-server");
    expect(marketplaceServerName("github", "devtools", new Set(["github"]))).toBe("devtools-github");
    expect(marketplaceServerName("github", "devtools", new Set(["github", "devtools-github"]))).toBe("github-2");
  });
});

describe("the installation's marketplaces", () => {
  const store = (git?: (url: string, into: string) => void, fetchText?: (url: string) => Promise<string>) => new PluginMarketplaces({
    dataDir: join(dir, "data"),
    gitEnvironment: () => ({}),
    policy: () => undefined,
    now: () => 1_000,
    git: async (args) => {
      const into = args.at(-1)!;
      const url = args.at(-2)!;
      if (!git) throw new Error("no git");
      git(url, into);
    },
    ...(fetchText ? { fetchText } : {}),
  });

  it("adds a repository shallowly, lists its plugins and installs one into its own folder", async () => {
    const source = join(dir, "repo");
    marketplaceRepo(source);
    const clones: string[] = [];
    const markets = store((url, into) => {
      clones.push(url);
      cpSync(source, into, { recursive: true });
    });
    const view = await markets.add({ source: "jencryzthers/marketplace", ref: "main" }, undefined);
    expect(clones).toEqual(["https://github.com/jencryzthers/marketplace.git"]);
    expect(view).toMatchObject({ name: "devjc", source: "jencryzthers/marketplace", ref: "main" });
    expect(view.plugins.map((plugin) => plugin.name)).toEqual(["notes", "remote-one", "by-url"]);
    const prepared = await markets.prepare("devjc", "notes", undefined);
    expect(prepared.dir).toBe(join(dir, "data", "marketplaces", "plugins", "devjc", "notes"));
    expect(prepared.plan.servers.map((server) => server.name)).toEqual(["notes", "search"]);
    markets.recordInstall("devjc", "notes", { version: prepared.version, servers: ["notes", "search"], skills: ["release-notes"] });
    expect(markets.list()[0]!.plugins[0]).toMatchObject({ installed: true, servers: ["notes", "search"], skills: ["release-notes"] });
    await expect(markets.remove("devjc")).rejects.toMatchObject({ code: "has_plugins" });
    expect(markets.recordUninstall("devjc", "notes").servers).toEqual(["notes", "search"]);
    await markets.remove("devjc");
    expect(markets.list()).toEqual([]);
  });

  it("adds a marketplace by the address of its manifest and reads plugin files over https", async () => {
    const pages: Record<string, string> = {
      "https://example.com/m/.claude-plugin/marketplace.json": JSON.stringify({ name: "web", plugins: [{ name: "docs", source: "./plugins/docs" }] }),
      "https://example.com/m/plugins/docs/.mcp.json": JSON.stringify({ docs: { type: "sse", url: "https://mcp.example.com/sse" } }),
    };
    const markets = store(undefined, async (url) => {
      if (!(url in pages)) throw new Error("404");
      return pages[url]!;
    });
    const view = await markets.add({ source: "https://example.com/m/.claude-plugin/marketplace.json" }, undefined);
    expect(view).toMatchObject({ name: "web", source: "https://example.com/m/.claude-plugin/marketplace.json" });
    const prepared = await markets.prepare("web", "docs", undefined);
    expect(prepared.plan.servers).toEqual([{ name: "docs", entry: { type: "sse", url: "https://mcp.example.com/sse" } }]);
  });

  it("applies the organization's allowed marketplaces", async () => {
    const markets = new PluginMarketplaces({
      dataDir: join(dir, "data"), gitEnvironment: () => ({}), policy: () => ({ mode: "list", allow: ["acme/*"] }),
      git: async () => { throw new Error("must not clone"); },
    });
    await expect(markets.add({ source: "other/plugins" }, undefined)).rejects.toMatchObject({ code: "marketplace_not_allowed" });
  });
});

describe("uninstalling a plugin's skills", () => {
  it("removes a library skill only when it came from that marketplace", async () => {
    const { installLibrarySkill, listLibrarySkills, removeLibrarySkillFrom } = await import("./skill-library.ts");
    const root = join(dir, "library");
    expect("error" in installLibrarySkill({ name: "release-notes", instructions: SKILL, source: "devjc", root })).toBe(false);
    expect(removeLibrarySkillFrom("release-notes", "other", root)).toEqual({ removed: false });
    expect(listLibrarySkills(root).map((skill) => skill.name)).toEqual(["release-notes"]);
    expect(removeLibrarySkillFrom("release-notes", "devjc", root)).toEqual({ removed: true });
    expect(listLibrarySkills(root)).toEqual([]);
  });
});
