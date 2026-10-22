import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { EXACT_WORDS, LOWER_CASE_WORDS, loadAllowlist, scanPackage, scanText } from "./npm-package-terms.mjs";

// The real words are private (digests only), so the scan is exercised with
// made-up ones added to the same tables.
const digest = (word) => createHash("sha256").update(word).digest("hex").slice(0, 16);
const made = { [digest("acmeco")]: "company", [digest("pat quill")]: "personal", [digest("zz123")]: "personal", [digest("tkt")]: "tracker" };
const exact = { [digest("PQ")]: "initials", [digest("Vexa")]: "bot-name" };

const allowlist = loadAllowlist(join(import.meta.dirname, "npm-package-allowlist.json"));
const dirs = [];
beforeAll(() => {
  Object.assign(LOWER_CASE_WORDS, made);
  Object.assign(EXACT_WORDS, exact);
});
afterAll(() => {
  for (const key of Object.keys(made)) delete LOWER_CASE_WORDS[key];
  for (const key of Object.keys(exact)) delete EXACT_WORDS[key];
});
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const blocked = (text, file = "dist-server/index.js") => scanText(text, allowlist, file).filter((hit) => !hit.allowedBy).map((hit) => hit.term);

describe("npm package term scan", () => {
  it("refuses listed words in any case, word pairs across a hyphen or a line break, exact-case words and tracker ids", () => {
    expect(blocked("// incident on the ACMECO server")).toEqual(["company"]);
    expect(blocked("asked by zz123 and Pat-Quill, then Pat\nQuill")).toEqual(["personal", "personal", "personal"]);
    expect(blocked("// 2026-10-16 (PQ): one rule; Vexa runs")).toEqual(["initials", "bot-name"]);
    expect(blocked("// fixed (TKT-272)")).toEqual(["tracker"]);
    expect(blocked('like Grok Bot, and "Grok\\nBot" in JSON, and Grok\nBot')).toEqual(["grok-bot", "grok-bot", "grok-bot"]);
  });

  it("leaves other words alone: longer words, another case for exact words, a tracker word without a number", () => {
    expect(blocked("acmecorp acmeco_x pq vexa the tkt file zz1234")).toEqual([]);
  });

  it("masks the matched word in what it reports", () => {
    const [hit] = scanText("see zz123 here", allowlist);
    expect(hit.context).toBe("see z**** here");
  });

  it("keeps the allowlisted interop names, and only where the name itself is allowlisted", () => {
    expect(blocked('grokbot://app/v1/bot-template?id=1 · url.protocol === "grokbot:" · grokbot-bundle/v1 · pi-grokbot-import · ~/.opengrokbot')).toEqual([]);
    expect(blocked("grokbot-bundle/v1 then Grok Bot")).toEqual(["grok-bot"]);
  });

  it("allows a minified two-letter variable only in the web bundle", () => {
    const code = "function JC(e,t){return JC.$type}";
    const hasInitials = Object.values(EXACT_WORDS).includes("initials") && scanText(code, [], "x.js").length === 2;
    expect(hasInitials).toBe(true);
    expect(blocked(code, "dist/assets/chunk-1.js")).toEqual([]);
    expect(blocked(code, "dist-server/index.js")).toEqual(["initials", "initials"]);
  });

  it("scans every text file of a package folder and skips binaries", () => {
    const dir = mkdtempSync(join(tmpdir(), "npm-terms-"));
    dirs.push(dir);
    mkdirSync(join(dir, "dist"));
    writeFileSync(join(dir, "dist", "a.js"), "// acmeco\n");
    writeFileSync(join(dir, "image.png"), Buffer.concat([Buffer.from([0x89, 0]), Buffer.from(" acmeco ")]));
    writeFileSync(join(dir, "clean.js"), "export {};\n");
    const result = scanPackage(dir, allowlist);
    expect(result.blocked.map((hit) => `${hit.file}:${hit.term}`)).toEqual(["dist/a.js:company"]);
  });

  it("needs a reason for every allowlist entry", () => {
    const dir = mkdtempSync(join(tmpdir(), "npm-terms-"));
    dirs.push(dir);
    writeFileSync(join(dir, "list.json"), JSON.stringify([{ term: "company", context: "x", reason: " " }]));
    expect(() => loadAllowlist(join(dir, "list.json"))).toThrow("reason");
  });
});
