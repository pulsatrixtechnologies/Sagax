import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { LIST, parseDropped, trackedDropped } from "./upstream-drop.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directories = [];

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("upstream-drop", () => {
  it("lists each dropped upstream path once, none of them in this tree", () => {
    const paths = parseDropped(readFileSync(LIST, "utf8"));
    expect(paths.length).toBeGreaterThan(0);
    expect(new Set(paths).size).toBe(paths.length);
    expect(trackedDropped(paths, root)).toEqual([]);
  });

  it("skips comments and blank lines", () => {
    expect(parseDropped("# head\n\nsrc/a.ts\n  b.md  # note\n")).toEqual(["src/a.ts", "b.md"]);
  });

  it("finds a dropped path a merge brought back as a modify/delete conflict", () => {
    const repo = mkdtempSync(join(tmpdir(), "sagax-upstream-drop-"));
    directories.push(repo);
    git(repo, "init", "-q", "-b", "main");
    git(repo, "config", "user.email", "test@example.invalid");
    git(repo, "config", "user.name", "Test");
    writeFileSync(join(repo, "gone.txt"), "one\n");
    writeFileSync(join(repo, "kept.txt"), "one\n");
    git(repo, "add", ".");
    git(repo, "commit", "-q", "-m", "base");
    git(repo, "checkout", "-q", "-b", "upstream");
    writeFileSync(join(repo, "gone.txt"), "two\n");
    git(repo, "commit", "-q", "-am", "upstream edit");
    git(repo, "checkout", "-q", "main");
    git(repo, "rm", "-q", "gone.txt");
    git(repo, "commit", "-q", "-m", "fork drop");
    expect(() => git(repo, "merge", "-q", "upstream")).toThrow();
    expect(trackedDropped(["gone.txt", "never.txt"], repo)).toEqual(["gone.txt"]);
    git(repo, "rm", "-q", "-f", "--", "gone.txt");
    expect(trackedDropped(["gone.txt"], repo)).toEqual([]);
  });
});
