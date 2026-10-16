import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeDesktopLanguage, readDesktopLanguage, writeDesktopLanguage } from "./desktop-language.mjs";

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "desktop-language-"));

test("never chosen reads as null, not as the system language", () => {
  assert.equal(readDesktopLanguage(tempDir()), null);
});

test("a choice survives a restart, including the system choice", () => {
  const dir = tempDir();
  assert.equal(writeDesktopLanguage(dir, "fr"), "fr");
  assert.equal(readDesktopLanguage(dir), "fr");
  assert.equal(writeDesktopLanguage(dir, ""), "");
  assert.equal(readDesktopLanguage(dir), "");
  assert.deepEqual(fs.readdirSync(dir), ["desktop-language.json"]);
});

test("refuses anything that is not a language tag and keeps the last good one", () => {
  const dir = tempDir();
  writeDesktopLanguage(dir, "en-US");
  for (const bad of [null, undefined, 3, "x".repeat(9000), "../fr", "fr;rm", "<b>"]) {
    assert.equal(writeDesktopLanguage(dir, bad), null);
  }
  assert.equal(readDesktopLanguage(dir), "en-US");
  assert.equal(normalizeDesktopLanguage("zh-Hant-TW"), "zh-Hant-TW");
});

test("a corrupt or tampered file reads as never chosen", () => {
  const dir = tempDir();
  fs.writeFileSync(path.join(dir, "desktop-language.json"), "{not json");
  assert.equal(readDesktopLanguage(dir), null);
  fs.writeFileSync(path.join(dir, "desktop-language.json"), JSON.stringify({ language: "<script>" }));
  assert.equal(readDesktopLanguage(dir), null);
});
