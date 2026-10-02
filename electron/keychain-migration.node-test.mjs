import assert from "node:assert/strict";
import test from "node:test";

import { migrateSafeStorageKeychain } from "./keychain-migration.mjs";

/** A fake `security` over an in-memory keychain: service -> { account, secret }. */
function fakeSecurity(items) {
  const calls = [];
  const run = (args, input) => {
    calls.push({ args, input });
    if (args[0] === "find-generic-password") {
      const item = items.get(args[2]);
      if (!item || item.account !== args[4]) return { status: 44, stdout: "" };
      return { status: 0, stdout: args.includes("-w") ? `${item.secret}\n` : "attributes" };
    }
    if (args[0] === "-i") {
      const m = /^add-generic-password -s "([^"]+)" -a "([^"]+)" -T "([^"]+)" -w "([^"]+)"\n$/.exec(input);
      if (!m) return { status: 1, stdout: "" };
      items.set(m[1], { account: m[2], secret: m[4], trusted: m[3] });
      return { status: 0, stdout: "" };
    }
    return { status: 1, stdout: "" };
  };
  return { run, calls };
}

test("reads the new entry first and leaves it alone when present", async () => {
  const items = new Map([["sagax Safe Storage", { account: "sagax Key", secret: "bmV3" }], ["openmausbot Safe Storage", { account: "openmausbot Key", secret: "b2xk" }]]);
  const { run, calls } = fakeSecurity(items);
  assert.equal(await migrateSafeStorageKeychain({ to: "sagax", platform: "darwin", run }), "present");
  assert.equal(calls.length, 1);
});

test("copies the old secret to the new name, on stdin, trusting the app", async () => {
  const items = new Map([["openmausbot Safe Storage", { account: "openmausbot Key", secret: "c2VjcmV0LXZhbHVlPT0=" }]]);
  const { run, calls } = fakeSecurity(items);
  assert.equal(await migrateSafeStorageKeychain({ to: "sagax", platform: "darwin", run, trustedApp: "/Applications/Sagax.app" }), "copied");
  assert.deepEqual(items.get("sagax Safe Storage"), { account: "sagax Key", secret: "c2VjcmV0LXZhbHVlPT0=", trusted: "/Applications/Sagax.app" });
  assert.equal(items.has("openmausbot Safe Storage"), true, "the old entry stays");
  for (const call of calls) assert.ok(!call.args.join(" ").includes("c2VjcmV0"), "the secret never rides in argv");
});

test("does nothing without an old entry, off macOS, or without a rename", async () => {
  const { run } = fakeSecurity(new Map());
  assert.equal(await migrateSafeStorageKeychain({ to: "sagax", platform: "darwin", run }), "none");
  assert.equal(await migrateSafeStorageKeychain({ to: "sagax", platform: "win32", run }), "unsupported");
  assert.equal(await migrateSafeStorageKeychain({ to: "openmausbot", platform: "darwin", run }), "same");
});

test("refuses a secret of an unexpected shape", async () => {
  const items = new Map([["openmausbot Safe Storage", { account: "openmausbot Key", secret: "bad\" -w x" }]]);
  const { run } = fakeSecurity(items);
  assert.equal(await migrateSafeStorageKeychain({ to: "sagax", platform: "darwin", run }), "failed");
  assert.equal(items.has("sagax Safe Storage"), false);
});
