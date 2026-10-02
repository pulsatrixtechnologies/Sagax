// Electron side of scripts/verify-voice-mode.ts. Wired like electron/main.mjs
// in server mode: the bundled-UI handler for the organization server's
// origin, the preload, and main's permission policy (app-permissions.mjs)
// with the server's origin allowed the microphone only. Chromium's fake
// capture device plays the launcher's WAV as the microphone.
import { app, BrowserWindow, ipcMain, net, session } from "electron";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { appPermissionAllowed } from "../electron/app-permissions.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const signIn = require("../electron/oidc-system-sign-in.cjs");
const environments = require("../electron/environments.cjs");
const bundledUi = require("../electron/bundled-ui.cjs");
const localOrigin = require("../electron/local-origin.cjs");

const origin = process.env.VERIFY_ORIGIN;
const bundle = process.env.VERIFY_BUNDLE;
const xaiUrl = process.env.VERIFY_XAI;
const fakeKey = process.env.VERIFY_FAKE_KEY;
const FAKE_LOCAL = "http://127.0.0.1:1";

app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-file-for-fake-audio-capture", process.env.VERIFY_MIC_FILE);
// the audio service's sandbox cannot read the WAV file the fake device plays
app.commandLine.appendSwitch("disable-features", "AudioServiceSandbox");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("lang", "en-US");

const log = (line) => console.log(`[voice-mode] ${line}`);
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
const xaiRequests = async () => (await fetch(`${xaiUrl}/__requests`)).json();

let state = environments.withEnvironment({ environments: [], activeId: "local" }, { origin, name: "GOX" }, () => "org");
state = environments.withActive(state, "org");
state = environments.withOrganizationUpgrade(state, { orgOrigins: new Set([origin]), serverModeChosen: true });
const handoff = signIn.createSignInHandoff();

