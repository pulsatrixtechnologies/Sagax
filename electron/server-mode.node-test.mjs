// Server mode in main (electron/main.mjs): exclusive while on, one way out
// that signs out and comes back to this computer, no local server started
// for it. The functions run from main's own source in a vm with fakes.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const env = require("./environments.cjs");
const source = readFileSync(new URL("./main.mjs", import.meta.url), "utf8");
const ORG = "https://org.example.test";
const LOCAL = "http://127.0.0.1:48997";

function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `main.mjs section moved: ${start}`);
  return source.slice(from, to);
}

function fixture({ response = 0, packaged = false, serverReady = true, logout = true } = {}) {
  let state = env.withEnvironment({ environments: [], activeId: "local" }, { origin: "https://hosted.example.test" }, () => "h1");
  state = env.withServerMode(env.withEnvironment(state, { origin: ORG, name: "GOX", org: true }, () => "o1"), "o1");
  const calls = { navigated: [], persisted: [], fetched: [], cleared: [], closed: 0, relaunched: 0, dialogs: [], forgotten: [] };
  const context = vm.createContext({
    environmentsState: state,
    LOCAL_ID: env.LOCAL_ID,
    serverModeEnvironment: env.serverModeEnvironment,
    withActive: env.withActive,
    withoutServerMode: env.withoutServerMode,
    activeOrigin: () => env.activeEnvironment(context.environmentsState)?.origin ?? LOCAL,
    rendererOrigin: () => LOCAL,
    persistEnvironments: (next) => { calls.persisted.push(next); context.environmentsState = next; },
    navigateMainWindow: (url) => calls.navigated.push(url),
    mainWindow: { isDestroyed: () => false },
    dialog: { showMessageBox: async (_win, options) => { calls.dialogs.push(options); return { response }; } },
    session: { defaultSession: {
      fetch: async (url, init) => { calls.fetched.push([url, init.method, init.credentials, init.bypassCustomProtocolHandlers]); return { ok: logout, status: logout ? 200 : 500 }; },
      clearStorageData: async (options) => { calls.cleared.push(options.origin); },
    } },
    sharingController: () => ({ forget: (entry) => calls.forgotten.push(entry.id) }),
    floatingBotWindows: { closeAll: () => { calls.closed++; } },
    retroAssistantWindow: { close: () => {} },
    app: { isPackaged: packaged },
    serverReady,
    desktopRemoteAccess: null,
    relaunchAfterDesktopRemoteChange: () => { calls.relaunched++; },
    slog: () => {},
    AbortSignal,
    URL,
  });
  vm.runInContext(`${section("function requireNotServerMode()", "const organizationEntry = createOrganizationEntry(")}
    this.requireNotServerMode = requireNotServerMode; this.switchEnvironment = switchEnvironment; this.leaveServerMode = leaveServerMode;`, context);
  return { context, calls };
}

test("while server mode is on, nothing switches to this computer or another server", () => {
  const { context, calls } = fixture();
  context.switchEnvironment("local");
  context.switchEnvironment("h1");
  assert.deepEqual(calls.persisted, []);
  assert.deepEqual(calls.navigated, []);
  assert.throws(() => context.requireNotServerMode(), /connected to GOX/);
});

test("leaving asks first; Cancel changes nothing", async () => {
  const { context, calls } = fixture({ response: 1 });
  assert.equal((await context.leaveServerMode()).left, false);
  assert.equal(calls.dialogs.length, 1);
  assert.match(calls.dialogs[0].detail, /nothing on this computer is changed/);
  assert.deepEqual(calls.fetched, []);
  assert.equal(context.environmentsState.serverModeId, "o1");
});

test("leaving signs out of the server, forgets it and its page data, and shows this computer again", async () => {
  const { context, calls } = fixture();
  assert.equal((await context.leaveServerMode()).left, true);
  assert.deepEqual(calls.fetched, [[`${ORG}/api/auth/logout`, "POST", "include", true]], "main signs out itself, past the bundled-UI handler");
  assert.deepEqual(calls.cleared, [ORG]);
  assert.deepEqual(calls.forgotten, ["o1"]);
  assert.equal(calls.closed, 1, "the server's floating bots go with it");
  assert.equal(context.environmentsState.serverModeId, undefined);
  assert.equal(context.environmentsState.activeId, "local");
  assert.deepEqual(context.environmentsState.environments.map((entry) => entry.id), ["h1"], "only that server is forgotten");
  assert.deepEqual(calls.navigated, [`${LOCAL}/`]);
  assert.equal(calls.relaunched, 0);
});

