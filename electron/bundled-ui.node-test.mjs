// This app's own UI drawn on an organization server's origin
// (bundled-ui.cjs), the preload's bundled-page bridge, the desktop-UI IPC
// gate (local-origin.cjs) and main's wiring of both.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ui = require("./bundled-ui.cjs");
const localOrigin = require("./local-origin.cjs");

const ORG = "https://org.example.test";

function bundleDir() {
  const dir = mkdtempSync(path.join(tmpdir(), "omb-bundled-ui-"));
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>DESKTOP BUNDLE</title>");
  writeFileSync(path.join(dir, "assets", "app.js"), "console.log('desktop')");
  return dir;
}

function request(url, init = {}) {
  return new Request(url, init);
}

test("the server keeps its API, discovery and OIDC; every other GET is the UI", () => {
  for (const pathname of ["/api", "/api/bots", "/api/auth/session", "/.well-known/openmausbot/environment", "/auth/oidc/start", "/auth/oidc/callback"]) {
    assert.equal(ui.servedByServer(pathname), true, pathname);
  }
  for (const pathname of ["/", "/pair", "/assets/app.js", "/apiary", "/authors", "/?omb-floating-bot=1"]) {
    assert.equal(ui.servedByServer(pathname), false, pathname);
  }
  assert.deepEqual(ui.routeRequest({ url: `${ORG}/pair`, method: "GET" }, ORG), { kind: "bundle", pathname: "/pair" });
  assert.deepEqual(ui.routeRequest({ url: `${ORG}/api/bots`, method: "GET" }, ORG), { kind: "pass" });
  assert.deepEqual(ui.routeRequest({ url: `${ORG}/pair`, method: "POST" }, ORG), { kind: "pass" });
  assert.deepEqual(ui.routeRequest({ url: "https://other.example.test/", method: "GET" }, ORG), { kind: "pass" });
  assert.deepEqual(ui.routeRequest({ url: `${ORG}/`, method: "GET" }, null), { kind: "pass" });
  // the old invitation page goes to sign-in, as the organization server does
  assert.deepEqual(ui.routeRequest({ url: `${ORG}/join`, method: "GET" }, ORG), { kind: "redirect", location: `${ORG}/pair` });
});

test("bundle files stay inside the bundle; pages fall back to the app shell, assets never do", () => {
  const dir = bundleDir();
  assert.equal(ui.bundleFile(dir, "/").file, path.join(dir, "index.html"));
  assert.equal(ui.bundleFile(dir, "/pair").file, path.join(dir, "index.html"));
  assert.equal(ui.bundleFile(dir, "/assets/app.js").type, "text/javascript; charset=utf-8");
  assert.equal(ui.bundleFile(dir, "/assets/missing.js").fallback, false);
  for (const escape of ["/../secret.txt", "/%2e%2e/secret.txt", "/assets/%2e%2e/%2e%2e/etc/passwd", "/%00x.js", "/%E0%A4%A"]) {
    const found = ui.bundleFile(dir, escape);
    assert.ok(found === null || found.file.startsWith(dir + path.sep), escape);
  }
  assert.equal(ui.bundleFile(null, "/"), null);
});

test("the document and its assets come from this app's bundle, not the server", async () => {
  const dir = bundleDir();
  const fetched = [];
  const handle = ui.createBundledUiHandler({
    origin: () => ORG,
    staticDir: () => dir,
    fetch: async (input, init) => { fetched.push([typeof input === "string" ? input : input.url, init]); return new Response("server"); },
    readFile: async (file) => readFileSync(file),
  });
  const page = await handle(request(`${ORG}/`));
  assert.equal(page.status, 200);
  assert.match(await page.text(), /DESKTOP BUNDLE/);
  assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.match(await (await handle(request(`${ORG}/assets/app.js`))).text(), /desktop/);
  assert.equal((await handle(request(`${ORG}/assets/missing.js`))).status, 404);
  const join = await handle(request(`${ORG}/join`));
  assert.equal(join.status, 302);
  assert.equal(join.headers.get("location"), `${ORG}/pair`);
  assert.equal(fetched.length, 0, "no page request reached the network");
});