app.whenReady().then(async () => {
  localOrigin.setLocalOrigin(FAKE_LOCAL);
  const bundled = environments.bundledOrigin(state);
  localOrigin.setBundledOrigin(bundled);
  check("server mode on an organization server", bundled === origin && environments.serverModeEnvironment(state)?.origin === origin);
  const scheme = new URL(origin).protocol.slice(0, -1);
  session.defaultSession.protocol.handle(scheme, bundledUi.createBundledUiHandler({
    origin: () => bundled, staticDir: () => bundle, devOrigin: () => null,
    fetch: (i, init) => net.fetch(i, init), readFile: (f) => readFile(f),
  }));
  // main.mjs's policy: the bundled UI's origin may open the microphone only
  const asked = [];
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const requesting = details?.requestingUrl ?? contents?.getURL?.() ?? "";
    const granted = appPermissionAllowed(permission, requesting, FAKE_LOCAL, details, { microphoneOrigins: [bundled] });
    asked.push({ permission, mediaTypes: details?.mediaTypes, granted });
    callback(granted);
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin, details) =>
    appPermissionAllowed(permission, requestingOrigin || contents?.getURL?.() || "", FAKE_LOCAL, details, { microphoneOrigins: [bundled] }));

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
  ipcMain.on("workspace:bundled-ui", (event) => {
    event.returnValue = event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame && new URL(event.senderFrame.url).origin === bundled;
  });
  ipcMain.handle("server-mode:state", localOrigin.desktopUiOnly("server-mode:state", () => ({ active: true, name: "GOX", origin })));
  ipcMain.handle("workspaces:state", () => environments.workspaceSummary(state));
  ipcMain.handle("auth-return:take", (event, code) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) return false;
    return handoff.redeem(new URL(event.senderFrame.url).origin, code);
  });
  ipcMain.handle("pulsatrix-sign-in:state", () => ({ status: "waiting", origin }));
  // Windows-like capabilities: no macOS dictation at all
  ipcMain.handle("desktop:capabilities", () => ({
    host: { platform: "win32", label: "Fixture", session: "unknown", packaged: false }, windowChrome: "native",
    screenPreview: { available: false, interaction: "none" }, dictation: { available: false, engine: "none", onDevice: false, reasonCode: "remote-server" },
    localComputer: { available: false, support: "unsupported", enabled: false, status: "unavailable" },
  }));
  ipcMain.handle("desktop:skin", () => true);
  ipcMain.handle("window:state", () => ({ maximized: false }));
  ipcMain.handle("update:get-state", () => ({ status: "idle" }));
  ipcMain.handle("org-join:staged", () => null);
  ipcMain.handle("org-join:take-preferences", () => null);
  ipcMain.on("desktop:unread-count", () => {});
  ipcMain.on("floating-bots:update", () => {});
  ipcMain.handle("floating-bots:state", () => ({ bots: [] }));

  // Sign in with Pulsatrix through the loopback return.
  await win.loadURL(`${origin}/pair`);
  await wait(1500);
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
  check("signed in to the organization server", true, `role ${signed.role}`);
  await until("the app home", async () => new URL(win.webContents.getURL()).pathname === "/");

  // A bot named Cryptic, opened in the app.
  const created = await win.webContents.executeJavaScript(`fetch("/api/bots", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Cryptic" }) }).then(async r => ({ status: r.status, body: await r.json() }))`);
  const bot = created.body?.bot ?? created.body;
  check("a bot is created on the server", created.status < 300 && typeof bot?.id === "string", `HTTP ${created.status}`);
  const status = await win.webContents.executeJavaScript(`fetch("/api/bots/${bot.id}/voice/status").then(r => r.text())`);
  check("voice mode is available with the organization's xAI key, and the status carries no key", status.includes('"available":true') && status.includes('"via":"org-key"') && !status.includes(fakeKey.slice(8, 20)), status);
  await win.webContents.executeJavaScript(`location.href = "/#thread=${bot.threadId}&bot=${bot.id}"; location.reload(); true`);
  win.show();
  // the welcome tour of a first sign-in covers the app: skip it
  await until("the welcome tour", async () => win.webContents.executeJavaScript(`(() => {
    const skip = [...document.querySelectorAll("button")].find((b) => /skip tour/i.test(b.textContent ?? ""));
    if (skip) skip.click();
    return Boolean(skip) || Boolean(document.querySelector('[data-call-target]'));
  })()`), 15_000).catch(() => null);
  const button = await until("the voice mode call button", async () => win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector('[data-call-target="${bot.id}"]');
    return el ? { voiceMode: el.dataset.voiceMode ?? null, label: el.getAttribute("aria-label") } : null;
  })()`), 20_000).catch(() => null);
  check("the call button offers voice mode with xAI, with no macOS dictation on this device", button?.voiceMode === "xai", JSON.stringify(button));

  // Open the bar, muted first, then choose Voice, Speed and Language in its panel.
  await win.webContents.executeJavaScript(`document.querySelector('[data-call-target="${bot.id}"]').click(); true`);
  await until("the voice bar", async () => win.webContents.executeJavaScript(`Boolean(document.querySelector("[data-voice-bar]"))`));
  await win.webContents.executeJavaScript(`document.querySelector("[data-voice-mute]").click(); true`);
  check("the voice bar opens above the composer", true);
  const micGranted = await until("the microphone permission", async () => asked.find((entry) => entry.permission === "media") ?? null, 10_000).catch(() => null);
  check("the page asked for the microphone and main's policy granted audio only", Boolean(micGranted?.granted) && (micGranted.mediaTypes ?? ["audio"]).every((type) => type === "audio"), JSON.stringify(micGranted));
  const click = (selector) => win.webContents.executeJavaScript(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`);
  const pickOption = (list, value) => win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-voice-settings] [role=listbox] [data-value="${value}"]');
    const button = row && [...row.querySelectorAll("button")].find((b) => !b.dataset.preview);
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await click("[data-voice-gear]");
  await click('[data-voice-list="voice"]');
  const listed = await until("xAI's voices in the panel", async () => win.webContents.executeJavaScript(`[...document.querySelectorAll('[data-voice-settings] [data-preview]')].map((el) => el.dataset.preview)`).then((ids) => (ids.length ? ids : null)), 10_000).catch(() => []);
  check("the Voice list shows xAI's voices, each with a preview button, and Not set", JSON.stringify(listed) === JSON.stringify(["altair", "ara", "atlas", "eve"]), JSON.stringify(listed));
  await pickOption("voice", "ara");
  await click('[data-voice-list="speed"]');
  await pickOption("speed", "1.25");
  await click('[data-voice-list="language"]');
  await pickOption("language", "fr");
  const saved = await win.webContents.executeJavaScript(`localStorage.getItem("omb.voiceMode.v1")`);
  check("the choices are saved on this device", saved === JSON.stringify({ voice: "ara", speed: 1.25, language: "fr" }), saved);
  const onServer = await until("the choices on the server", async () => {
    const record = await win.webContents.executeJavaScript(`fetch("/api/me/preferences").then(r => r.json())`);
    return record.preferences?.["omb.voiceMode.v1"] === saved ? record : null;
  }, 15_000).catch(() => null);
  check("and saved for the person on the server (they follow them to Windows or the Mac)", Boolean(onServer));

  // Preview Ara: xAI speech with the chosen voice, speed and language, on the organization's key.
  await click('[data-voice-list="voice"]');
  await until("the preview button", async () => click('[data-preview="ara"]'), 5_000);
  const tts = await until("xAI's speech request", async () => (await xaiRequests()).find((r) => r.path === "/v1/tts") ?? null, 10_000).catch(() => null);
  check("a preview asks xAI for speech with voice ara, speed 1.25, language fr", tts?.json?.voice_id === "ara" && tts.json.speed === 1.25 && tts.json.language === "fr", JSON.stringify(tts?.json));
  check("xAI received the organization's key from the server", tts?.authorization === `Bearer ${fakeKey}`);

  // Unmute: the microphone hears a turn, the server transcribes it with xAI, the bot gets it.
  await click("[data-voice-gear]");
  await click("[data-voice-mute]");
  const stt = await until("xAI's transcription request", async () => (await xaiRequests()).find((r) => r.path === "/v1/stt") ?? null, 30_000).catch(() => null);
  check("the turn reached xAI speech to text as WAV with the language hint fr", stt?.fileHead === "RIFF" && stt?.fields?.language === "fr", JSON.stringify(stt?.fields ?? null));
  const sent = await until("the spoken message on the thread", async () => {
    const page = await win.webContents.executeJavaScript(`fetch("/api/threads/${bot.threadId}/messages").then(r => r.json()).catch(() => null)`);
    const list = Array.isArray(page) ? page : page?.messages ?? [];
    return list.find((message) => message.role === "user" && String(message.text ?? "").includes("Hello Cryptic from voice mode")) ?? null;
  }, 20_000).catch(() => null);
  check("what was said reaches the bot's thread as the signed-in person", Boolean(sent) && Boolean(sent.sender?.id), sent ? `sender ${sent.sender?.name ?? sent.sender?.id}` : "none");

  // The key never reaches the page.
  const page = await win.webContents.executeJavaScript(`JSON.stringify({ html: document.documentElement.outerHTML, local: { ...localStorage }, session: { ...sessionStorage } })`);
  check("the xAI key is nowhere in the page", !page.includes(fakeKey.slice(8, 20)));

  if (process.env.VERIFY_SHOT_DIR) {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(process.env.VERIFY_SHOT_DIR, { recursive: true });
    await click("[data-voice-gear]");
    await click('[data-voice-list="voice"]');
    await wait(600);
    writeFileSync(path.join(process.env.VERIFY_SHOT_DIR, "voice-bar.png"), (await win.webContents.capturePage()).toPNG());
    await click("[data-voice-gear]");
  }

  // End: the bar goes away.
  await click("[data-voice-end]");
  const ended = await until("the bar to close", async () => win.webContents.executeJavaScript(`!document.querySelector("[data-voice-bar]")`), 5_000).catch(() => false);
  check("the red X ends voice mode", ended);

  const ok = checks.every(Boolean);
  console.log(`[verify] ${ok ? "PASS" : "FAIL"} (${checks.filter(Boolean).length}/${checks.length})`);
  app.exit(ok ? 0 : 1);
}).catch((error) => {
  console.log(`[verify] FAIL ${error?.stack ?? error}`);
  app.exit(1);
});
