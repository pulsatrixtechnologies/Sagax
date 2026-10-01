// Electron side of scripts/verify-server-mode.ts. It wires the app's real
// pieces the way electron/main.mjs does in server mode: the bundled-UI
// handler for the organization server's origin, the preload with its
// bundled-page bridge (asked over workspace:bundled-ui), the desktop-UI IPC
// gate, the floating bot windows (drawn from the bundle in their own
// cookie-less session, as when no local server runs) and the loopback
// sign-in return. The "system browser" is played with fetch.
import { app, BrowserWindow, ipcMain, net, screen, session } from "electron";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createFloatingBotWindows, FLOATING_QUERY } from "../electron/floating-bot-window.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const signIn = require("../electron/oidc-system-sign-in.cjs");
const environments = require("../electron/environments.cjs");
const bundledUi = require("../electron/bundled-ui.cjs");
const localOrigin = require("../electron/local-origin.cjs");

const origin = process.env.VERIFY_ORIGIN;
const bundle = process.env.VERIFY_BUNDLE;
const FAKE_LOCAL = "http://127.0.0.1:1";
const log = (line) => console.log(`[server-mode] ${line}`);
const checks = [];
const check = (name, ok, detail = "") => {
  checks.push(ok);
  log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(what, predicate, ms = 15_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = await predicate();
    if (value) return value;
    await wait(150);
  }
  throw new Error(`timed out waiting for ${what}`);
}

// Server mode, as the launch screen's join leaves it.
let state = environments.withEnvironment({ environments: [], activeId: "local" }, { origin, name: "GOX", org: true }, () => "org");
state = environments.withServerMode(state, "org");
const handoff = signIn.createSignInHandoff();