test("the API passes through with the session; a write from the bundled page carries its origin, nothing else does", async () => {
  const fetched = [];
  const handle = ui.createBundledUiHandler({
    origin: () => ORG,
    staticDir: () => null,
    fetch: async (input, init) => { fetched.push({ url: typeof input === "string" ? input : input.url, init }); return new Response("{}"); },
    readFile: async () => { throw new Error("no file"); },
  });
  await handle(request(`${ORG}/api/bots`, { referrer: `${ORG}/` }));
  await handle(request(`${ORG}/api/bots`, { method: "POST", body: "{}", headers: { "content-type": "application/json" }, referrer: `${ORG}/` }));
  await handle(request(`${ORG}/api/bots`, { method: "DELETE", referrer: "https://evil.example.test/" }));
  await handle(request("https://cdn.example.test/x.png"));
  // a bot-made widget (sandboxed srcdoc, no referrer) or any request without one
  await handle(request(`${ORG}/api/bots`, { method: "POST", body: "{}" }));
  const [read, write, foreign, other, widget] = fetched;
  assert.equal(read.url, `${ORG}/api/bots`);
  assert.equal(read.init.bypassCustomProtocolHandlers, true);
  assert.equal(read.init.credentials, "include");
  assert.equal(read.init.headers.get("origin"), null);
  assert.equal(write.init.method, "POST");
  assert.equal(write.init.credentials, "include");
  assert.equal(write.init.headers.get("origin"), ORG);
  assert.equal(write.init.headers.get("content-type"), "application/json");
  assert.equal(write.init.duplex, "half");
  assert.equal(foreign.init.headers.get("origin"), null, "a write sent from another page is not made same-origin");
  assert.equal(foreign.init.credentials, "omit", "nor does it carry the session");
  assert.equal(widget.init.credentials, "omit");
  assert.equal(widget.init.headers.get("origin"), null);
  // another origin is handed to the network as it came
  assert.equal(other.url, "https://cdn.example.test/x.png");
  assert.deepEqual(other.init, { bypassCustomProtocolHandlers: true });
});

test("in development the bundle comes from Vite", async () => {
  const fetched = [];
  const handle = ui.createBundledUiHandler({
    origin: () => ORG,
    devOrigin: () => "http://127.0.0.1:5999",
    fetch: async (input) => { fetched.push(input); return new Response("vite", { headers: { "content-type": "text/javascript" } }); },
    readFile: async () => { throw new Error("no file"); },
  });
  const answer = await handle(request(`${ORG}/src/main.tsx?t=1`));
  assert.equal(await answer.text(), "vite");
  assert.deepEqual(fetched, ["http://127.0.0.1:5999/src/main.tsx?t=1"]);
});

test("the detached windows' session answers UI files only, never a server path", async () => {
  const dir = bundleDir();
  const handle = ui.createDetachedUiHandler({ staticDir: () => dir, fetch: async () => { throw new Error("no network"); }, readFile: async (file) => readFileSync(file) });
  const page = await handle(request(`${ui.DETACHED_UI_ORIGIN}/?omb-floating-bot=1`));
  assert.match(await page.text(), /DESKTOP BUNDLE/);
  for (const url of [`${ui.DETACHED_UI_ORIGIN}/api/bots`, `${ORG}/`, `${ui.DETACHED_UI_ORIGIN}/auth/oidc/start`]) {
    assert.equal((await handle(request(url))).status, 403, url);
  }
  assert.equal((await handle(request(`${ui.DETACHED_UI_ORIGIN}/x`, { method: "POST", body: "x" }))).status, 403);
});

