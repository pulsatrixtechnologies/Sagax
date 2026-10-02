// Sagax 0.4.0 never opened its window when packaged: startup called
// ensureCloudAccount(), which throws while OMB Cloud is off, before
// createWindow(). Every call reached from startup must be guarded.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");

test("startup restores the cloud account only when OMB Cloud is on, and never throws past it", () => {
  const start = main.indexOf("cloudAccountStarted = ensureCloudAccount().start()");
  assert.ok(start > 0, "the startup restore call is present");
  const before = main.slice(Math.max(0, start - 400), start);
  assert.match(before, /CLOUD_SERVICES_ENABLED\) \{/);
  assert.match(before, /try \{\s*$/);
});

test("ensureCloudAccount is not called bare from top-level startup code", () => {
  for (const line of main.split("\n")) {
    if (!/^\s{2}if \(app\.isPackaged.*ensureCloudAccount\(\)/.test(line)) continue;
    assert.fail(`unguarded startup call: ${line.trim()}`);
  }
});
