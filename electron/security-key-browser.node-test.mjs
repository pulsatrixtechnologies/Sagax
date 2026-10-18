import assert from "node:assert/strict";
import { test } from "node:test";

import { ceremonyBrowserUrl, createSecurityKeyBrowser, isCeremonyPage } from "./security-key-browser.mjs";

const page = `/api/security-keys/ceremony/${"a".repeat(43)}/page`;

test("opens only a ceremony page of this server", () => {
  assert.equal(isCeremonyPage(page), true);
  assert.equal(isCeremonyPage("https://evil.example.com/page"), false);
  assert.equal(isCeremonyPage(`${page}?x=1`), false);
  assert.equal(isCeremonyPage(`//evil.example.com${page}`), false);
  assert.equal(isCeremonyPage(undefined), false);
});

test("the local page opens on localhost, a bundled page on its server", () => {
  assert.equal(ceremonyBrowserUrl(page, { local: true, port: 8799 }), `http://localhost:8799${page}`);
  assert.equal(ceremonyBrowserUrl(page, { local: false, bundledOrigin: "https://bot.example.com" }), `https://bot.example.com${page}`);
  assert.equal(ceremonyBrowserUrl(page, { local: false, bundledOrigin: "https://bot.example.com/x" }), null);
  assert.equal(ceremonyBrowserUrl(page, { local: false, bundledOrigin: "file:///etc" }), null);
  assert.equal(ceremonyBrowserUrl(page, { local: false, bundledOrigin: null }), null);
  assert.equal(ceremonyBrowserUrl(page, { local: true, port: 0 }), null);
  assert.equal(ceremonyBrowserUrl("/api/bots", { local: true, port: 8799 }), null);
});

test("opens the system browser and brings the app back", async () => {
  const opened = [];
  let focused = 0;
  const browser = createSecurityKeyBrowser({
    openExternal: async (url) => { opened.push(url); },
    port: () => 8799,
    isLocal: () => true,
    bundledOrigin: () => null,
    focusApp: () => { focused++; },
  });
  assert.deepEqual(await browser.open({}, page), { ok: true });
  assert.deepEqual(await browser.open({}, "/elsewhere"), { ok: false, error: "failed" });
  assert.deepEqual(opened, [`http://localhost:8799${page}`]);
  assert.equal(browser.returned(), true);
  assert.equal(focused, 1);
  const broken = createSecurityKeyBrowser({ openExternal: async () => { throw new Error("no"); }, port: () => 1, isLocal: () => true, bundledOrigin: () => null, focusApp: () => {} });
  assert.deepEqual(await broken.open({}, page), { ok: false, error: "browser" });
});
