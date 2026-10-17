// Loi 25 (2026-10-17, re-review of #689): deleting a person's account erases
// their own Data scope on every bot, and their confidential threads' Data,
// with each database closed first; other people's scopes and the bots' own
// databases stay.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { erasePersonData } from "./erase.ts";
import { dataScopeFolder, personScopeKeyFor, threadScopeKeyFor } from "./scope.ts";

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), "sagax-erase-")); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function seed(key: string): string {
  const folder = dataScopeFolder(key, undefined, root);
  mkdirSync(join(folder, "data-exports"), { recursive: true });
  writeFileSync(join(folder, "data.duckdb"), "db");
  writeFileSync(join(folder, "sheet.json"), "{}");
  writeFileSync(join(folder, "data-exports", "report.csv"), "a,b\n1,2\n");
  return folder;
}

describe("erasePersonData", () => {
  it("closes and removes the person's scopes on every bot and their confidential threads', and nothing else", async () => {
    const bob = "Bob@Example.com";
    const onA = seed(personScopeKeyFor("bot-a", bob));
    const onB = seed(personScopeKeyFor("bot-b", bob));
    // a bot this server no longer lists still has Bob's folder
    const orphan = seed(personScopeKeyFor("bot-gone", bob));
    const confidential = seed(threadScopeKeyFor("bot-a", "thread-1"));
    const carol = seed(personScopeKeyFor("bot-a", "carol@example.com"));
    const otherThread = seed(threadScopeKeyFor("bot-a", "thread-2"));
    const closed: string[] = [];
    const sheets: string[] = [];
    const result = await erasePersonData({
      principalId: bob,
      botIds: ["bot-a", "bot-b"],
      confidentialThreads: [{ botId: "bot-a", threadId: "thread-1" }],
      engine: { deleteScope: async (key) => { closed.push(key); } },
      sheets: { deleteScope: (key) => { sheets.push(key); } },
      scopesRoot: root,
    });
    for (const gone of [onA, onB, orphan, confidential]) expect(existsSync(gone), gone).toBe(false);
    for (const kept of [carol, otherThread]) expect(existsSync(kept), kept).toBe(true);
    expect(result.scopes).toBe(4);
    const expected = [personScopeKeyFor("bot-a", bob), personScopeKeyFor("bot-b", bob), threadScopeKeyFor("bot-a", "thread-1"), personScopeKeyFor("bot-gone", bob)];
    expect(new Set(closed)).toEqual(new Set(expected));
    expect(new Set(sheets)).toEqual(new Set(expected));
  });

  it("still removes the folders when a database does not close, and never throws", async () => {
    const folder = seed(personScopeKeyFor("bot-a", "bob@example.com"));
    const warnings: string[] = [];
    const result = await erasePersonData({
      principalId: "bob@example.com", botIds: ["bot-a", "../escape"], confidentialThreads: [],
      engine: { deleteScope: async () => { throw new Error("busy"); } },
      sheets: { deleteScope: () => { throw new Error("gone"); } },
      scopesRoot: root, warn: (line) => warnings.push(line),
    });
    expect(existsSync(folder)).toBe(false);
    expect(result.scopes).toBe(1);
    expect(warnings.join("\n")).toContain("was not closed");
    expect(warnings.join("\n")).not.toContain("bob");
  });

  it("works with no scopes root yet and an engine without deleteScope", async () => {
    const result = await erasePersonData({
      principalId: "bob@example.com", botIds: ["bot-a"], confidentialThreads: [],
      engine: {}, sheets: { deleteScope: () => {} }, scopesRoot: join(root, "missing"),
    });
    expect(result.scopes).toBe(0);
  });
});
