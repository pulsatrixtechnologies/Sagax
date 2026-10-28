import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { liveScreenForMember } from "./browser/my-chrome/shell.ts";
import { publishPersonalCopy, readPersonalCopy } from "./personal-copy.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-copy-"));
  dirs.push(dir);
  return dir;
}

describe("a person's copy for a cloud bot", () => {
  it("keeps the lent folder and the chrome reading list after the computer is gone", () => {
    const dir = root();
    publishPersonalCopy(dir, {
      person: "ada", kind: "folder", name: "notes", at: 10,
      files: [{ path: "brief.txt", text: "the draft" }],
    });
    publishPersonalCopy(dir, {
      person: "ada", kind: "chrome", name: "mine", at: 11,
      files: [{ path: "tabs.json", text: "{\"tabs\":[\"https://example.test\"]}" }],
    });
    expect(readPersonalCopy(dir, "ada", "folder", "notes")?.files[0]?.text).toBe("the draft");
    expect(readPersonalCopy(dir, "ada", "chrome", "mine")?.files[0]?.path).toBe("tabs.json");
    expect(readPersonalCopy(dir, "bob", "folder", "notes")).toBeNull();
  });

  it("refuses a screen, cookies, and a path that leaves the folder", () => {
    const dir = root();
    expect(() => publishPersonalCopy(dir, { person: "ada", kind: "screen" as "chrome", name: "x", at: 1, files: [] })).toThrow(/screen/);
    expect(() => publishPersonalCopy(dir, { person: "ada", kind: "chrome", name: "x", at: 1, files: [{ path: "Cookies", text: "secret" }] })).toThrow(/cookies/);
    expect(() => publishPersonalCopy(dir, { person: "ada", kind: "folder", name: "x", at: 1, files: [{ path: "../secret.txt", text: "no" }] })).toThrow(/inside/);
  });

  it("does not treat cloudOnly as a way for another member to see the live screen", () => {
    expect(liveScreenForMember("ada", "ada")).toBe(true);
    expect(liveScreenForMember("ada", "bob")).toBe(false);
    expect(liveScreenForMember("ada", "")).toBe(false);
  });
});
