import assert from "node:assert/strict";
import { test } from "node:test";

import { ceremonyOutcome, isCeremonyPage } from "./security-key-window.mjs";

test("opens only a ceremony page of this server", () => {
  assert.equal(isCeremonyPage(`/api/security-keys/ceremony/${"a".repeat(43)}/page`), true);
  assert.equal(isCeremonyPage("https://evil.example.com/page"), false);
  assert.equal(isCeremonyPage(`/api/security-keys/ceremony/${"a".repeat(43)}/page?x=1`), false);
  assert.equal(isCeremonyPage(`//evil.example.com/api/security-keys/ceremony/${"a".repeat(43)}/page`), false);
  assert.equal(isCeremonyPage(undefined), false);
});

test("reads the outcome from the page's title only", () => {
  assert.deepEqual(ceremonyOutcome("sagax-security-key:ok"), { ok: true });
  assert.deepEqual(ceremonyOutcome("sagax-security-key:error:cancelled"), { ok: false, error: "cancelled" });
  assert.deepEqual(ceremonyOutcome("sagax-security-key:error"), { ok: false, error: "failed" });
  assert.equal(ceremonyOutcome("Security key"), null);
  assert.equal(ceremonyOutcome("sagax-security-key:ok and more"), null);
});
