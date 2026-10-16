import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ASSET_CACHE, PAGE_HEADERS, bootUiFile, createBootUiHandler } from "./boot-ui.mjs";

const ORIGIN = "http://127.0.0.1:8799";

function ui() {
  const dir = mkdtempSync(path.join(tmpdir(), "boot-ui-"));
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>Sagax</title>");
  writeFileSync(path.join(dir, "assets", "index-abc.js"), "export {};");
  return dir;
}

function setup() {
  const dir = ui();
  const passed = [];
  let released = 0;
  const boot = createBootUiHandler({
    origin: () => ORIGIN,
    staticDir: dir,
    readFile: async (file) => readFileSync(file),
    fetch: async (request, init) => { passed.push([request.url, init]); return new Response("from the network"); },
    release: () => { released += 1; },
  });
  return { dir, boot, passed, released: () => released };
}

test("the page and its assets come from the bundle with the server's headers", async () => {
  const { dir, boot, passed, released } = setup();
  try {
    const page = await boot.handler(new Request(`${ORIGIN}/`));
    assert.equal(await page.text(), "<!doctype html><title>Sagax</title>");
    assert.equal(page.headers.get("content-type"), "text/html");
    assert.equal(page.headers.get("cache-control"), "no-cache");
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    const asset = await boot.handler(new Request(`${ORIGIN}/assets/index-abc.js`));
    assert.equal(asset.headers.get("content-type"), "text/javascript");
    assert.equal(asset.headers.get("cache-control"), ASSET_CACHE);
    assert.deepEqual(passed, []);
    assert.equal(released(), 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the first other request hands the scheme back and goes to the network untouched", async () => {
  const { dir, boot, passed, released } = setup();
  try {
    const api = await boot.handler(new Request(`${ORIGIN}/api/bots`));
    assert.equal(await api.text(), "from the network");
    assert.equal(released(), 1);
    assert.deepEqual(passed.map(([url, init]) => [url, init.bypassCustomProtocolHandlers]), [[`${ORIGIN}/api/bots`, true]]);
    // from then on nothing more is served from the bundle
    await boot.handler(new Request(`${ORIGIN}/assets/index-abc.js`));
    assert.equal(passed.length, 2);
    assert.equal(released(), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("another origin, a write, a missing file or a path outside the bundle is not served", async () => {
  const dir = ui();
  try {
    assert.equal(bootUiFile(new Request("http://example.com/"), ORIGIN, dir), null);
    assert.equal(bootUiFile(new Request(`${ORIGIN}/`, { method: "POST", body: "x" }), ORIGIN, dir), null);
    assert.equal(bootUiFile(new Request(`${ORIGIN}/pair`), ORIGIN, dir), null);
    assert.equal(bootUiFile(new Request(`${ORIGIN}/assets/%2e%2e/%2e%2e/etc/passwd`), ORIGIN, dir), null);
    const { boot, passed, released } = setup();
    await boot.handler(new Request(`${ORIGIN}/assets/gone.js`));
    assert.equal(passed.length, 1);
    assert.equal(released(), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the headers are the server's own (server/static-ui.ts)", () => {
  const source = readFileSync(fileURLToPath(new URL("../server/static-ui.ts", import.meta.url)), "utf8");
  for (const [name, value] of Object.entries(PAGE_HEADERS)) assert.match(source, new RegExp(`"${name}": "${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.ok(source.includes(`"${ASSET_CACHE}"`));
});
