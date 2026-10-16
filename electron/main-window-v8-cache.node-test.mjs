import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the main window caches V8 code from the first load (bypassHeatCheck)", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  const prefs = main.match(/webPreferences: \{\s*contextIsolation: true,[\s\S]*?preload: path\.join\(__dirname, "preload\.cjs"\)/)?.[0] ?? "";
  assert.match(prefs, /v8CacheOptions: "bypassHeatCheck"/);
});