app.whenReady().then(async () => {
  localOrigin.setLocalOrigin(FAKE_LOCAL);
  const bundled = environments.bundledOrigin(state);
  localOrigin.setBundledOrigin(bundled);
  const scheme = new URL(bundled).protocol.slice(0, -1);
  session.defaultSession.protocol.handle(scheme, bundledUi.createBundledUiHandler({
    origin: () => bundled, staticDir: () => bundle, fetch: (i, init) => net.fetch(i, init), readFile: (f) => readFile(f),
  }));
  const detached = session.fromPartition("sagax-detached-ui");
  detached.protocol.handle("https", bundledUi.createDetachedUiHandler({
    staticDir: () => bundle, fetch: (i, init) => net.fetch(i, init), readFile: (f) => readFile(f),
  }));

  const win = new BrowserWindow({
    show: false, width: 1200, height: 800,
    webPreferences: {
      preload: path.join(ROOT, "electron", "preload.cjs"),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      additionalArguments: [`--omb-local-origin=${FAKE_LOCAL}`],
    },
  });
  win.webContents.on("console-message", (details) => {
    if (details.level === "error") log(`page error: ${String(details.message).slice(0, 200)}`);
  });

  // The IPC main.mjs answers for this page.
  ipcMain.on("workspace:bundled-ui", (event) => {
    event.returnValue = event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
      new URL(event.senderFrame.url).origin === bundled;
  });
  ipcMain.handle("server-mode:state", localOrigin.desktopUiOnly("server-mode:state", () => ({ active: true, name: "GOX", origin })));
  ipcMain.handle("workspaces:state", () => environments.workspaceSummary(state));
  ipcMain.handle("auth-return:take", (event, code) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return false;
    return handoff.redeem(new URL(event.senderFrame.url).origin, code);
  });
  ipcMain.handle("pulsatrix-sign-in:state", () => ({ status: "waiting", origin }));
  ipcMain.handle("desktop:capabilities", () => ({
    host: { platform: "other", label: "Fixture", session: "unknown", packaged: false }, windowChrome: "native",
    screenPreview: { available: false, interaction: "none" }, dictation: { available: false, engine: "none", onDevice: false },
    localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable" },
  }));
  ipcMain.handle("desktop:skin", () => true);
  ipcMain.handle("window:state", () => ({ maximized: false }));
  ipcMain.handle("update:get-state", () => ({ status: "idle" }));
  ipcMain.handle("org-join:staged", () => null);
  // The launch screen handed this computer's preferences over at join.
  let handedOver = { "omb-skin": "midnight", "omb-language": "fr" };
  ipcMain.handle("org-join:take-preferences", () => { const out = handedOver; handedOver = null; return out; });
  ipcMain.on("desktop:unread-count", () => {});

  // Floating bots: watch what the page sends and what the windows answer.
  const updates = [];
  let floatReady = 0;
  const watchedIpc = {
    handle: (channel, handler) => ipcMain.handle(channel, handler),
    removeHandler: (channel) => ipcMain.removeHandler(channel),
    removeListener: (channel, handler) => ipcMain.removeListener(channel, handler),
    on: (channel, handler) => ipcMain.on(channel, (event, ...args) => {
      if (channel === "floating-bots:update") updates.push(args[0]);
      if (channel === "floating-bots:ready") floatReady++;
      return handler(event, ...args);
    }),
  };
  const floats = createFloatingBotWindows({
    whenReady: () => app.whenReady(), BrowserWindow, screen, ipcMain: watchedIpc,
    getMainWindow: () => win,
    isTrustedMain: (event) => localOrigin.isDesktopUiSender(event),
    pageUrl: () => `${bundledUi.DETACHED_UI_ORIGIN}/?${FLOATING_QUERY}`,
    preload: path.join(ROOT, "electron", "floating-bot-preload.cjs"),
    session: () => detached,
    log: (line) => log(`floating: ${line}`),
  });

  // 1. Where org-join leaves the window: the server's sign-in page.
  await win.loadURL(`${origin}/pair`);
  await wait(1500);
  const pairTitle = await win.webContents.executeJavaScript("document.title");
  const pairText = await win.webContents.executeJavaScript("document.body.innerText");
  check("the /pair page is this app's bundle, not the server's page", !/SERVER IMAGE UI/.test(pairTitle) && !/served by the server/.test(pairText), `title "${pairTitle}"`);

  // 2. Sign in with Pulsatrix through the loopback return.
  const loopback = await signIn.startLoopbackReturn({ log: () => {} });
  const start = await fetch(signIn.desktopStartUrl(origin, loopback.returnTo), { redirect: "manual" });
  const binding = start.headers.getSetCookie().find((c) => c.includes("_oidc=")).split(";")[0];
  const authorize = await fetch(start.headers.get("location"), { redirect: "manual" });
  const callback = await fetch(authorize.headers.get("location"), { redirect: "manual", headers: { cookie: binding } });
  const landing = new URL(callback.headers.get("location"));
  await fetch(`${landing.origin}${landing.pathname}`);
  await fetch(`${landing.origin}${landing.pathname}`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: landing.origin },
    body: new URLSearchParams(landing.hash.slice(1)).toString(),
  });
  const outcome = await loopback.result;
  const parsed = { origin, code: outcome.code };
  handoff.accept(parsed);
  await win.loadURL(signIn.authReturnTarget(parsed)).catch(() => {});
  const signed = await until("the session", async () => {
    const answer = await win.webContents.executeJavaScript("fetch('/api/auth/session').then(r => r.json()).catch(() => null)");
    return answer?.identity === "perspicax" ? answer : null;
  });
  check("signed in to the organization server through this app's page", true, `role ${signed.role}`);
  await until("the app home", async () => new URL(win.webContents.getURL()).pathname === "/");
  await wait(2500);

  // 2b. First sign-in: this computer's preferences became the person's, on the server.
  const prefs = await win.webContents.executeJavaScript(`fetch("/api/me/preferences").then(r => r.json()).then(record => ({ record, skin: localStorage.getItem("omb-skin"), language: localStorage.getItem("omb-language") }))`);
  check("this computer's preferences were saved for the person on the server, once, without asking", prefs.record.stored === true && prefs.record.preferences["omb-skin"] === "midnight" && prefs.skin === "midnight" && prefs.language === "fr", JSON.stringify(prefs.record.preferences));
  await win.webContents.executeJavaScript(`localStorage.setItem("omb-font", "serif")`);
  const saved = await until("a changed preference on the server", async () => {
    const record = await win.webContents.executeJavaScript(`fetch("/api/me/preferences").then(r => r.json())`);
    return record.preferences?.["omb-font"] === "serif" ? record : null;
  }).catch(() => null);
  check("a preference changed in the app is saved on the server", Boolean(saved));

  // 3. The UI is this app's own, with the desktop-UI bridge and nothing local.
  const page = await win.webContents.executeJavaScript(`({
    title: document.title,
    decoy: document.body.innerText.includes("served by the server"),
    rendered: (document.getElementById("root")?.childElementCount ?? 0) > 0,
    ogb: Object.keys(window.ogb ?? {}).sort(),
  })`);
  check("the app is this app's bundle on the server's origin", page.rendered && !page.decoy && !/SERVER IMAGE UI/.test(page.title), `title "${page.title}"`);
  for (const key of ["floatingBots", "windowControls", "onOpenAppSettings", "openExternal", "confirm", "updater", "serverMode"]) {
    check(`the page has ${key}`, page.ogb.includes(key));
  }
  for (const key of ["environments", "remoteClient", "setCredential", "pickFolder", "screenFrame", "companion", "exportDiagnostics"]) {
    check(`the page has no ${key}`, !page.ogb.includes(key));
  }
  const serverMode = await win.webContents.executeJavaScript("window.ogb.serverMode.state()");
  check("server mode answers this page", serverMode.active === true && serverMode.origin === origin);
  const subframe = await win.webContents.executeJavaScript(`new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.src = "/assets/../pair";
    frame.onload = () => resolve(Boolean(frame.contentWindow.ogb?.floatingBots));
    document.body.appendChild(frame);
    setTimeout(() => resolve("timeout"), 5000);
  })`);
  check("a subframe on the same origin gets no desktop-UI bridge", subframe === false, String(subframe));

  // 4. A write through the page (the server checks Origin on cookie writes).
  const created = await win.webContents.executeJavaScript(`fetch("/api/bots", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Remote owl", mascotLook: { character: "owl" } }) }).then(async r => ({ status: r.status, body: await r.json() }))`);
  const botId = created.body?.bot?.id ?? created.body?.id;
  check("a bot is created on the server from this app's page", created.status < 300 && typeof botId === "string", `HTTP ${created.status}`);

  // 5. Float it: the mascot's window opens and its state comes from the server.
  await win.webContents.executeJavaScript(`localStorage.setItem("omb.floatingBots.v1", JSON.stringify({ bots: [{ id: ${JSON.stringify(botId)}, top: true }] })); location.reload();`);
  await until("the floating window", async () => floats.list?.().length || updates.some((u) => u?.botId === botId));
  const first = await until("a snapshot for the remote bot", async () => updates.find((u) => u?.botId === botId && u.snapshot));
  check("the page drives a floating window for the server's bot", Boolean(first), `mascot ${JSON.stringify(first.snapshot?.mascot ?? null)}`);
  await until("the floating page", async () => floatReady > 0);
  check("the floating window's page loaded from this app's bundle, in a session with no cookie", floatReady > 0 && (await detached.cookies.get({})).length === 0);
  const before = updates.length;
  const patched = await win.webContents.executeJavaScript(`fetch("/api/bots/" + ${JSON.stringify(botId)}, { method: "PATCH", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mascotLook: { character: "trombi" } }) }).then(r => r.status)`);
  const changed = await until("the new look in a snapshot", async () => updates.slice(before).find((u) => u?.botId === botId && u.snapshot?.mascot?.character === "trombi"), 15_000).catch(() => null);
  check("a change made on the server reaches the mascot", patched < 300 && Boolean(changed), `PATCH ${patched}`);

  const ok = checks.every(Boolean);
  console.log(`[verify] ${ok ? "PASS" : "FAIL"} (${checks.filter(Boolean).length}/${checks.length})`);
  floats.closeAll();
  app.exit(ok ? 0 : 1);
}).catch((error) => {
  console.log(`[verify] FAIL ${error?.stack ?? error}`);
  app.exit(1);
});