test("a sign-out the server cannot confirm still leaves; a packaged app with no local server restarts to start it", async () => {
  const { context, calls } = fixture({ packaged: true, serverReady: false, logout: false });
  assert.equal((await context.leaveServerMode()).left, true);
  assert.equal(context.environmentsState.serverModeId, undefined);
  assert.equal(calls.relaunched, 1);
  assert.deepEqual(calls.navigated, []);
});

test("the packaged app starts no local server in server mode, and the window never falls back to Local", () => {
  assert.match(source, /\} else if \(app\.isPackaged && serverModeEnvironment\(readEnvironments\(\)\)\) \{\n[\s\S]{0,400}?slog\("server mode: the local server is not started"\);\n  \} else if \(app\.isPackaged\) \{\n    await startServerPackaged\(\);/);
  const failLoad = section('win.webContents.on("did-fail-load"', 'win.webContents.on("did-finish-load"');
  assert.ok(failLoad.indexOf("serverModeEnvironment(environmentsState)") < failLoad.indexOf("switchEnvironment(LOCAL_ID)"));
  // the launch screen's join is what turns it on, on a probed organization server
  assert.match(source, /next = options\?\.serverMode === true \? withServerMode\(next, entry\.id\) : withActive\(next, entry\.id\);/);
  assert.match(source, /withEnvironment\(environmentsState, \{ origin, name: new URL\(origin\)\.host, org: true \}/);
  // forgetting the server-mode server is leaving it
  assert.match(section("async function forgetEnvironment(", "function showContextMenu"), /serverModeEnvironment\(environmentsState\)\?\.id === id\) \{\n    await leaveServerMode\(\);/);
});

test("in server mode the bundled page sets what this computer lends to that server only; never to another", async () => {
  const localOrigin = require("./local-origin.cjs");
  const LOCAL_PAGE = "http://127.0.0.1:48998";
  let state = env.withEnvironment({ environments: [], activeId: "local" }, { origin: "https://hosted.example.test" }, () => "h1");
  state = env.withServerMode(env.withEnvironment(state, { origin: ORG, name: "GOX", org: true }, () => "o1"), "o1");
  const frame = { url: `${ORG}/` }, contents = { mainFrame: frame };
  const context = vm.createContext({
    desktopUiOnly: localOrigin.desktopUiOnly, senderIsLocal: localOrigin.isLocalSender,
    workspaceOnly: (handler) => handler, serverModeEnvironment: env.serverModeEnvironment, environmentsState: state,
  });
  vm.runInContext(`${section("const sharingUiOnly =", 'ipcMain.handle("sharing:state"')}; this.sharingUiOnly = sharingUiOnly;`, context);
  const handler = context.sharingUiOnly("sharing:state", (_event, id) => `state of ${id}`);
  localOrigin.setLocalOrigin(LOCAL_PAGE);
  localOrigin.setBundledOrigin(ORG);
  try {
    const event = { sender: contents, senderFrame: frame };
    assert.equal(handler(event, "o1"), "state of o1");
    assert.throws(() => handler(event, "h1"), /only available for this server/);
    // out of server mode the organization page may not touch sharing at all
    context.environmentsState = env.withoutServerMode(state);
    assert.throws(() => handler(event, "o1"), /only available for this server/);
    // the local page keeps sharing for any saved server
    const localFrame = { url: `${LOCAL_PAGE}/` };
    assert.equal(handler({ sender: { mainFrame: localFrame }, senderFrame: localFrame }, "h1"), "state of h1");
  } finally {
    localOrigin.setBundledOrigin(null);
    localOrigin.setLocalOrigin(null);
  }
});

test("server mode shares this computer by the organization server's own word, with no local seat to lease", () => {
  const refresh = section("async function refreshSharedComputersAllowed()", "/** Refuse a workspace sharing control");
  assert.match(refresh, /const locked = serverModeEnvironment\(environmentsState\);\n  if \(locked\) \{\n    sharedComputersAllowed = await fetch\(`\$\{locked\.origin\}\/\.well-known\/openmausbot\/environment`/);
  assert.match(refresh, /descriptor\?\.capabilities\?\.sharedComputers === true/);
  assert.match(source, /if \(serverModeEnvironment\(environmentsState\) && !serverReady\) return \{ renew: async \(\) => \{\}, release: async \(\) => \{\} \};/);
  for (const channel of ["sharing:state", "sharing:folder", "sharing:revoke", "sharing:save"]) {
    assert.match(source, new RegExp(`ipcMain\\.handle\\("${channel}", sharingUiOnly\\("${channel}"`));
  }
});
