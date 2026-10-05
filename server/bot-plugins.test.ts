import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BotPlugins, BotPluginError, insideRoot, marketplaceAllowed, normalizePolicyEntry, parseGitSource, readMarketplaceManifest, type GitRunner } from "./bot-plugins.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-plugins-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(root: string, path: string, content: string) {
  mkdirSync(join(root, path, ".."), { recursive: true });
  writeFileSync(join(root, path), content);
}

/** A marketplace repository on disk: one local plugin with hooks and MCP. */
function marketplaceRepo(): string {
  const repo = temp();
  write(repo, ".claude-plugin/marketplace.json", JSON.stringify({
    name: "acme-tools",
    metadata: { description: "Acme's plugins" },
    plugins: [
      { name: "reviewer", source: "./plugins/reviewer", description: "Reviews code", version: "1.2.0" },
      { name: "escape", source: "../../etc" },
      { name: "remote", source: { source: "github", repo: "other/plugin-repo" } },
    ],
  }));
  write(repo, "plugins/reviewer/.claude-plugin/plugin.json", JSON.stringify({ name: "reviewer", hooks: "./hooks/hooks.json", mcpServers: { tracker: { command: "node" } } }));
  write(repo, "plugins/reviewer/skills/review/SKILL.md", "---\nname: review\ndescription: Review\n---\nBody");
  write(repo, "plugins/reviewer/commands/review.md", "Review the diff");
  write(repo, "plugins/reviewer/hooks/hooks.json", JSON.stringify({ hooks: {} }));
  write(repo, "plugins/reviewer/.mcp.json", JSON.stringify({ mcpServers: { db: { command: "npx" } } }));
  write(repo, "plugins/reviewer/bin/tool", "#!/bin/sh\necho hi");
  symlinkSync("/etc/passwd", join(repo, "plugins/reviewer/skills/review/link"));
  return repo;
}

function fakeGit(repos: Record<string, string>, calls: Array<{ args: string[]; env: Record<string, string> }>): GitRunner {
  return async (args, options) => {
    calls.push({ args, env: options.env });
    const url = args[args.indexOf("--") + 1]!;
    const into = args[args.indexOf("--") + 2]!;
    const from = repos[url];
    if (!from) throw new BotPluginError("The repository could not be fetched.", "repository_unreadable", 422);
    cpSync(from, into, { recursive: true });
  };
}

describe("parseGitSource", () => {
  it("reads owner/repo and github URLs as the same GitHub source", () => {
    expect(parseGitSource("Acme/Tools")).toMatchObject({ id: "acme/tools", url: "https://github.com/Acme/Tools.git", github: { owner: "Acme", repo: "Tools" } });
    expect(parseGitSource("https://github.com/acme/tools.git").id).toBe("acme/tools");
    expect(parseGitSource("https://gitlab.com/acme/tools.git").id).toBe("https://gitlab.com/acme/tools.git");
  });
  it("refuses http, credentials, local paths and bad refs", () => {
    for (const bad of ["http://github.com/a/b", "https://user:pw@github.com/a/b", "/etc/passwd", "file:///tmp/x", "git@github.com:a/b.git", "https://github.com/a/b?x=1"]) {
      expect(() => parseGitSource(bad), bad).toThrow(BotPluginError);
    }
    expect(() => parseGitSource("a/b", "../main")).toThrow(BotPluginError);
  });
});

describe("marketplace policy", () => {
  it("allows any marketplace by default", () => {
    expect(marketplaceAllowed(undefined, parseGitSource("x/y"))).toBe(true);
    expect(marketplaceAllowed({ mode: "any" }, parseGitSource("https://gitlab.com/x/y"))).toBe(true);
  });
  it("restricts to owner/repo, owner/* and exact URLs", () => {
    const policy = { mode: "list" as const, allow: ["pulsatrixtechnologies/marketplace", "goxtechnologies/*", "https://gitlab.com/acme/plugins"] };
    expect(marketplaceAllowed(policy, parseGitSource("PulsatrixTechnologies/marketplace"))).toBe(true);
    expect(marketplaceAllowed(policy, parseGitSource("goxtechnologies/anything"))).toBe(true);
    expect(marketplaceAllowed(policy, parseGitSource("https://gitlab.com/acme/plugins.git"))).toBe(false);
    expect(marketplaceAllowed(policy, parseGitSource("https://gitlab.com/acme/plugins"))).toBe(true);
    expect(marketplaceAllowed(policy, parseGitSource("evil/marketplace"))).toBe(false);
    expect(normalizePolicyEntry("GOX/*")).toBe("gox/*");
  });
});

describe("insideRoot", () => {
  it("keeps paths inside the repository", () => {
    expect(insideRoot("/r", "./plugins/a")).toBe("/r/plugins/a");
    expect(insideRoot("/r", "./")).toBe("/r");
    expect(() => insideRoot("/r", "../x")).toThrow(BotPluginError);
    expect(() => insideRoot("/r", "/etc")).toThrow(BotPluginError);
  });
});