test("desktop-UI channels answer the local page and the bundled page's main frame only", () => {
  const LOCAL = "http://127.0.0.1:48995";
  localOrigin.setLocalOrigin(LOCAL);
  const handler = localOrigin.desktopUiOnly("fixture", () => "ok");
  const frame = (url) => ({ url });
  const event = (url, sub = false) => {
    const mainFrame = frame(url);
    return { sender: { mainFrame }, senderFrame: sub ? frame(url) : mainFrame };
  };
  try {
    assert.equal(handler(event(`${LOCAL}/`)), "ok");
    assert.throws(() => handler(event(`${ORG}/`)), /only available/);
    localOrigin.setBundledOrigin(ORG);
    assert.equal(handler(event(`${ORG}/`)), "ok");
    assert.throws(() => handler(event(`${ORG}/`, true)), /only available/, "a subframe never qualifies");
    assert.throws(() => handler(event("https://other.example.test/")), /only available/);
    // the strict local-only gate is unchanged: files, screen, logins stay local
    assert.throws(() => localOrigin.localOnly("fixture", () => "ok")(event(`${ORG}/`)), /only available/);
  } finally {
    localOrigin.setBundledOrigin(null);
    localOrigin.setLocalOrigin(null);
  }
});

function preloadBridge({ pageOrigin, bundled }) {
  const source = readFileSync(new URL("./preload.cjs", import.meta.url), "utf8");
  let bridge;
  const syncCalls = [];
  const context = vm.createContext({
    process: { platform: "fixture", argv: ["--omb-local-origin=http://127.0.0.1:48996"] },
    location: { origin: pageOrigin },
    TextEncoder,
    require: () => ({
      webUtils: {},
      contextBridge: { exposeInMainWorld: (_key, value) => { bridge = value; } },
      ipcRenderer: {
        on: () => {},
        send: () => {},
        invoke: () => Promise.resolve(),
        sendSync: (channel) => { syncCalls.push(channel); return bundled; },
      },
    }),
  });
  vm.runInContext(source, context);
  return { bridge, syncCalls };
}

test("the preload gives the bundled organization page the desktop-UI parts, and nothing local", () => {
  const remote = preloadBridge({ pageOrigin: ORG, bundled: false });
  const bundled = preloadBridge({ pageOrigin: ORG, bundled: true });
  assert.deepEqual(bundled.syncCalls, ["workspace:bundled-ui"]);
  for (const key of ["floatingBots", "retroAssistant", "windowControls", "onOpenAppSettings", "openExternal", "confirm", "updater", "serverMode"]) {
    assert.equal(remote.bridge[key], undefined, `a plain remote page has no ${key}`);
    assert.ok(bundled.bridge[key], `the bundled page has ${key}`);
  }
  for (const key of ["remoteClient", "environments", "setCredential", "saveFile", "pickFolder", "screenFrame", "companion", "desktopViewer", "approvals", "exportDiagnostics", "computerSharing"]) {
    assert.equal(bundled.bridge[key], undefined, `the bundled page never gets ${key}`);
  }
  // the local page asks nothing: it has the whole bridge
  const local = preloadBridge({ pageOrigin: "http://127.0.0.1:48996", bundled: true });
  assert.deepEqual(local.syncCalls, []);
  assert.ok(local.bridge.serverMode && local.bridge.environments);
});

test("main draws the bundle only for the active organization server and trusts it for the desktop-UI channels", () => {
  const main = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
  assert.match(main, /function syncBundledUi\(\) \{\n  const origin = bundledOrigin\(environmentsState\);/);
  assert.match(main, /environmentsState = next;\n  syncBundledUi\(\);/, "every saved change re-syncs the handler");
  assert.match(main, /environmentsState = readEnvironments\(\);\n  syncBundledUi\(\);/, "and the first read at launch");
  // floating bots and Hibou 98 follow the desktop's own UI, local or bundled
  assert.equal((main.match(/isTrustedMain: \(event\) => isDesktopUiSender\(event\)/g) ?? []).length, 2);
  assert.match(main, /ipcMain\.on\("workspace:bundled-ui"/);
  assert.match(main, /event\.senderFrame === win\.webContents\.mainFrame/);
});
