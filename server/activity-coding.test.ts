// Coding work is read off what a conversation did, never its title.
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { codingSignals, inGitRepository, isCodeFile, isCodingWork } from "./activity-coding.ts";

describe("coding classification", () => {
  it("counts edits to source files as coding", () => {
    const signals = codingSignals([{ name: "Edit", files: ["/repo/src/lexer.ts"] }]);
    expect(signals).toEqual({ edits: 1, codeFiles: 1, vcs: false });
    expect(isCodingWork(signals)).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "edit", files: ["Sources/App.swift"] }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "Write src/main.py" }, { name: "Write", files: ["Makefile"] }]))).toBe(true);
  });

  it("counts version control and pull requests as coding", () => {
    expect(isCodingWork(codingSignals([{ name: "Bash", summary: "git commit -m \"fix\"" }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "git -C /repo push origin HEAD" }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "shell", input: { command: "gh pr create --fill" } }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "mcp__github__create_pull_request" }]))).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "Bash", summary: "git status && git log -3" }]))).toBe(false);
  });

  it("does not count the bot's own profile files, notes, reads or chat as coding", () => {
    // "Import this as your directive, soul, identity"
    expect(isCodingWork(codingSignals([{ name: "Write", files: ["/home/bot/SOUL.md"] }, { name: "Edit", files: ["IDENTITY.md", "MEMORY.md"] }]))).toBe(false);
    expect(isCodingWork(codingSignals([{ name: "Write", files: ["notes/plan.md"] }]))).toBe(false);
    expect(isCodingWork(codingSignals([{ name: "Read", files: ["src/a.ts"] }, { name: "WebSearch" }, { name: "Generate Image" }]))).toBe(false);
    expect(isCodingWork(codingSignals([{ name: "Edit", files: ["src/a.ts"], setup: true }]))).toBe(false);
    expect(isCodingWork(codingSignals([]))).toBe(false);
  });

  it("counts any file change inside a repository, but not profile edits there", () => {
    expect(isCodingWork(codingSignals([{ name: "Write", files: ["docs/guide.md"] }]), true)).toBe(true);
    expect(isCodingWork(codingSignals([{ name: "Write", files: ["SOUL.md"] }]), true)).toBe(false);
    expect(isCodingWork(codingSignals([{ name: "Read", files: ["README.md"] }]), true)).toBe(false);
  });

  it("knows source files by extension or name", () => {
    expect(isCodeFile("a/b/c.tsx")).toBe(true);
    expect(isCodeFile("Dockerfile")).toBe(true);
    expect(isCodeFile("C:\\\\proj\\\\Program.cs")).toBe(true);
    expect(isCodeFile("report.pdf")).toBe(false);
    expect(isCodeFile("skills/x/SKILL.md")).toBe(false);
  });
});

describe("inGitRepository", () => {
  const root = mkdtempSync(join(tmpdir(), "activity-coding-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("finds a .git up the tree, and nothing for a relative or plain folder", () => {
    mkdirSync(join(root, "repo", ".git"), { recursive: true });
    mkdirSync(join(root, "repo", "src", "deep"), { recursive: true });
    mkdirSync(join(root, "plain"), { recursive: true });
    expect(inGitRepository(join(root, "repo", "src", "deep"))).toBe(true);
    expect(inGitRepository(join(root, "plain"))).toBe(false);
    expect(inGitRepository("relative/path")).toBe(false);
    expect(inGitRepository("")).toBe(false);
  });
});
