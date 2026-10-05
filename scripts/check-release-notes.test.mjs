import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkReleaseNotes } from "./check-release-notes.mjs";

const directories = [];

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "sagax-release-notes-"));
  directories.push(root);
  mkdirSync(join(root, "docs", "releases"), { recursive: true });
  return root;
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("checkReleaseNotes", () => {
  it("fails with a clear message when the notes file is missing", () => {
    const root = fixture();
    const result = checkReleaseNotes({ root, version: "0.4.5" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Cannot tag pulsa-v0.4.5");
    expect(result.message).toContain("docs/releases/0.4.5.md is missing");
  });

  it("fails when the English section or the French section is missing", () => {
    const root = fixture();
    writeFileSync(join(root, "docs", "releases", "0.4.5.md"), "Seulement en français.\n");
    expect(checkReleaseNotes({ root, version: "0.4.5" }).message).toContain('no "## English" section');

    writeFileSync(join(root, "docs", "releases", "0.4.5.md"), "## English\n\nEnglish only.\n");
    expect(checkReleaseNotes({ root, version: "0.4.5" }).message).toContain("no French notes");
  });

  it("fails when forkVersion is not X.Y.Z", () => {
    const result = checkReleaseNotes({ root: fixture(), version: "0.4" });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("forkVersion must be X.Y.Z");
  });

  it("accepts a file with French notes and an English section", () => {
    const root = fixture();
    const file = join(root, "docs", "releases", "0.4.5.md");
    writeFileSync(file, "Bonjour\n\n## English\n\nHello\n");
    expect(checkReleaseNotes({ root, version: "0.4.5" })).toEqual({ ok: true, file });
  });
});
