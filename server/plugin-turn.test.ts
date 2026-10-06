import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BotPlugins, BotPluginError, type GitRunner } from "./bot-plugins.ts";
import { claudePluginDirs, pluginTurnFiles, pluginTurnPrompt } from "./plugin-turn.ts";

const dirs: string[] = [];
const temp = () => {
  const dir = mkdtempSync(join(tmpdir(), "sagax-plugin-turn-"));
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

function marketplaceRepo(): string {
  const repo = temp();
  write(repo, ".claude-plugin/marketplace.json", JSON.stringify({
    name: "acme-tools",
    plugins: [{ name: "reviewer", source: "./plugins/reviewer", description: "Reviews code" }],
  }));
  write(repo, "plugins/reviewer/.claude-plugin/plugin.json", JSON.stringify({ name: "reviewer" }));
  write(repo, "plugins/reviewer/skills/review/SKILL.md", "---\nname: review\ndescription: Review\n---\nBody");
  write(repo, "plugins/reviewer/commands/review.md", "Review the diff");
  return repo;
}

function fakeGit(repos: Record<string, string>): GitRunner {
  return async (args) => {
    const url = args[args.indexOf("--") + 1]!;
    const into = args[args.indexOf("--") + 2]!;
    const from = repos[url];
    if (!from) throw new BotPluginError("The repository could not be fetched.", "repository_unreadable", 422);
    cpSync(from, into, { recursive: true });
  };
}

describe("plugin skills and commands on a turn", () => {
  it("gives a non-Claude engine the enabled paths, and Claude the folders", async () => {
    const plugins = new BotPlugins({
      dataDir: temp(), git: fakeGit({ "https://github.com/acme/tools.git": marketplaceRepo() }), gitEnvironment: () => ({}), policy: () => undefined,
    });
    await plugins.addMarketplace("bot-1", { source: "acme/tools" }, undefined);
    await plugins.install("bot-1", { marketplace: "acme-tools", plugin: "reviewer" }, undefined);
    const enabled = plugins.pluginDirs("bot-1");
    const skill = join(enabled[0]!, "skills/review/SKILL.md");
    const command = join(enabled[0]!, "commands/review.md");
    write(enabled[0]!, "skills/review/.env", "TOKEN=secret");
    write(enabled[0]!, "commands/secret.key", "key");
    write(enabled[0]!, "commands/README.md", "not a command");
    symlinkSync("/etc/passwd", join(enabled[0]!, "skills/review/outside"));
    const files = pluginTurnFiles(enabled);
    expect(files.map((file) => file.path).sort()).toEqual([command, skill].sort());
    const grok = pluginTurnPrompt({ driverKind: "grokAgent", integrationsOff: false, files });
    expect(grok).toContain(skill);
    expect(grok).toContain(command);
    expect(grok).toContain("Sagax");
    expect(grok).not.toContain("Body");
    expect(claudePluginDirs("grokAgent", false, enabled)).toEqual([]);
    expect(pluginTurnPrompt({ driverKind: "claudeAgent", integrationsOff: false, files })).toBe("");
    expect(claudePluginDirs("claudeAgent", false, enabled)).toEqual(enabled);
    expect(claudePluginDirs("claudeAgent", true, enabled)).toEqual([]);
    expect(pluginTurnPrompt({ driverKind: "grokAgent", integrationsOff: true, files })).toBe("");
    expect(claudePluginDirs("pi", true, enabled)).toEqual([]);
    plugins.setEnabled("bot-1", "reviewer@acme-tools", false);
    expect(plugins.pluginDirs("bot-1")).toEqual([]);
    expect(pluginTurnPrompt({ driverKind: "grokAgent", integrationsOff: false, files: pluginTurnFiles(plugins.pluginDirs("bot-1")) })).toBe("");
  });

  it("reads a skill with no frontmatter and skips a commands readme", () => {
    const root = temp();
    write(root, "skills/review-notes/SKILL.md", "Just a note about review");
    write(root, "commands/README.md", "ignore");
    write(root, "commands/look.md", "---\ndescription: Look at the diff\n---\n# Title\n\nDetails");
    symlinkSync("/etc/passwd", join(root, "skills/review-notes/outside"));
    const files = pluginTurnFiles([root]);
    expect(files.map((file) => `${file.kind}:${file.name}:${file.description}`)).toEqual([
      "skill:review-notes:Just a note about review",
      "command:look:Look at the diff",
    ]);
  });
});