describe("BotPlugins", () => {
  it("adds a marketplace, installs a plugin without what would run on the host, and lists its folder", async () => {
    const repo = marketplaceRepo();
    const calls: Array<{ args: string[]; env: Record<string, string> }> = [];
    const plugins = new BotPlugins({
      dataDir: temp(), git: fakeGit({ "https://github.com/acme/tools.git": repo }, calls),
      gitEnvironment: (actor): Record<string, string> => (actor ? { GIT_CONFIG_COUNT: "1", ACTOR: actor } : {}), policy: () => undefined,
    });
    const listing = await plugins.addMarketplace("bot-1", { source: "acme/tools" }, "pr_owner");
    expect(listing).toMatchObject({ name: "acme-tools", source: "acme/tools", description: "Acme's plugins" });
    expect(listing.plugins.map((plugin) => plugin.name)).toEqual(["reviewer", "escape", "remote"]);
    // the acting person's GitHub credentials are offered for a GitHub clone
    expect(calls[0]!.env).toMatchObject({ ACTOR: "pr_owner" });
    expect(calls[0]!.args).not.toContain("pr_owner");

    const installed = await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, "pr_owner");
    expect(installed).toMatchObject({ key: "reviewer@acme-tools", enabled: true, version: "1.2.0" });
    expect(installed.removed).toEqual(expect.arrayContaining(["hooks", ".mcp.json", "bin", "plugin.json hooks", "plugin.json mcpServers"]));
    expect(installed.declaredMcpServers.sort()).toEqual(["db", "tracker"]);
    const [dir] = plugins.pluginDirs("bot-1");
    expect(dir).toBeTruthy();
    expect(existsSync(join(dir!, "skills/review/SKILL.md"))).toBe(true);
    expect(existsSync(join(dir!, "commands/review.md"))).toBe(true);
    expect(existsSync(join(dir!, "hooks"))).toBe(false);
    expect(existsSync(join(dir!, ".mcp.json"))).toBe(false);
    expect(existsSync(join(dir!, "bin"))).toBe(false);
    expect(existsSync(join(dir!, "skills/review/link"))).toBe(false);
    const manifest = JSON.parse(readFileSync(join(dir!, ".claude-plugin/plugin.json"), "utf8"));
    expect(manifest).toEqual({ name: "reviewer" });

    plugins.setEnabled("bot-1", "reviewer@acme-tools", false);
    expect(plugins.pluginDirs("bot-1")).toEqual([]);
    // another bot gets nothing
    expect(plugins.pluginDirs("bot-2")).toEqual([]);
  });

  it("refuses a plugin path that leaves its marketplace", async () => {
    const plugins = new BotPlugins({ dataDir: temp(), git: fakeGit({ "https://github.com/acme/tools.git": marketplaceRepo() }, []), gitEnvironment: () => ({}), policy: () => undefined });
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, undefined);
    await expect(plugins.install("bot-1", { marketplace: "acme-tools", plugin: "escape" }, undefined)).rejects.toMatchObject({ code: "invalid_plugin" });
  });

  it("applies the organization's marketplace list, including a plugin's own repository", async () => {
    const repo = marketplaceRepo();
    const plugins = new BotPlugins({
      dataDir: temp(), git: fakeGit({ "https://github.com/acme/tools.git": repo }, []), gitEnvironment: () => ({}),
      policy: () => ({ mode: "list", allow: ["acme/*"] }),
    });
    await expect(plugins.addMarketplace("bot-1", { source: "evil/tools" }, undefined)).rejects.toMatchObject({ code: "marketplace_not_allowed", status: 403 });
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, undefined);
    await expect(plugins.install("bot-1", { marketplace: "acme-tools", plugin: "remote" }, undefined)).rejects.toMatchObject({ code: "marketplace_not_allowed" });
  });

  it("refuses a repository that is not a marketplace and removes a marketplace with its plugins", async () => {
    const notMarket = temp();
    write(notMarket, "README.md", "hi");
    const repo = marketplaceRepo();
    const plugins = new BotPlugins({
      dataDir: temp(), git: fakeGit({ "https://github.com/acme/readme.git": notMarket, "https://github.com/acme/tools.git": repo }, []),
      gitEnvironment: () => ({}), policy: () => undefined,
    });
    await expect(plugins.addMarketplace("bot-1", { source: "acme/readme" }, undefined)).rejects.toMatchObject({ code: "not_a_marketplace" });
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, undefined);
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, undefined);
    await plugins.removeMarketplace("bot-1", "acme-tools");
    expect(plugins.listPlugins("bot-1")).toEqual([]);
    expect(plugins.listMarketplaces("bot-1")).toEqual([]);
    expect(plugins.pluginDirs("bot-1")).toEqual([]);
  });

  it("reads pluginRoot and remote sources from a manifest", () => {
    const repo = temp();
    write(repo, ".claude-plugin/marketplace.json", JSON.stringify({ name: "m", metadata: { pluginRoot: "./plugins" }, plugins: [{ name: "a", source: "a" }, { name: "b", source: { source: "url", url: "https://gitlab.com/x/b.git" } }, { name: "bad name!", source: "./x" }] }));
    const manifest = readMarketplaceManifest(repo);
    expect(manifest.plugins).toEqual([
      { name: "a", source: { kind: "path", path: "./plugins/a" } },
      { name: "b", source: { kind: "git", git: expect.objectContaining({ id: "https://gitlab.com/x/b.git" }) } },
    ]);
  });
});
