// Ratchet for #1385. The allowlist is the keys nothing reads today.
// A key added to en.json that nothing reads fails. A key that gains a
// reader must leave the allowlist. Deleting the current set is not done
// here: several families are built by concatenation the scan cannot see.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, it } from "vitest";

import { unreadLocaleKeys } from "./unused-keys.mjs";

const repo = fileURLToPath(new URL("../..", import.meta.url));

it("does not grow the set of unread locale keys", () => {
  const allowed = readFileSync(join(import.meta.dirname, "unused-keys.allow.txt"), "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  expect(unreadLocaleKeys(repo)).toEqual(allowed);
});
