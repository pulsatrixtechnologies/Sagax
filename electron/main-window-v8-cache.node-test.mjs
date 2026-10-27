import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the main window caches V8 code from the first load (bypassHeatCheck)", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  // one set of preferences for the window's own page and each account's view
  const prefs = main.match(/function mainPageWebPreferences\(\) \{\s*return \{\s*contextIsolation: true,[\s\S]*?preload: path\.join\(__dirname, "preload\.cjs"\)/)?.[0] ?? "";
  assert.match(prefs, /v8CacheOptions: "bypassHeatCheck"/);
  assert.match(main, /webPreferences: mainPageWebPreferences\(\),/);
  assert.match(main, /new WebContentsView\(\{ webPreferences: mainPageWebPreferences\(\) \}\)/);
});
