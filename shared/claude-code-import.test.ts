import { describe, expect, it } from "vitest";

import {
  claudeCodeRelativePath, claudeCodeSecretPath, claudeCodeToPackage, claudeCodeWantedPath, frontmatter,
} from "./claude-code-import.ts";
import { GrokImportError } from "./grok-import.ts";
import { parsePackageDocument } from "./package-format.ts";

const project = [
  { path: "CLAUDE.md", text: "@AGENTS.md\n\nAlways answer in French." },
  { path: "AGENTS.md", text: "# Project notes\n\nRun `pnpm test` before you push." },
  { path: "CLAUDE.local.md", text: "My sandbox is on port 5173." },
  { path: ".claude/skills/release-notes/SKILL.md", text: "---\nname: release-notes\ndescription: >\n  Write the release notes\n  from merged pull requests.\n---\n\n# Release notes\n\nList every merged PR." },
  { path: ".claude/commands/review.md", text: "---\ndescription: Review the current diff\n---\n\nReview the diff for bugs." },
  { path: ".claude/agents/test-runner.md", text: "---\nname: test-runner\ndescription: Runs the tests and fixes failures\ntools: Bash, Read\nmodel: opus\nskills: release-notes, missing-skill\n---\n\nYou run the tests. Fix what fails." },
  { path: ".mcp.json", text: JSON.stringify({ mcpServers: {
    tracker: { type: "http", url: "https://mcp.example.com/mcp", headers: { Authorization: "Bearer sk-live-abcdefghijklmnopqrstuvwx" } },
    local: { command: "npx", args: ["-y", "some-server", "--token", "abc123"], env: { API_TOKEN: "abc123" } },
    templated: { type: "http", url: "https://${HOST}/mcp" },
  } }) },
  { path: "src/index.ts", text: "export const unrelated = true;" },
];

describe("claudeCodeToPackage", () => {
  const { document, leftOut } = claudeCodeToPackage(project, { folderName: "acme-app", timeZone: "America/New_York" });
  const pkg = document.package;

  it("makes one bot from CLAUDE.md, with its imports inlined and the local notes appended", () => {
    const main = pkg.agents[0]!;
    expect(main.name).toBe("acme-app");
    expect(main.soul).toContain("Run `pnpm test` before you push.");
    expect(main.soul).toContain("Always answer in French.");
    expect(main.soul).not.toContain("@AGENTS.md");
    expect(main.soul).toContain("## Personal notes (CLAUDE.local.md)");
    // AGENTS.md was imported by CLAUDE.md: it is not repeated.
    expect(main.soul!.match(/pnpm test/g)).toHaveLength(1);
  });

  it("brings skills and commands as skills, each a valid SKILL.md", () => {
    const names = pkg.skills!.entries.map((entry) => entry.name).sort();
    expect(names).toEqual(["release-notes", "review"]);
    const notes = pkg.skills!.entries.find((entry) => entry.name === "release-notes")!;
    expect(notes.description).toBe("Write the release notes from merged pull requests.");
    expect(notes.instructions.startsWith("---\nname: release-notes\n")).toBe(true);
    expect(pkg.agents[0]!.skills?.sort()).toEqual(["release-notes", "review"]);
  });

  it("makes each subagent its own bot, without its tools or model", () => {
    const sub = pkg.agents.find((agent) => agent.name === "test-runner")!;
    expect(sub.soul).toBe("You run the tests. Fix what fails.");
    expect(sub.description).toBe("Runs the tests and fixes failures");
    expect(sub.skills).toEqual(["release-notes"]);
    expect(JSON.stringify(sub)).not.toMatch(/opus|Bash/);
  });

  it("keeps an http MCP server as a slot with header names only, and lists command servers", () => {
    expect(pkg.connections).toHaveLength(1);
    expect(pkg.connections![0]!.mcp).toEqual({ transport: "http", url: "https://mcp.example.com/mcp", valueNames: ["Authorization"] });
    expect(pkg.agents[0]!.connections).toEqual([pkg.connections![0]!.key]);
    const text = JSON.stringify(document);
    expect(text).not.toContain("sk-live-");
    expect(text).not.toContain("abc123");
    const local = leftOut.find((item) => item.name.includes("local"))!;
    expect(local.reason).toContain("runs a program");
    expect(local.original).toContain("API_TOKEN");
    expect(local.original).not.toContain("abc123");
    expect(leftOut.some((item) => item.name.includes("templated"))).toBe(true);
  });

  it("arrives inert: no routine, no approval, no model, no publisher", () => {
    expect(pkg.routines ?? []).toEqual([]);
    for (const agent of pkg.agents) expect(agent.approval).toBeUndefined();
    expect(pkg.publisher).toBeUndefined();
    expect(() => parsePackageDocument(document, { trust: "file" })).not.toThrow();
  });

  it("lists secret files by name only", () => {
    const result = claudeCodeToPackage(project, { folderName: "acme-app", skippedSecrets: [".env", ".claude/settings.local.json"] });
    expect(result.leftOut.filter((item) => item.kind === "secrets").map((item) => item.name)).toEqual([".env", ".claude/settings.local.json"]);
  });

  it("reads a picked ~/.claude folder as the project's .claude", () => {
    const result = claudeCodeToPackage([
      { path: "CLAUDE.md", text: "Be brief." },
      { path: "skills/notes/SKILL.md", text: "---\nname: notes\ndescription: Take notes\n---\n\nWrite notes." },
    ], { folderName: ".claude" });
    expect(result.document.package.agents[0]!.name).toBe("Claude Code");
    expect(result.document.package.skills!.entries.map((entry) => entry.name)).toEqual(["notes"]);
  });

  it("refuses a folder with nothing to import", () => {
    expect(() => claudeCodeToPackage([{ path: "README.md", text: "hi" }], { folderName: "x" })).toThrow(GrokImportError);
  });
});

describe("which files are read", () => {
  it("reads only the agent files and never a secret", () => {
    expect(claudeCodeWantedPath("CLAUDE.md")).toBe(true);
    expect(claudeCodeWantedPath(".claude/skills/a/SKILL.md")).toBe(true);
    expect(claudeCodeWantedPath(".claude/skills/a/helper.py")).toBe(false);
    expect(claudeCodeWantedPath(".claude/agents/nested/x.md")).toBe(true);
    expect(claudeCodeWantedPath("src/CLAUDE.md")).toBe(false);
    for (const secret of [".env", ".env.local", ".claude/settings.local.json", "certs/server.pem", ".claude/.credentials.json", "id_ed25519", "auth.json"]) {
      expect(claudeCodeSecretPath(secret), secret).toBe(true);
      expect(claudeCodeWantedPath(secret), secret).toBe(false);
    }
    expect(claudeCodeSecretPath("CLAUDE.md")).toBe(false);
  });

  it("normalises paths", () => {
    expect(claudeCodeRelativePath("./CLAUDE.md")).toBe("CLAUDE.md");
    expect(claudeCodeRelativePath(".claude\\agents\\a.md")).toBe(".claude/agents/a.md");
    expect(claudeCodeRelativePath("agents/a.md", ".claude")).toBe(".claude/agents/a.md");
  });

  it("parses folded frontmatter", () => {
    expect(frontmatter("---\nname: a\ndescription: |\n  one\n  two\n---\nbody").fields).toEqual({ name: "a", description: "one two" });
    expect(frontmatter("no frontmatter").body).toBe("no frontmatter");
  });
});
