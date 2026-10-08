// First: SAGAX_* settings onto the names the code reads (legacy-names.mjs).
import "./legacy-env-boot.mjs";
import { app, autoUpdater as nativeAutoUpdater, BrowserWindow, Tray, WebContentsView, clipboard, desktopCapturer, dialog, ipcMain, Menu, nativeImage, net, powerMonitor, powerSaveBlocker, safeStorage, screen, session, shell, systemPreferences, utilityProcess } from "electron";
import { createRequire } from "node:module";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startCua, stopCua, registerCuaIpc, setCuaStateListener } from "./cua.mjs";
import { createAndroidDeviceController } from "./android-device.mjs";
import { finishSpeech, startSpeech, stopSpeech } from "./speech.mjs";
import { openBlankTerminal } from "./terminal-launch.mjs";
import { pasteMenuItem } from "./paste-menu-item.mjs";
import { attachUpdaterWindow, startUpdater, registerUpdaterIpc } from "./updater.mjs";
import {
  buildDiagnosticsReport,
  diagnosticsFileName,
  formatDesktopCrashRecord,
  installDesktopCrashListeners,
  readSafeLogTail,
} from "./diagnostics.mjs";
import { migrateWorkspaceCredentials, workspaceCredentialEnv } from "./workspace-credentials.mjs";
import { evictStartupCacheOnce } from "./startup-cache-eviction.mjs";
import { activateExistingWindow, releaseSingleInstanceLock } from "./single-instance.mjs";
import { pollServerIdentity } from "./server-boot-probe.mjs";
import { createServerSupervisor } from "./server-supervisor.mjs";
import { serverChildLaunch } from "./server-child-launch.mjs";
import { packageUrlFromCommandLine, packageUrlFromDeepLink } from "./package-link.mjs";
import { createOrganizationEntry, ORGANIZATION_DEEP_LINK, isOrganizationDeepLink, takeOrganizationDeepLink, organizationRestartIntent, withOrganizationRestartIntent, withoutOrganizationRestartIntent } from "./organization-entry.mjs";
import { createRotatingLog } from "./log-file.mjs";
import { createOrgJoin, forgetDetail } from "./org-join.mjs";
import { createOwnerIdentitySync } from "./owner-identity.mjs";
import { trafficLightsForSkin, windowChromeOptions } from "./window-chrome.mjs";
import { createWindowNudger } from "./window-nudge.mjs";
import { createAllWindowsClosedQuit } from "./window-all-closed.mjs";
import { createStartupScreen } from "./startup-screen.mjs";
import { createSystemTray } from "./system-tray.mjs";
let startupScreen = null;
let desktopTray = null;
import { collisionFreeDownloadPath, defaultSaveName, revealDownloadWhenDone, revealInFolder, withSavableFile } from "./save-file.mjs";
import { desktopViewerPermissionAllowed } from "./desktop-viewer-permissions.mjs";
import { appPermissionHandlers, externalOpenUrl, externalWebUrl } from "./app-permissions.mjs";
import { writeClipboardText } from "./clipboard-write.mjs";
import {
  ensureManagedComposioCredentials,
  managedComposioAccess,
  managedComposioChildEnvironment,
  normalizeManagedComposioBrokerUrl,
} from "./managed-composio.mjs";
import {
  createManagedCompanionTunnel,
  managedCompanionTunnelAccess,
  resolveCloudflaredBinary,
  resolveManagedCompanionGuardian,
  withManagedCompanionTunnelAccess,
  withoutManagedCompanionTunnelAccess,
} from "./managed-companion-tunnel.mjs";
import { createSecureCredentialState } from "./secure-credential-state.mjs";
import {
  createPhoneSecretSaveCoordinator,
  createPhoneSecretIdentity,
  decodePhoneSecretSaveRequest,
  phoneSecretPrivateKeyMessage,
  readPhoneSecretIdentity,
  withPhoneSecretIdentity,
} from "./phone-secret-identity.mjs";
import {
  desktopCompanionAccess,
  desktopCompanionRendererArguments,
  pairDesktopCompanion,
  startDesktopCompanionRelay,
  withDesktopCompanionAccess,
  withoutDesktopCompanionAccess,
} from "./desktop-companion-client.mjs";
import { isKnownSkin, skinChrome } from "./skin-overlay.cjs";
import { createRetroAssistantWindow, DETACHED_QUERY } from "./retro-assistant-window.mjs";
import { createFloatingBotWindows, FLOATING_QUERY, waitForPage as waitForFloatingPage } from "./floating-bot-window.mjs";
import { readSecureCredentials } from "./secure-credentials.mjs";
import { createControlPlaneClient } from "./control-plane-client.mjs";
import {
  companionAccountCleanupPending,
  createCompanionAccountService,
  resolveCompanionControlPlaneURL,
} from "./companion-account-service.mjs";
import capabilitiesModule from "./capabilities.cjs";
import environmentsModule from "./environments.cjs";
import bundledUiModule from "./bundled-ui.cjs";
import oidcSignInModule from "./oidc-system-sign-in.cjs";
import localOriginModule from "./local-origin.cjs";
import { buildApplicationMenu } from "./menu.mjs";
import { createComputerSharing, validateSharedFolders } from "./computer-sharing.mjs";
import { createDesktopBridge } from "./desktop-bridge.mjs";
import { applyAppIcon, createAppIconStore, parseAppIconRequest, windowIconPath } from "./app-icon.mjs";
import { createProxyCredentialStore, createProxyCredentials, proxyPasswordAnswerScript, proxyPasswordPage } from "./proxy-credentials.mjs";
import { createLocalVm } from "./local-vm.mjs";
import { acquireDataDirLease } from "./data-dir-lease.mjs";
import { defaultDataDir, fetchEnvironmentDescriptor, URL_SCHEMES } from "./legacy-names.mjs";
import { createManagedDesktopClient, createManagedDesktopRelay, createManagedDesktopStore } from "./managed-desktop.mjs";
import { createOrgLibrary } from "./org-library.mjs";
import { createCompanyBackups } from "./company-backups.mjs";
import { createCompanyBackupSchedule } from "./company-backup-schedule.mjs";
import { keepUserDataInPlace, RUNTIME_NAME } from "./user-data-location.mjs";
import { migrateSafeStorageKeychain } from "./keychain-migration.mjs";
import { FULL_NAME } from "./app-name.mjs";

// Before anything reads userData: the folder is pinned (moved once from
// "openmausbot" to "sagax"), never derived from the on-screen name, and the
// keychain secret keeps its name (see user-data-location.mjs).
keepUserDataInPlace(app);
// Inert while the runtime name is still RUNTIME_NAME. Once it changes, the
// new "<name> Safe Storage" keychain entry is copied from the old one before
// safeStorage is first used (keychain-migration.mjs).
const keychainReady = app.getName() !== RUNTIME_NAME
  ? migrateSafeStorageKeychain({ to: app.getName(), log: (line) => console.warn(line) }).catch(() => "failed")
  : Promise.resolve("same");
// The native About panel (macOS app menu, Linux) would say "openmausbot".
app.setAboutPanelOptions({ applicationName: FULL_NAME });

const { desktopCapabilities, nativeDesktopActions } = capabilitiesModule;
const nativeActions = nativeDesktopActions(process.platform);
const require = createRequire(import.meta.url);
const { createDisplayMediaGuard, invokeDisplayMediaCallback, selectCaptureSource } = require(
  "./screen-preview.cjs",
);
const { STAGE_PREFIX: APPIMAGE_CUA_STAGE_PREFIX } = require("./cua-linux-bundle.cjs");
const { desktopViewerUrl, sameDesktopViewerOrigin } = require("./desktop-viewer.cjs");
const { createDesktopWorkspaceManager } = require("./desktop-workspace.cjs");
const { createTrustedApprovalModeCoordinator } = require("./approval-trusted-mode.cjs");
const { DESKTOP_MUTATION_HEADER, desktopServerHeaders } = require("./desktop-server-auth.cjs");
const { MIN_BOUNDS, normalizeUnreadCount, parseWindowState, resolveWindowState } = require("./window-state.cjs");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 127.0.0.1 explicitly — vite binds IPv4; a bare "localhost" here can
// resolve to ::1 and paint a black window
const DEV_URL = process.env.ELECTRON_START_URL ?? "http://127.0.0.1:5199";
let SERVER_PORT = 8799;
const APP_ICON = path.join(__dirname, "resources/app-icon.png");
function devBundleHasSystemIcon() {
  try {
    const plist = fs.readFileSync(path.join(path.dirname(process.execPath), "../Info.plist"), "utf8");
    return /<key>CFBundleIconName<\/key>\s*<string>PulsaBotIcon<\/string>/.test(plist);
  } catch {
    return false;
  }
}
// Settings > Appearance > App icon (electron/app-icon.mjs). Read lazily:
// userData is pinned before anything reads it.
let appIconStoreInstance = null;
const appIconStore = () => (appIconStoreInstance ??= createAppIconStore(app.getPath("userData")));
function savedAppIcon() {
  try { return appIconStore().load(); } catch { return null; }
}
/** The icon a new window opens with: the person's custom one on Windows
 * and Linux (the taskbar shows the window's icon), else the app's. */
function currentWindowIcon() {
  return process.platform === "darwin" ? APP_ICON : windowIconPath(savedAppIcon(), process.platform, APP_ICON);
}
function showAppIcon(saved) {
  return applyAppIcon(saved, {
    platform: process.platform,
    app,
    windows: BrowserWindow.getAllWindows(),
    nativeImage,
    defaultIconPath: APP_ICON,
    // A runtime Dock image drops the Liquid Glass rendering of the bundle
    // icon, so the default is the bundle's own (null), except in an
    // unpackaged run without a compiled icon, which shows the flat PNG.
    defaultDockIcon: !app.isPackaged && !devBundleHasSystemIcon() ? APP_ICON : null,
  });
}
let desktopViewerWindow = null;
let desktopViewerOwner = null;
let desktopViewerContextId = null;
let desktopWorkspaceManager = null;
let desktopWorkspaceOwner = null;
let pendingOrganizationEntry = takeOrganizationDeepLink(process.argv);
let pendingPackageInstallUrl = pendingOrganizationEntry ? null : packageUrlFromCommandLine(process.argv);
let organizationEntryReady = false;
let mainWindow = null;
const serverUnavailableWindows = new WeakSet();
let unreadCount = 0;
let unreadOverlayIcon = null;

function windowStateFile() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function readWindowState() {
  try {
    return parseWindowState(fs.readFileSync(windowStateFile(), "utf8"));
  } catch {
    return null;
  }
}

function writeWindowState(win) {
  if (!win || win.isDestroyed()) return;
  const file = windowStateFile();
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      temporary,
      JSON.stringify({ bounds: win.getNormalBounds(), maximized: win.isMaximized() }),
      { mode: 0o600 },
    );
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {}
    slog(`window state save failed: ${error?.message ?? error}`);
  }
}

function installWindowStatePersistence(win) {
  let timer = null;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    writeWindowState(win);
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 250);
    timer.unref?.();
  };
  win.on("resize", schedule);
  win.on("move", schedule);
  // The renderer's caption buttons track the native maximize state (the
  // restore/maximize glyph flips); a lost push just leaves a stale glyph
  // until the next toggle, so a send failure is not fatal.
  const pushMaximized = () => {
    try {
      if (!win.isDestroyed()) win.webContents.send("window:maximized-changed", win.isMaximized());
    } catch {}
  };
  win.on("maximize", pushMaximized);
  win.on("unmaximize", pushMaximized);
  win.on("maximize", schedule);
  win.on("unmaximize", schedule);
  win.on("close", flush);
}

function applyUnreadBadge(win = mainWindow) {
  const count = normalizeUnreadCount(unreadCount);
  if (process.platform === "win32") {
    if (!win || win.isDestroyed()) return;
    unreadOverlayIcon ??= nativeImage.createFromPath(APP_ICON).resize({ width: 16, height: 16 });
    win.setOverlayIcon(
      count > 0 && !unreadOverlayIcon.isEmpty() ? unreadOverlayIcon : null,
      count > 0 ? `${count} unread conversation${count === 1 ? "" : "s"}` : "No unread conversations",
    );
    return;
  }
  if (process.platform === "darwin" || process.platform === "linux") app.setBadgeCount(count);
}

// GNOME groups the window with its installed desktop entry only when both
// identities match. This must run before Electron becomes ready. Ubuntu also
// uses Chromium's software renderer: the supported machine reproduced two
// NVIDIA/libGLES GPU-process crashes that left an invisible focused window
// intercepting input. This app is not graphics-heavy, so reliability wins.
if (process.platform === "linux") {
  app.disableHardwareAcceleration();
  app.setDesktopName("com.openmausbot.app.desktop");
}

// One instance per user: without this lock a second launch forks a second
// harness server on a fallback port and splits data dirs in two. The loser
// exits before any child or window exists; the winner surfaces itself.
if (!app.requestSingleInstanceLock()) {
  console.log("[desktop] Sagax is already running — focusing that window");
  process.exit(0);
}

// An update install can start the new build while this process is still
// inside the deferred before-quit cleanup further down, still holding the
// lock; the relaunched copy then loses the check above and exits, leaving a
// dead Starting window with no server. Electron's native autoUpdater emits
// before-quit-for-update only when an update drives the quit (the vendored
// electron-updater re-emits it on the same object before app.quit()), so the
// lock is released on that event — never in before-quit, where a normal quit
// would allow a concurrent second instance.
nativeAutoUpdater.on("before-quit-for-update", () => releaseSingleInstanceLock(app));

function deliverPackageInstall(win) {
  if (!pendingPackageInstallUrl || !win || win.isDestroyed()) return;
  if (win.webContents.isLoadingMainFrame()) return;
  // A package installs into THIS computer's workspace, so it is handed to the
  // local UI only. Showing a remote server: switch back to Local first; the
  // pending link is delivered when that page finishes loading.
  let showingLocal = false;
  try {
    showingLocal = new URL(win.webContents.getURL()).origin === rendererOrigin();
  } catch {}
  if (!showingLocal) {
    if (activeEnvironment(environmentsState)) void workspaceMenuAction(() => switchEnvironment(LOCAL_ID));
    return;
  }
  win.webContents.send("package:install", pendingPackageInstallUrl);
  pendingPackageInstallUrl = null;
}

function queuePackageInstall(rawLink) {
  const packageUrl = packageUrlFromDeepLink(rawLink);
  if (!packageUrl) return false;
  pendingPackageInstallUrl = packageUrl;
  if (!desktopTray?.show()) activateExistingWindow(BrowserWindow.getAllWindows());
  const target = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
  deliverPackageInstall(target);
  return true;
}

// "Sign in with Pulsatrix" always runs in the system browser, never in a
// window of this app: passkeys and password managers live there
// (electron/oidc-system-sign-in.cjs). The browser comes back on a one-shot
// 127.0.0.1 listener, or on openmausbot://auth when only that is possible.
// The openmausbot:// sign-in this app is waiting for, if any:
const pendingSystemSignIn = oidcSignInModule.createPendingSystemSignIn();
// The credential just loaded into the main window's /pair from that return:
// /pair redeems it without asking only when this confirms it.
const signInHandoff = oidcSignInModule.createSignInHandoff();
/** The sign-in in progress: { origin, url, loopback } or null. */
let currentSignIn = null;
/** What the main window's /pair shows: idle, waiting (Cancel, Reopen the
 * browser) or an error code (timeout, unsupported, browser, unreachable). */
let signInState = { status: "idle" };
/** Bumped by every start and cancel, so a slower earlier start gives up. */
let signInAttempt = 0;

/** Every step of "Sign in with Pulsatrix", never the credential: the app
 * log (server.log), and stdout in a dev run. */
function signInLog(line) {
  slog(`sign-in: ${line}`);
  if (!app.isPackaged) console.log(`[sign-in] ${line}`);
}

/** Log how the main window's redeem of a handed-over credential answers
 * (POST <origin>/api/auth/pair), once, for two minutes. Status only. */
let redeemWatchTimer = null;
function watchSignInRedeem(win, origin) {
  const requests = win.webContents.session.webRequest;
  const stop = () => {
    if (redeemWatchTimer) clearTimeout(redeemWatchTimer);
    redeemWatchTimer = null;
    try { requests.onCompleted(null); requests.onErrorOccurred(null); } catch { /* window gone */ }
  };
  stop();
  const filter = { urls: [`${origin}/api/auth/pair`, `${origin}/api/auth/pair?*`] };
  requests.onCompleted(filter, (details) => {
    if (details.method !== "POST") return;
    signInLog(`redeem POST ${origin}/api/auth/pair answered ${details.statusCode}${details.responseHeaders && Object.keys(details.responseHeaders).some((h) => h.toLowerCase() === "set-cookie") ? " with a session cookie" : ""}`);
    stop();
    // Signed in: the local server learns who its owner is there.
    if (details.statusCode >= 200 && details.statusCode < 300) void ownerIdentitySync.refresh("sign-in");
  });
  requests.onErrorOccurred(filter, (details) => {
    signInLog(`redeem POST ${origin}/api/auth/pair failed (${details.error})`);
    stop();
  });
  redeemWatchTimer = setTimeout(() => {
    signInLog("no redeem request from /pair within two minutes");
    stop();
  }, 120_000);
  redeemWatchTimer.unref?.();
}

function setSignInState(next) {
  signInState = next;
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (win && !win.webContents.isDestroyed()) win.webContents.send("pulsatrix-sign-in:changed", signInState);
}

/** What the saved server says about desktop returns, or null when it cannot be read. */
async function serverSignInSupport(origin) {
  try {
    const res = await fetchEnvironmentDescriptor(origin, { signal: AbortSignal.timeout(3_000), redirect: "error" });
    if (!res.ok) return null;
    return oidcSignInModule.signInSupport(await res.json());
  } catch {
    return null;
  }
}

/** Whether `scheme`:// links (sagax or openmausbot) reach this exact running copy of the app. */
async function thisAppOwnsAuthScheme(scheme) {
  const isDefault = app.isDefaultProtocolClient(scheme);
  let handlerPath = null;
  if (isDefault && (process.platform === "darwin" || process.platform === "win32")) {
    try {
      handlerPath = (await app.getApplicationInfoForProtocol(`${scheme}://auth`))?.path ?? null;
    } catch {
      handlerPath = null;
    }
  }
  return oidcSignInModule.ownsScheme({
    isDefault,
    handlerPath,
    appPath: oidcSignInModule.appHandlerPath(process.execPath, process.platform),
    platform: process.platform,
  });
}

function bringMainWindowForward(win) {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (process.platform === "darwin") app.focus({ steal: true });
}

/** A credential or an error came back for `origin`: open /pair on it. */
function deliverSignInReturn(parsed) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!win || activeEnvironment(environmentsState)?.origin !== parsed.origin) {
    signInLog(`ignored a return from ${parsed.origin}: ${win ? "that server is no longer the selected one" : "no main window"}`);
    return;
  }
  signInHandoff.accept(parsed);
  const target = oidcSignInModule.authReturnTarget(parsed);
  let showing = "nothing";
  try { showing = new URL(win.webContents.getURL()).origin + new URL(win.webContents.getURL()).pathname; } catch { /* blank */ }
  signInLog(`${"code" in parsed ? "credential" : `error (${parsed.error})`} handed to the main window (was on ${showing}), loading ${oidcSignInModule.redactedTarget(target)}`);
  if ("code" in parsed) watchSignInRedeem(win, parsed.origin);
  win.loadURL(target).catch((error) => signInLog(`the main window could not load /pair (${error?.code ?? error?.message ?? "error"})`));
  bringMainWindowForward(win);
}

/** Stop waiting: close the loopback listener and forget the scheme return. */
function cancelPulsatrixSignIn() {
  const current = currentSignIn;
  if (current) signInLog(`cancelled the waiting sign-in on ${current.origin}`);
  currentSignIn = null;
  signInAttempt += 1;
  pendingSystemSignIn.clear();
  current?.loopback?.cancel();
  setSignInState({ status: "idle" });
}

/** Start "Sign in with Pulsatrix" for the selected saved server, in the
 * system browser. `loginStart` is that server's /auth/oidc/start. */
async function startPulsatrixSignIn(_win, loginStart) {
  const start = oidcSignInModule.oidcLoginStartUrl(loginStart, environmentsState);
  if (!start) return;
  const origin = new URL(start).origin;
  cancelPulsatrixSignIn();
  const attempt = signInAttempt;
  signInLog(`starting on ${origin}`);
  const support = await serverSignInSupport(origin);
  if (attempt !== signInAttempt) return;
  signInLog(support ? `${origin} supports loopback return: ${support.loopbackReturn}, openmausbot return: ${support.nativeReturn}` : `${origin} environment unreachable`);
  if (!support) {
    setSignInState({ status: "error", origin, error: "unreachable" });
    return;
  }
  let loopback = null;
  if (support.loopbackReturn) {
    try {
      loopback = await oidcSignInModule.startLoopbackReturn({ log: signInLog });
    } catch (error) {
      signInLog(`could not listen on 127.0.0.1 (${error?.code ?? "error"})`);
    }
  }
  // sagax:// first, when the server can end there; else openmausbot://.
  const ownsSagax = support.sagaxReturn && !loopback ? await thisAppOwnsAuthScheme("sagax") : false;
  const owns = ownsSagax || (support.nativeReturn && !loopback ? await thisAppOwnsAuthScheme("openmausbot") : false);
  if (attempt !== signInAttempt) {
    loopback?.cancel();
    return;
  }
  const path = oidcSignInModule.chooseReturnPath({
    loopbackReturn: support.loopbackReturn,
    loopbackReady: Boolean(loopback),
    nativeReturn: support.nativeReturn,
    ownsScheme: owns,
  });
  if (path === "unsupported") {
    loopback?.cancel();
    signInLog(`${origin} cannot come back to this app (server loopback return: ${support.loopbackReturn}, this app owns sagax or openmausbot: ${owns})`);
    setSignInState({ status: "error", origin, error: "unsupported" });
    return;
  }
  if (path !== "loopback") {
    loopback?.cancel();
    loopback = null;
    pendingSystemSignIn.begin(origin);
  }
  const url = oidcSignInModule.desktopStartUrl(origin, loopback?.returnTo ?? (ownsSagax ? oidcSignInModule.sagaxReturnLink(origin) : undefined));
  const current = { origin, url, loopback };
  currentSignIn = current;
  setSignInState({ status: "waiting", origin });
  signInLog(`return path ${path}; opening the system browser`);
  loopback?.result.then((outcome) => {
    signInLog(`listener settled: ${"code" in outcome ? "credential" : Object.keys(outcome)[0]}${currentSignIn !== current ? " (no longer the current sign-in, dropped)" : ""}`);
    if (currentSignIn !== current) return;
    currentSignIn = null;
    if ("code" in outcome || "error" in outcome) {
      setSignInState({ status: "idle" });
      deliverSignInReturn({ origin, ...outcome });
    } else if ("timeout" in outcome) {
      setSignInState({ status: "error", origin, error: "timeout" });
    }
  });
  try {
    await shell.openExternal(url);
    signInLog("system browser opened");
  } catch {
    signInLog("the system browser could not open the sign-in");
    if (currentSignIn === current) {
      cancelPulsatrixSignIn();
      setSignInState({ status: "error", origin, error: "browser" });
    }
  }
}

/** Handle an openmausbot://auth link. Returns whether it was one. The
 * credential is never logged. */
function takeAuthReturnLink(rawUrl) {
  if (typeof rawUrl !== "string" || !/^(?:sagax|openmausbot):\/\/auth(?:[/?#]|$)/i.test(rawUrl)) return false;
  const parsed = environmentsModule.parseAuthReturnLink(rawUrl, environmentsState);
  if (!parsed) {
    signInLog("ignored an openmausbot://auth link that does not name a saved server");
    return true;
  }
  if (!pendingSystemSignIn.take(parsed.origin)) {
    signInLog(`ignored an openmausbot://auth return from ${parsed.origin} that this app did not start or that expired`);
    return true;
  }
  if (currentSignIn?.origin === parsed.origin) currentSignIn = null;
  setSignInState({ status: "idle" });
  deliverSignInReturn(parsed);
  return true;
}

app.on("open-url", (event, url) => {
  if (takeAuthReturnLink(url)) {
    event.preventDefault();
    return;
  }
  if (!queueOrganizationEntry(url) && !queuePackageInstall(url)) return;
  event.preventDefault();
});

app.on("second-instance", (_event, commandLine) => {
  const authReturn = Array.isArray(commandLine) ? commandLine.find((arg) => typeof arg === "string" && /^(?:sagax|openmausbot):\/\/auth(?:[/?#]|$)/i.test(arg)) : undefined;
  if (authReturn && takeAuthReturnLink(authReturn)) return;
  if (takeOrganizationDeepLink(commandLine)) {
    queueOrganizationEntry(ORGANIZATION_DEEP_LINK);
    return;
  }
  const packageUrl = packageUrlFromCommandLine(commandLine);
  if (packageUrl) pendingPackageInstallUrl = packageUrl;
  if (!desktopTray?.show()) activateExistingWindow(BrowserWindow.getAllWindows());
  const target = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
  deliverPackageInstall(target);
});

// Packaged: the harness server ships in Resources (compiled JS, zero deps)
// and runs on Electron's own Node via utilityProcess. It serves the built
// UI too, so the window talks to one origin and there is no dev proxy.
// A stray server on the default port must not brick the app — fall back to
// alternate ports until one binds AND identifies as ours (the probe checks
// our API shape, not just a 200).
let serverProc = null;
let serverReady = !app.isPackaged;
let secureCredentials = {};
let secureCredentialState = null;
let desktopDataDirLease = null;
let managedDesktop = null;
// The organization library channel: catalog and release bytes for the local runtime only.
let orgLibrary = null;
let companyBackupController = null;
let companyBackupState = { busy: false };
let preparedCompanyRestore = null;
let companyBackupSchedule = null;
let companyBackupClientStateRequest = null;
let companyRestoreCommitting = false;
let companyBackupConfigurationRevision = 0;
const managedDesktopRelay = createManagedDesktopRelay();
const utilityServerExits = new WeakMap();
const UTILITY_SERVER_STOP_TIMEOUT_MS = 6_500;
const trustedApprovalMode = createTrustedApprovalModeCoordinator({ randomId: randomUUID });
const desktopMutationToken = randomBytes(32).toString("base64url");
const companionMutationToken = randomBytes(32).toString("base64url");
// The owner's organization identity and avatar for the local server
// (electron/owner-identity.mjs): read with this app's organization cookie,
// handed over the private parent port, never stored here.
const ownerIdentitySync = createOwnerIdentitySync({
  environments: () => environmentsState,
  fetch: (url, init) => session.defaultSession.fetch(url, { ...init, bypassCustomProtocolHandlers: true }),
  post: (message) => {
    if (!serverProc) return false;
    try {
      serverProc.postMessage(message);
      return true;
    } catch (error) {
      slog(`owner identity sync failed: ${error?.message ?? error}`);
      return false;
    }
  },
  log: slog,
});
const serverSupervisor = createServerSupervisor({
  restart: () => startServerOn(SERVER_PORT),
  stop: stopUtilityServer,
  onReady(proc) {
    serverProc = proc;
    serverReady = true;
    serverStartConflictOnly = false;
    slog(`server ready pid=${proc.pid} port=${SERVER_PORT}`);
    // Re-read the latest account credentials; registration may have completed
    // while the replacement child's health probe was pending.
    syncManagedComposioCredentials();
    // Who owns this computer in their organization (name, address, avatar).
    void ownerIdentitySync.serverReady();
    ownerIdentitySync.start();
    // A restarted runtime has no library catalog until main sends it again.
    orgLibrary?.runtimeReady();
    if (managedDesktop) void managedDesktop.refresh().catch(() => {});
    routineWake.start();
    // Existing chat windows reconnect in place, preserving unsent drafts.
    // A window opened during the outage is still on our error page instead.
    for (const win of BrowserWindow.getAllWindows()) {
      if (!serverUnavailableWindows.has(win) || activeEnvironment(environmentsState)) continue;
      void win.loadURL(`http://127.0.0.1:${SERVER_PORT}`).then(() => {
        serverUnavailableWindows.delete(win);
      }).catch((error) => {
        slog(`recovered server window failed to load: ${error?.message ?? error}`);
      });
    }
  },
  onUnavailable() {
    serverReady = false;
    serverProc = null;
    companyBackupSchedule?.reconcile();
    // nothing to hold for while the scheduler is down; polling resumes on ready
    routineWake.stop();
  },
  onExhausted() {
    slog("server recovery paused after repeated failures; quit and reopen to retry");
    dialog.showErrorBox(
      "The bot server stopped",
      "Automatic recovery could not restart the background server. Quit and reopen Sagax to try again. Interrupted chat turns were not resent.\n\n" +
        `Server log: ${path.join(LOG_DIR, "server.log")}`,
    );
  },
  log: slog,
});

let resolvedDesktopDataDir = null;
function desktopDataDir() {
  // Match the historical desktop fallback for an unset or empty override,
  // then pass this exact resolved path to the utility child. server/config.ts
  // intentionally treats an empty SAGAX_DATA_DIR differently, so inheriting it
  // without normalization would lease one directory and write another.
  // Resolved once: the first call moves ~/.openmausbot to ~/.sagax when no
  // running copy holds it (legacy-names.mjs), and the answer must not change
  // under a running app.
  resolvedDesktopDataDir ??= process.env.SAGAX_DATA_DIR || defaultDataDir({ home: app.getPath("home") });
  return resolvedDesktopDataDir;
}

async function stopUtilityServer(proc, timeoutMs = UTILITY_SERVER_STOP_TIMEOUT_MS) {
  if (!proc) return true;
  const exited = utilityServerExits.get(proc);
  if (!exited) return false;
  try {
    proc.kill();
  } catch {
    // The tracked exit promise below is still the authority. A throw can mean
    // the process crossed the exit boundary immediately before kill().
  }
  let timer;
  return Promise.race([
    exited.then(() => true),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}
let phoneSecretIdentity = null;
let desktopRemoteAccess = null;
let desktopCompanionRelay = null;

const CREDENTIALS_FILE = path.join(app.getPath("userData"), "credentials.bin");

/** Set once per launch: true when the store could not be READ, which is not
 * the same as the user having saved nothing. Everything downstream — the
 * server's view of "configured", and whether we may register a fresh
 * installation — keys off this rather than off an empty object. */
let credentialStoreUnavailable = false;

async function loadSecureCredentials() {
  await keychainReady;
  const result = await readSecureCredentials({
    exists: () => fs.existsSync(CREDENTIALS_FILE),
    isAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    readFile: () => fs.readFileSync(CREDENTIALS_FILE),
    decrypt: (buffer) => safeStorage.decryptStringAsync(buffer),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  credentialStoreUnavailable = result.status === "unavailable";
  if (credentialStoreUnavailable) {
    // Deliberately loud. A silent {} here is what made a keychain hiccup
    // look like "your connected apps are gone".
    slog(`credential store unreadable after retries (${result.error}); saved keys are not loaded this launch`);
  }
  return result.credentials;
}

async function saveSecureCredentials(credentials) {
  // A failed read means we do not know what the existing encrypted document
  // contains. Never derive a replacement from that incomplete view: boot
  // migrations must leave plaintext in place so a later launch can retry.
  if (credentialStoreUnavailable) {
    throw new Error("The operating-system credential store could not be read this launch");
  }
  await keychainReady;
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("The operating-system credential store is unavailable");
  }
  fs.mkdirSync(path.dirname(CREDENTIALS_FILE), { recursive: true });
  const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(credentials));
  const temporary = `${CREDENTIALS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, encrypted, { mode: 0o600 });
  fs.renameSync(temporary, CREDENTIALS_FILE);
}

async function secureComposioConfig() {
  const dataDir = desktopDataDir();
  const configPath = path.join(dataDir, "config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    if (!config?.composio || typeof config.composio !== "object") return;
    let changed = false;
    const apiKey = config?.composio?.apiKey;
    if (typeof apiKey === "string" && apiKey.trim().startsWith("ak_")) {
      if (!secureCredentials.composioApiKey) {
        secureCredentials.composioApiKey = apiKey.trim();
        await saveSecureCredentials(secureCredentials);
      }
      config.composio.apiKey = "";
      changed = true;
    } else if (typeof apiKey === "string" && apiKey.trim()) {
      config.composio.apiKey = "";
      changed = true;
    }
    // These were the old Connect credential and endpoint. They are no longer
    // read; remove them during the upgrade so an unused secret is not left in
    // plaintext indefinitely.
    for (const field of ["key", "url"]) {
      if (Object.hasOwn(config.composio, field)) {
        delete config.composio[field];
        changed = true;
      }
    }
    if (!changed) return;
    const temporary = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, configPath);
  } catch (error) {
    if (error?.code !== "ENOENT") slog(`credential migration failed: ${error?.message ?? error}`);
  }
}

// The remaining workspace credentials (xai/box/voice/OpenCode keys) get
// the same at-rest treatment as the Composio key above. New packaged-app
// saves go straight through credential:set below; this boot-time sweep also
// migrates plaintext left by older versions or direct development clients.
// See workspace-credentials.mjs for the exact rules.
async function secureWorkspaceConfig() {
  const dataDir = desktopDataDir();
  const configPath = path.join(dataDir, "config.json");
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const migrated = migrateWorkspaceCredentials(config, secureCredentials);
    // credentials.bin first: if the OS store cannot take the secrets, the
    // plaintext stays put and the next boot retries — losing the only copy
    // is the one unacceptable outcome
    if (migrated.credentialsChanged) await saveSecureCredentials(migrated.credentials);
    secureCredentials = migrated.credentials;
    if (!migrated.configChanged) return;
    const temporary = `${configPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(migrated.config, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, configPath);
  } catch (error) {
    if (error?.code !== "ENOENT") slog(`credential migration failed: ${error?.message ?? error}`);
  }
}

// Managed connected apps run only through a broker the operator names
// explicitly. There is no built-in default: the fork never routes users'
// connections through a third party's service. Without the variable, the
// app uses the workspace's own Composio project key (self-hosted mode).
function composioBrokerUrl() {
  return normalizeManagedComposioBrokerUrl(process.env.SAGAX_COMPOSIO_BROKER_URL?.trim() || "");
}

// The packaged app has no terminal: everything about the server child's life
// goes to server.log in the OS log dir (~/Library/Logs/openmausbot on macOS,
// Console.app-visible; %APPDATA%\sagax\logs on Windows), which is also
// why stdio is piped, not inherited — under a Finder/Explorer launch the
// parent's stdio leads nowhere and a failed boot is otherwise undiagnosable.
const LOG_DIR = app.getPath("logs");
const DESKTOP_CRASH_LOG = path.join(LOG_DIR, "desktop-crashes.log");
const DESKTOP_CRASH_LOG_MAX_BYTES = 512 * 1024;
let desktopLog = null;
let desktopShutdownStarted = false;
import {
  companionAdvertisedHostedUrl,
  companionEnabledAtRest,
  companionOriginTarget,
  companionPairing,
  companionRefreshTailscale,
  companionCloudDesktopAccess,
  companionBrowserControlAccess,
  companionRevoke,
  companionRunning,
  companionState,
  rememberCompanionEnabled,
  rememberCompanionKeepAwake,
  setCompanionHostedUrl,
  setCompanionLifecycleListener,
  startCompanion,
  stopCompanion,
} from "./companion.mjs";
import { createRoutineWakeHold, rememberRoutineWake, routineWakeSettings } from "./routine-wake.mjs";
import { installFetchGuard, installSessionBlock } from "./upstream-hosts.mjs";

// No request from this app reaches the original OpenMausBot services, the
// upstream author's repositories or an analytics host: main's own fetch is
// guarded here, every Electron session (windows, webviews, the updater's net
// session) on creation and once ready (electron/upstream-hosts.mjs).
installFetchGuard(globalThis);
app.on("session-created", (created) => installSessionBlock(created, (line) => slog(`network: ${line}`)));

/** IPC that controls this computer, its files, its logins or its updater is
 * answered only for the local server's UI (electron/local-origin.cjs). A
 * remote server's page gets a reduced bridge (preload.cjs) in the first
 * place; this is the second wall, shared with cua.mjs, updater.mjs and
 * android-device.mjs. Declared before any handler registration below: a
 * const declared later would be in its temporal dead zone at module load.
 */
const { desktopUiOnly, isDesktopUiSender, isLocalSender: senderIsLocal, localOnly, localOnlySync, setBundledOrigin, setLocalOrigin } = localOriginModule;
// The updater changes THIS app: only this app's own UI reads and drives it,
// the local page or the bundle drawn on an organization server (bundled-ui.cjs).
const updaterPageAllowed = (event) => isDesktopUiSender(event);

let companionPowerBlocker = null;

function syncCompanionKeepAwake(companionEnabled, keepAwake) {
  const shouldBlock = companionEnabled && keepAwake;
  if (shouldBlock && companionPowerBlocker === null) {
    companionPowerBlocker = powerSaveBlocker.start("prevent-app-suspension");
  } else if (!shouldBlock && companionPowerBlocker !== null) {
    if (powerSaveBlocker.isStarted(companionPowerBlocker)) powerSaveBlocker.stop(companionPowerBlocker);
    companionPowerBlocker = null;
  }
}

// Keep this computer awake for scheduled routines (electron/routine-wake.mjs):
// the scheduler lives in the local server, which cannot run while the Mac
// sleeps. One power assertion, held for the hour before a due routine and
// while a run is in flight, plugged in only; the server says when.
const routineWake = createRoutineWakeHold({
  fetchStatus: () => (serverReady
    ? fetch(`http://127.0.0.1:${SERVER_PORT}/api/routines/wake`, { signal: AbortSignal.timeout(5_000), redirect: "error", credentials: "omit" })
      .then((response) => (response.ok ? response.json() : null))
    : Promise.resolve(null)),
  isOnBattery: () => {
    try {
      return powerMonitor.isOnBatteryPower();
    } catch {
      return false;
    }
  },
  blocker: powerSaveBlocker,
  settings: () => routineWakeSettings(app.getPath("userData")),
  log: (line) => slog(line),
});

// Each step of the packaged boot is written to server.log, so a startup that
// stalls on someone's machine says where in the log they send us, and the
// loading screen shows the step it is on.
const startupClock = Date.now();
function startupPhase(phase, status) {
  slog(`startup: ${phase} (+${Date.now() - startupClock}ms)`);
  if (status) startupScreen?.setStatus(status);
}

function slog(line) {
  try {
    desktopLog ??= createRotatingLog(path.join(LOG_DIR, "server.log"));
    desktopLog.write(`[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* logging must never break startup */
  }
}

// The server stream is intentionally asynchronous, but a fatal main-process
// exception may terminate Electron before such a write is flushed. Crash
// metadata gets its own tiny synchronous file. The formatter admits only a
// fixed set of fields, so renderer URLs, page titles, exception messages and
// absolute paths never land on disk or in a public bug report.
function recordDesktopCrash(event) {
  let handle = null;
  try {
    const record = formatDesktopCrashRecord(event);
    if (!record) return;
    fs.mkdirSync(LOG_DIR, { recursive: true });

    const flags =
      fs.constants.O_WRONLY |
      fs.constants.O_APPEND |
      (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW);
    let before = null;
    try {
      before = fs.lstatSync(DESKTOP_CRASH_LOG);
      if (!before.isFile() || before.nlink !== 1) return;
      handle = fs.openSync(DESKTOP_CRASH_LOG, flags);
    } catch (error) {
      if (error?.code !== "ENOENT") return;
      // O_EXCL makes first creation race-safe on Windows, where O_NOFOLLOW is
      // unavailable, as well as on POSIX.
      try {
        handle = fs.openSync(
          DESKTOP_CRASH_LOG,
          flags | fs.constants.O_CREAT | fs.constants.O_EXCL,
          0o600,
        );
      } catch {
        return;
      }
    }

    const stats = fs.fstatSync(handle);
    // A hard-linked or non-regular target is not an app-owned crash log.
    if (!stats.isFile() || stats.nlink !== 1) return;
    if (before && (before.dev !== stats.dev || before.ino !== stats.ino)) return;
    // A renderer crash loop must not grow a persistent log without bound.
    // The diagnostics export reads only a bounded tail, so dropping older
    // crash metadata here preserves the useful part of the record.
    if (stats.size >= DESKTOP_CRASH_LOG_MAX_BYTES) fs.ftruncateSync(handle, 0);
    if (process.platform !== "win32") fs.fchmodSync(handle, 0o600);
    fs.writeFileSync(handle, `[${new Date().toISOString()}] ${record}\n`, "utf8");
  } catch {
    /* crash diagnostics must never change app lifecycle */
  } finally {
    if (handle !== null) {
      try {
        fs.closeSync(handle);
      } catch {}
    }
  }
}

// uncaughtExceptionMonitor observes Node's fatal path without converting it
// into a handled exception. In particular, an unhandled rejection still
// follows Node's normal exit behaviour after its metadata is persisted.
installDesktopCrashListeners({
  appTarget: app,
  processTarget: process,
  record: recordDesktopCrash,
  isShuttingDown: () => desktopShutdownStarted,
  mainWebContents: () => mainWindow?.webContents ?? null,
});

// ── managed companion connection ───────────────────────────────────────
// Account onboarding provisions one remote Cloudflare Tunnel per desktop,
// then calls reconcileManagedCompanionEndpointProvision below. Only the
// endpoint is public state. The connector token stays in credentials.bin and
// is passed to cloudflared through a private token file by the lifecycle
// module — never through IPC, argv, the environment, or logs.
let managedCompanionConnector = null;
let companionAccountService = null;
let companionDesiredThisLaunch = false;
let companionLaunchGeneration = 0;
let advertisementTransition = Promise.resolve();

/** The one serialized credential mutation hook. Account onboarding and every
 * other runtime credential writer share this state, so persisting a tunnel
 * token can never overwrite an API key saved at the same time (or vice
 * versa). */
export async function updateSecureCredentialDocument(derive, afterPersist) {
  if (!secureCredentialState) throw new Error("Secure credentials are not ready");
  try {
    return await secureCredentialState.update(derive, afterPersist);
  } finally {
    secureCredentials = secureCredentialState.read();
  }
}

async function ensurePhoneSecretIdentity() {
  const existing = readPhoneSecretIdentity(secureCredentialState?.read() ?? secureCredentials);
  if (existing) {
    phoneSecretIdentity = existing;
    return existing;
  }
  try {
    const created = await createPhoneSecretIdentity();
    await updateSecureCredentialDocument((credentials) =>
      withPhoneSecretIdentity(credentials, created),
    );
    phoneSecretIdentity = created;
    return created;
  } catch (error) {
    // Companion chat remains available. Pairing simply omits the public key,
    // and mobile cards explain that secure entry needs the desktop until the
    // OS credential store is available on a later launch.
    phoneSecretIdentity = null;
    slog(`phone credential key unavailable: ${error?.message ?? error}`);
    return null;
  }
}

/** One random key per installation for the server's encrypted MCP sign-in
 * vault (server/mcp-oauth.ts), kept in the OS-encrypted credential store. */
async function ensureMcpOAuthKey() {
  const current = secureCredentialState?.read() ?? secureCredentials;
  if (typeof current?.mcpOAuthKey === "string" && /^[0-9a-f]{64}$/.test(current.mcpOAuthKey)) return;
  try {
    const key = randomBytes(32).toString("hex");
    await updateSecureCredentialDocument((credentials) =>
      typeof credentials.mcpOAuthKey === "string" && /^[0-9a-f]{64}$/.test(credentials.mcpOAuthKey)
        ? credentials
        : { ...credentials, mcpOAuthKey: key },
    );
  } catch (error) {
    // MCP sign-in reports the store as unavailable until a later launch.
    slog(`MCP sign-in key unavailable: ${error?.message ?? error}`);
  }
}

function publicManagedCompanionState() {
  const access = managedCompanionTunnelAccess(secureCredentials);
  const status = managedCompanionConnector?.getStatus();
  if (status) {
    const publicState = {
      status: status.status,
      configured: status.configured,
      ready: status.ready,
    };
    if (status.endpoint) publicState.url = status.endpoint;
    if (status.retryInMs) publicState.retryInMs = status.retryInMs;
    if (status.error) publicState.error = status.error;
    return publicState;
  }
  return access
    ? { status: "stopped", configured: true, ready: false, url: access.endpoint }
    : { status: "unconfigured", configured: false, ready: false };
}

function decorateDesktopCompanionState(state) {
  // The panel polls this state, so a sidecar that exited on its own releases
  // the blocker within one poll instead of keeping the computer awake forever.
  syncCompanionKeepAwake(state.enabled && !state.error, state.keepAwake === true);
  return { ...state, managedConnection: publicManagedCompanionState() };
}

async function desktopCompanionState() {
  return decorateDesktopCompanionState(await companionState());
}

function companionLaunchOptions(hostedUrl = null) {
  return {
    resourcesPath: process.resourcesPath,
    harnessPort: SERVER_PORT,
    mutationToken: companionMutationToken,
    hostedUrl,
    // Only an embedded server receives the private half over its utility
    // port. A dev server launched in another terminal cannot decrypt, so it
    // must not advertise a public key and strand the phone on a dead path.
    secretPublicKey: app.isPackaged && serverProc ? phoneSecretIdentity?.publicKey ?? null : null,
    log: slog,
  };
}

function ensureManagedCompanionConnector() {
  if (managedCompanionConnector) return managedCompanionConnector;
  managedCompanionConnector = createManagedCompanionTunnel({
    binaryPath: resolveCloudflaredBinary({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appPath: app.getAppPath(),
    }),
    guardianEntry: resolveManagedCompanionGuardian({ appPath: app.getAppPath() }),
    runtimeExecutable: process.execPath,
    runtimeRoot: path.join(app.getPath("userData"), "managed-companion-tunnel"),
    onChange: (status) => {
      slog(`managed companion connection ${status.status}`);
      if (!companionDesiredThisLaunch) return;
      void reconcileCompanionAdvertisement(status.ready ? status.endpoint : null);
    },
    log: slog,
  });
  return managedCompanionConnector;
}

/** Publish a hosted address only after its connector has passed public health
 * verification. Updating the owned sidecar in place preserves the exact
 * private origin generation and cannot invalidate an open pairing window. */
function reconcileCompanionAdvertisement(
  endpoint,
  ownedGeneration = companionLaunchGeneration,
) {
  const normalizedEndpoint = endpoint || null;
  const work = advertisementTransition.then(async () => {
    if (
      ownedGeneration !== companionLaunchGeneration ||
      !companionDesiredThisLaunch ||
      !companionRunning() ||
      companionAdvertisedHostedUrl() === normalizedEndpoint
    ) {
      return desktopCompanionState();
    }
    const updated = await setCompanionHostedUrl(normalizedEndpoint);
    return { ...updated, managedConnection: publicManagedCompanionState() };
  });
  advertisementTransition = work.then(
    () => {},
    () => {},
  );
  return work;
}

async function startManagedCompanionConnection({ waitForVerification = true } = {}) {
  if (companionAccountCleanupPending(secureCredentials)) {
    return publicManagedCompanionState();
  }
  const access = managedCompanionTunnelAccess(secureCredentials);
  if (!access) return publicManagedCompanionState();
  const target = companionOriginTarget();
  if (!target) return publicManagedCompanionState();
  const operation = ensureManagedCompanionConnector().start({ ...access, originTarget: target });
  if (!waitForVerification) {
    void operation.catch(() => {});
    return publicManagedCompanionState();
  }
  const status = await operation;
  await reconcileCompanionAdvertisement(status.ready ? status.endpoint : null);
  return publicManagedCompanionState();
}

async function startDesktopCompanion({ waitForHosted = true, remember = true } = {}) {
  // Every way of turning the companion on (the switch, Tailscale's "Turn on
  // and check", launch auto-start) passes here.
  const refusal = managedRemoteAccessRefusal();
  if (refusal) throw new Error(refusal);
  companionDesiredThisLaunch = true;
  companionLaunchGeneration += 1;
  // Direct LAN comes up first. The hosted endpoint is added in place only
  // after the guardian has verified the public route to this exact sidecar.
  const localState = await startCompanion(companionLaunchOptions());
  if (!localState.enabled || localState.error) {
    companionDesiredThisLaunch = false;
    return desktopCompanionState();
  }
  if (remember) rememberCompanionEnabled(true);
  await startManagedCompanionConnection({ waitForVerification: waitForHosted });
  return desktopCompanionState();
}

async function stopDesktopCompanion({ remember = true } = {}) {
  companionDesiredThisLaunch = false;
  companionLaunchGeneration += 1;
  if (remember) rememberCompanionEnabled(false);
  syncCompanionKeepAwake(false, false);
  await managedCompanionConnector?.stop();
  await stopCompanion();
  return desktopCompanionState();
}

async function refreshDesktopCompanionTailscale() {
  if (!companionRunning()) {
    const started = await startDesktopCompanion({ waitForHosted: false });
    if (!started.enabled || started.error) return started;
  }
  return decorateDesktopCompanionState(await companionRefreshTailscale());
}

setCompanionLifecycleListener(({ expected, pid }) => {
  if (expected) return;
  slog(`owned companion exited unexpectedly pid=${pid ?? "unknown"}`);
  companionDesiredThisLaunch = false;
  companionLaunchGeneration += 1;
  syncCompanionKeepAwake(false, false);
  // stop() invalidates the guardian's owner pipe synchronously, before the
  // sidecar module removes this generation's private socket.
  void managedCompanionConnector?.stop().catch(() => {});
});

/** Narrow main-process hook for the account onboarding flow. Its return value
 * is explicitly secret-free and can be used to refresh the settings panel. */
export async function reconcileManagedCompanionEndpointProvision(provision) {
  await updateSecureCredentialDocument((credentials) =>
    withManagedCompanionTunnelAccess(credentials, provision),
  );
  if (companionDesiredThisLaunch) {
    await startManagedCompanionConnection({ waitForVerification: true });
  }
  return publicManagedCompanionState();
}

/** Called only after the control plane has revoked/deleted the endpoint. */
export async function clearManagedCompanionEndpointCredentials() {
  await updateSecureCredentialDocument((credentials) =>
    withoutManagedCompanionTunnelAccess(credentials),
  );
  await managedCompanionConnector?.stop();
  if (companionDesiredThisLaunch) await reconcileCompanionAdvertisement(null);
  return publicManagedCompanionState();
}

/** Account sign-out must stop advertising the hosted route before it asks
 * the control plane to revoke anything, but it must not erase the retry
 * credentials until that remote cleanup is durably scheduled. */
async function stopManagedCompanionEndpointLocally() {
  await managedCompanionConnector?.stop();
  if (companionDesiredThisLaunch) await reconcileCompanionAdvertisement(null);
  return publicManagedCompanionState();
}

async function activatePersistedManagedCompanionEndpoint() {
  if (companionDesiredThisLaunch) {
    return startManagedCompanionConnection({ waitForVerification: true });
  }
  return publicManagedCompanionState();
}

function installationDisplayName() {
  const hostname = [...os.hostname()]
    .filter((character) => character.codePointAt(0) >= 32 && character.codePointAt(0) !== 127)
    .join("")
    .trim();
  return hostname.slice(0, 80) || "This computer";
}

function ensureCompanionAccountService() {
  if (companionAccountService) return companionAccountService;
  const baseURL = resolveCompanionControlPlaneURL({
    isPackaged: app.isPackaged,
    environment: process.env,
  });
  let client = null;
  if (baseURL) {
    try {
      client = createControlPlaneClient({ baseURL });
    } catch {
      // An invalid explicit override disables hosted access. Direct LAN,
      // Bonjour, and Tailscale pairing remain completely independent.
    }
  }
  companionAccountService = createCompanionAccountService({
    client,
    readCredentials: () => secureCredentialState?.read() ?? secureCredentials,
    updateCredentials: updateSecureCredentialDocument,
    identity: {
      name: installationDisplayName(),
      platform:
        process.platform === "win32"
          ? "windows"
          : process.platform === "darwin"
            ? "darwin"
            : "linux",
      appVersion: app.getVersion().slice(0, 64),
    },
    newClientInstanceId: randomUUID,
    activatePersistedEndpoint: activatePersistedManagedCompanionEndpoint,
    stopManagedEndpoint: stopManagedCompanionEndpointLocally,
    managedConnectionState: publicManagedCompanionState,
    companionIsOn: () => companionDesiredThisLaunch,
    // Retry capacity/transient setup failures with backoff, and re-provision a
    // reclaimed endpoint behind the same address without a new sign-in.
    autoRecover: true,
    // The failure code and support reference reach server.log, and with it
    // the bug-report bundle.
    log: (line) => slog(line),
  });
  return companionAccountService;
}

// Everything the bug-report bundle needs. The config summary comes from the
// server's own booleans-only /api/config status (credentials are never
// echoed), and the log goes through the redactor in diagnostics.mjs — so the
// file is safe to paste into a public issue even if a future log line ever
// carried a secret.
async function gatherDiagnostics() {
  const serverStatus = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/config`, {
    signal: AbortSignal.timeout(3_000),
  })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  const logPath = path.join(LOG_DIR, "server.log");
  const log = readSafeLogTail(logPath);
  const desktopLog = readSafeLogTail(DESKTOP_CRASH_LOG);
  const updaterLog = readSafeLogTail(path.join(LOG_DIR, "updater.log"));
  return buildDiagnosticsReport({
    appInfo: {
      version: app.getVersion(),
      platform: process.platform,
      arch: process.arch,
      electron: process.versions.electron,
      node: process.versions.node,
      packaged: app.isPackaged,
      uptimeSeconds: Math.round(process.uptime()),
    },
    configSummary: serverStatus ?? {},
    desktopLogTail: desktopLog?.tail ?? "",
    updaterLogTail: updaterLog?.tail ?? "",
    logTail: log?.tail ?? "",
  });
}

// Set by startServerPackaged: true only when every failing candidate port was
// taken by another process — decides which error-page message renders.
let serverStartConflictOnly = false;







/** Run one private cleanup request at most once and acknowledge only after
 * Chromium confirms its session data is gone. Duplicate retries join the
 * same promise; a retry whose success ACK was lost receives a cached ACK. */

function syncPhoneSecretKey(proc) {
  const message = phoneSecretPrivateKeyMessage(phoneSecretIdentity);
  if (!message) return;
  try {
    proc.postMessage(message);
  } catch (error) {
    slog(`phone credential key sync failed: ${error?.message ?? error}`);
  }
}

function ensureManagedDesktop() {
  if (managedDesktop) return managedDesktop;
  if (!app.isPackaged || desktopRemoteAccess) throw new Error("Organization sign-in requires the installed desktop app running on this computer.");
  const encryption = {
    available: async () => (await keychainReady, await safeStorage.isAsyncEncryptionAvailable()) &&
      (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
    encrypt: value => safeStorage.encryptStringAsync(value),
    decrypt: value => safeStorage.decryptStringAsync(value),
  };
  const store = createManagedDesktopStore({ file: path.join(app.getPath("userData"), "company-connection.bin"), encryption });
  // Only what the Admin's library capability delivers, verified in main and
  // relayed to the local runtime; never to a remote server's pages.
  orgLibrary = createOrgLibrary({
    dataDir: path.join(desktopDataDir(), "org-library"),
    store: createManagedDesktopStore({ file: path.join(app.getPath("userData"), "company-library.bin"), encryption }),
    fetchBytes: (route, maxBytes, options) => managedDesktop.fetchLibraryBytes(route, maxBytes, options),
    relay: library => managedDesktopRelay.sendLibrary(serverProc, library),
    appVersion: app.getVersion(),
    log: message => slog(message),
  });
  managedDesktop = createManagedDesktopClient({
    store, platform: process.platform, deviceName: os.hostname().slice(0, 100) || "My computer",
    applyConnection: connection => managedDesktopRelay.send(serverProc, connection),
    // The organisation's read-only policy overlay; the runtime keeps it in memory.
    applyPolicy: policy => managedDesktopRelay.sendPolicy(serverProc, policy),
    migrateIdentity: identity => managedDesktopRelay.sendIdentity(serverProc, identity),
    library: orgLibrary,
    appVersion: app.getVersion(),
    openBrowser: url => shell.openExternal(url),
    onState: state => {
      // Losing company access (sign-out, expiry, revocation, a lapsed licence)
      // pauses daily backups; the schedule clears itself only when a different
      // organisation or account connects. An Admin without backup storage ends it.
      // license-expired repeats every heartbeat; an upload in flight stops, nothing else changes.
      if (state.status === "license-expired") companyBackupController?.abort();
      const lost = ["signed-out", "reauth-required"].includes(state.status), withoutStorage = state.status === "connected" && !state.cloudBackups;
      if (lost || withoutStorage) {
        companyBackupConfigurationRevision++;
        companyBackupController?.abort();
        preparedCompanyRestore = null;
        if (withoutStorage) void companyBackupSchedule?.forget().catch(() => {});
        publishCompanyBackupState({ busy: Boolean(companyBackupController) });
      }
      companyBackupSchedule?.reconcile();
      // Remote pages never receive local identity events, even if they were
      // loaded in this window after an earlier local subscription.
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.mainFrame.url.startsWith(`${rendererOrigin()}/`) &&
          !activeEnvironment(environmentsState) && !desktopRemoteAccess) {
        mainWindow.webContents.send("organization:state-changed", state);
      }
    },
  });
  companyBackupSchedule = createCompanyBackupSchedule({
    store: createManagedDesktopStore({ file: path.join(app.getPath("userData"), "company-backup-schedule.bin"), encryption }),
    scope: companyBackupScope,
    run: async (signal, scope) => {
      if (companyBackupController || preparedCompanyRestore || companyRestoreCommitting || desktopShutdownStarted) throw companyBackupDeferred();
      const proc = serverProc;
      const status = await localBackupStatus(proc);
      if (status.busy || status.pendingRestore) throw companyBackupDeferred();
      const clientState = await collectCompanyBackupClientState(signal, scope, proc);
      signal.throwIfAborted();
      const current = companyBackupScope();
      if (!current || current.key !== scope.key || current.generation !== scope.generation || proc !== serverProc || preparedCompanyRestore || companyRestoreCommitting) throw companyBackupDeferred();
      return runCompanyBackup("backup", { clientState }, { signal, scope });
    },
    onState: schedule => publishCompanyBackupState({ ...companyBackupState, schedule }),
  });
  return managedDesktop;
}

function companyBackupScope() {
  if (desktopShutdownStarted || desktopRemoteAccess || !serverReady || !serverProc || activeEnvironment(environmentsState)) return null;
  const client = managedDesktop, connection = client?.connection(), state = client?.state();
  if (!connection || state?.status !== "connected" || !state.cloudBackups || connection.expiresAt <= Date.now()) return null;
  // One person, one organisation, one data folder: re-enrolling this computer
  // (a new deviceId) keeps the same daily schedule, and a schedule saved by an
  // earlier version (whose key included a deviceId) is adopted, not forgotten.
  const dataDir = path.resolve(desktopDataDir());
  return { key: JSON.stringify([connection.portalOrigin, connection.organizationId, connection.email, dataDir]),
    // Any enrollment of this same person, organisation and folder, whatever its
    // deviceId: a credential that expired before the upgrade still carries over.
    adopts: saved => {
      try {
        const value = JSON.parse(saved);
        return Array.isArray(value) && value.length === 5 && typeof value[3] === "string" && value[0] === connection.portalOrigin &&
          value[1] === connection.organizationId && value[2] === connection.email && value[4] === dataDir;
      } catch { return false; }
    },
    generation: client.backupGeneration() };
}

function companyBackupDeferred() {
  return Object.assign(new Error("Wait for this installation to be available for its daily backup."), { code: "workspace_busy" });
}

function collectCompanyBackupClientState(signal, scope, proc) {
  const win = mainWindow, contents = win?.webContents, frame = contents?.mainFrame;
  if (companyBackupClientStateRequest || !win || win.isDestroyed() || desktopRemoteAccess || activeEnvironment(environmentsState) ||
      !frame?.url.startsWith(`${rendererOrigin()}/`)) return Promise.reject(companyBackupDeferred());
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const finish = (error, value) => {
      if (companyBackupClientStateRequest?.requestId !== requestId) return;
      companyBackupClientStateRequest = null;
      clearTimeout(timer); signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(companyBackupDeferred());
    const timer = setTimeout(abort, 10_000); timer.unref?.();
    companyBackupClientStateRequest = { requestId, win, contents, frame, url: frame.url, scope, proc, finish };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    try { contents.send("company-backups:collect-client-state", { requestId }); }
    catch { abort(); }
  });
}

function receiveCompanyBackupClientState(event, input) {
  const pending = companyBackupClientStateRequest;
  if (!pending || input?.requestId !== pending.requestId || event.sender !== pending.contents || event.senderFrame !== pending.frame) return;
  const scope = companyBackupScope();
  if (pending.win !== mainWindow || mainWindow.isDestroyed() || pending.url !== pending.frame.url ||
      !workspaceSenderAllowed(event, mainWindow.webContents, environmentsState, rendererOrigin()) ||
      procUnavailable() || !scope || scope.key !== pending.scope.key || scope.generation !== pending.scope.generation) {
    pending.finish(companyBackupDeferred()); return;
  }
  function procUnavailable() { return pending.proc !== serverProc || !serverReady || desktopRemoteAccess || desktopShutdownStarted; }
  const value = input.clientState;
  if (input.unavailable || !value || typeof value !== "object" || Array.isArray(value) ||
      Object.values(value).some(entry => typeof entry !== "string") || Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 ** 2) {
    pending.finish(companyBackupDeferred()); return;
  }
  pending.finish(null, Object.fromEntries(Object.entries(value)));
}

function publishCompanyBackupState(value) {
  companyBackupState = { ...value, ...(companyBackupSchedule ? { schedule: companyBackupSchedule.state() } : {}) };
  if (mainWindow && !mainWindow.isDestroyed() && !activeEnvironment(environmentsState) && !desktopRemoteAccess &&
      mainWindow.webContents.mainFrame.url.startsWith(`${rendererOrigin()}/`)) mainWindow.webContents.send("company-backups:state-changed", companyBackupState);
}

function localBackupRequest(proc, route, init = {}) {
  if (!proc || proc !== serverProc || !serverReady || !/^\/api\/workspace-backup\/(?:status|export|upload|preview|restore|download\/[A-Za-z0-9_-]+)$/.test(route)) {
    throw new Error("This installation changed. Start this backup operation again.");
  }
  return fetch(`http://127.0.0.1:${SERVER_PORT}${route}`, { ...init, redirect: "error", credentials: "omit",
    headers: { ...Object.fromEntries(new Headers(init.headers)), [DESKTOP_MUTATION_HEADER]: desktopMutationToken } });
}

async function localBackupStatus(proc) {
  const response = await localBackupRequest(proc, "/api/workspace-backup/status", { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Local backup status is unavailable. Try again when this installation is ready.");
  const status = await response.json();
  if (proc !== serverProc || typeof status.busy !== "boolean" || typeof status.pendingRestore !== "boolean") throw new Error("This installation changed. Check backup status again.");
  return status;
}

async function runCompanyBackup(kind, input, scheduled = null) {
  if (companyBackupController || companyRestoreCommitting || desktopShutdownStarted || (scheduled && preparedCompanyRestore)) throw companyBackupDeferred();
  const client = ensureManagedDesktop(), connection = client.connection();
  if (!connection || !client.state().cloudBackups) throw new Error("Connect your organization and ask its administrator to enable cloud backups first.");
  const generation = client.backupGeneration();
  if (scheduled) {
    scheduled.signal.throwIfAborted();
    const scope = companyBackupScope();
    if (!scope || scope.key !== scheduled.scope.key || scope.generation !== scheduled.scope.generation) throw companyBackupDeferred();
  }
  const proc = serverProc, controller = new AbortController();
  const cancelScheduled = () => controller.abort();
  scheduled?.signal.addEventListener("abort", cancelScheduled, { once: true });
  const deadline = setTimeout(() => controller.abort(), 2 * 60 * 60_000); deadline.unref?.();
  companyBackupController = controller;
  preparedCompanyRestore = null;
  publishCompanyBackupState({ busy: true, kind });
  const progress = progress => publishCompanyBackupState({ busy: true, kind, progress });
  try {
    const status = await localBackupStatus(proc);
    if (status.pendingRestore) {
      publishCompanyBackupState({ busy: false, pendingRestore: true });
      throw new Error("Restart Sagax to finish the pending restore before starting another backup operation.");
    }
    if (status.busy) throw companyBackupDeferred();
    const transfers = createCompanyBackups({
      tempRoot: path.join(app.getPath("temp"), "openmaus-company-backups"),
      localRequest: (route, init) => localBackupRequest(proc, route, init),
      portalRequest: (route, options) => client.requestBackup(route, { ...options, generation }),
      availableBytes: async temporary => {
        const volumes = await Promise.all([fs.promises.statfs(temporary), fs.promises.statfs(desktopDataDir())]);
        return Math.min(...volumes.map(volume => volume.bavail * volume.bsize));
      },
    });
    const result = kind === "backup" ? await transfers.backup({ ...input, appVersion: app.getVersion() }, controller.signal, progress)
      : await transfers.prepareRestore(input, controller.signal, progress);
    controller.signal.throwIfAborted();
    if (proc !== serverProc || client.backupGeneration() !== generation || client.connection()?.deviceId !== connection.deviceId) throw new Error("This installation or its organization connection changed.");
    if (kind === "restore") preparedCompanyRestore = { id: result.id, proc, deviceId: connection.deviceId };
    publishCompanyBackupState({ busy: false, ...(kind === "backup" ? { lastBackupAt: Date.now() } : {}) });
    return result;
  } catch (error) {
    const message = controller.signal.aborted ? "Cloud backup cancelled. This installation has not been replaced."
      : error?.name === "CompanyBackupError" ? error.message : "Cloud backup could not complete. Check your organization connection and available disk space, then try again.";
    publishCompanyBackupState({ busy: false, pendingRestore: companyBackupState.pendingRestore, message });
    throw Object.assign(new Error(message), error?.code === "workspace_busy" ? { code: "workspace_busy" } : {});
  } finally {
    clearTimeout(deadline);
    scheduled?.signal.removeEventListener("abort", cancelScheduled);
    if (companyBackupController === controller) companyBackupController = null;
  }
}

function syncDesktopMutationToken(proc) {
  try {
    proc.postMessage({
      type: "openmausbot:desktop-mutation-token",
      token: desktopMutationToken,
      companionToken: companionMutationToken,
    });
  } catch (error) {
    slog(`desktop mutation capability sync failed: ${error?.message ?? error}`);
  }
}

function installDesktopMutationHeader() {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let ownsTarget = false;
    try {
      const target = new URL(details.url);
      ownsTarget = serverReady && target.protocol === "http:" &&
        target.hostname === "127.0.0.1" &&
        Number(target.port || 80) === SERVER_PORT;
    } catch {}
    if (!ownsTarget) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        [DESKTOP_MUTATION_HEADER]: desktopMutationToken,
      },
    });
  });
}

const savePhoneSecretOnce = createPhoneSecretSaveCoordinator((target, value) =>
  saveWorkspaceCredential(target, value),
);

function receivePhoneSecretSave(proc, rawMessage) {
  const request = decodePhoneSecretSaveRequest(rawMessage);
  if (!request) return false;
  void savePhoneSecretOnce(request).then((result) => {
    try {
      proc.postMessage(result);
    } catch (error) {
      slog(`phone credential save result failed: ${error?.message ?? error}`);
    }
  });
  return true;
}

async function startServerOn(port) {
  if (desktopShutdownStarted) return { proc: null, abort: true };
  // A bootstrap beside index.js that turns on Node's compile cache for this
  // child, so a relaunch skips recompiling the server bundle.
  const { entry, compileCacheDir } = serverChildLaunch({
    resourcesPath: process.resourcesPath,
    userData: app.getPath("userData"),
  });
  const childEnv = managedComposioChildEnvironment(composioBrokerUrl(), secureCredentials, {
    ...process.env,
    // The desktop parent owns the durable data-directory lease. Each utility
    // server gets only a private capability that validates that same live
    // owner; fallback-port children must not race to replace the parent lease.
    ...desktopDataDirLease.utilityServerLeaseEnvironment(),
    SAGAX_DATA_DIR: desktopDataDir(),
    // A packaged utility child must never fall back to a descriptor inherited
    // from the launching shell. It starts fail-closed until this exact main
    // process sends the private in-memory connection after spawn.
    SAGAX_DESKTOP_PARENT: "1",
    SAGAX_STATIC_DIR: path.join(process.resourcesPath, "ui"),
    SAGAX_RESOURCES_PATH: process.resourcesPath,
    SAGAX_SKILLS_DIR: path.join(process.resourcesPath, "skills"),
    SAGAX_PORT: String(port),
    // the server advertises this to remote clients so version skew is visible
    SAGAX_APP_VERSION: app.getVersion(),
    SAGAX_USER_DATA: app.getPath("userData"),
    ...(secureCredentials.composioApiKey
      ? { COMPOSIO_API_KEY: secureCredentials.composioApiKey }
      : {}),
    // "we could not read your keys" must not reach the UI as "you have none"
    SAGAX_CREDENTIAL_STORE: credentialStoreUnavailable ? "unavailable" : "ok",
    // one env var per stored workspace secret (xai/box/voice/OpenCode Go);
    // the server prefers these over config.json, whose plaintext fields
    // the boot migration has deleted
    ...workspaceCredentialEnv(secureCredentials),
    // The key of the server's encrypted MCP sign-in vault. It lives in
    // credentials.bin; without it the server refuses to invent another.
    ...(typeof secureCredentials.mcpOAuthKey === "string" && /^[0-9a-f]{64}$/.test(secureCredentials.mcpOAuthKey)
      ? { SAGAX_MCP_OAUTH_KEY: secureCredentials.mcpOAuthKey }
      : {}),
  });
  delete childEnv.SAGAX_BROWSER_CONNECTION;
  // Set here or not at all, never inherited from the launching shell. The
  // bootstrap removes it before the server runs, so nothing the server
  // spawns sees it.
  delete childEnv.SAGAX_SERVER_COMPILE_CACHE;
  if (compileCacheDir) childEnv.SAGAX_SERVER_COMPILE_CACHE = compileCacheDir;
  slog(`fork ${entry} port=${port}`);
  const proc = utilityProcess.fork(entry, [], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let resolveServerExit;
  utilityServerExits.set(proc, new Promise((resolve) => {
    resolveServerExit = resolve;
  }));
  proc.stdout?.on("data", (d) => slog(`[out] ${String(d).trimEnd()}`));
  proc.stderr?.on("data", (d) => slog(`[err] ${String(d).trimEnd()}`));
  proc.on("message", (message) => {
    if (!serverSupervisor.isCurrent(proc)) return;
    try {
      if (trustedApprovalMode.receive(proc, message)) return;
      if (managedDesktopRelay.receive(proc, message)) return;
      if (orgLibrary?.receive(message)) return;
      if (receivePhoneSecretSave(proc, message)) return;
    } catch (error) {
      slog(`desktop private sync rejected: ${error?.message ?? error}`);
    }
  });
  proc.once("spawn", () => {
    slog(`spawned pid=${proc.pid}`);
    if (!serverSupervisor.isCurrent(proc)) return;
    syncDesktopMutationToken(proc);
    syncPhoneSecretKey(proc);
  });
  let exited = false;
  proc.once("exit", (code) => {
    exited = true;
    trustedApprovalMode.rejectProcess(proc);
    managedDesktopRelay.rejectProcess(proc);
    resolveServerExit();
    slog(`exited code=${code}`);
  });
  serverSupervisor.watch(proc);
  // wait for the port to answer (fresh machine: first boot writes data dirs).
  // Identity check is by PID: a dev harness server has the same API shape,
  // so only the child we actually forked (matching pid + static serving)
  // counts as ours.
  // The budget is wall-clock, not a fixed poll count: a healthy boot can take
  // well past 20s on cold machines or when pre-listen network calls stall
  // (issue #506), and reaping an about-to-listen child reads to the user as
  // "something else is using its ports" even though nothing was on them.
  // The probe itself is deadline-bounded (a hung health endpoint cannot wedge
  // us here forever) and reports WHY it gave up, so the error page can tell
  // port conflict apart from slow startup.
  const identity = await pollServerIdentity({
    port,
    // Getter, not value: proc.pid stays undefined until the async `spawn`
    // event fires, and capturing it here would make the probe judge our own
    // child a "foreign owner" on its first health answer.
    pid: () => proc.pid,
    bootTimeoutMs: SERVER_BOOT_TIMEOUT_MS,
    isExited: () => exited || desktopShutdownStarted,
  });
  if (identity.outcome === "ready" && serverSupervisor.isCurrent(proc)) return { proc };
  if (identity.outcome === "exited") {
    slog(`child on port ${port} exited before answering /api/health`);
  } else {
    slog(
      identity.outcome === "foreign-owner"
        ? `port ${port} answered health checks from another process`
        : `child on port ${port} did not answer /api/health within ${SERVER_BOOT_TIMEOUT_MS / 1000}s`,
    );
  }
  const stopped = await stopUtilityServer(proc);
  if (!stopped) {
    slog(`child on port ${port} did not exit after termination; refusing to start a sibling server`);
  }
  return { proc: null, reason: stopped ? identity.outcome : "stuck-child", abort: !stopped };
}

async function startServerPackaged() {
  startupPhase("starting the local server", "Starting the local server…");
  const started = await startServerPackagedOnce();
  startupPhase(started ? "local server ready" : "local server failed to start");
  return started;
}

async function startServerPackagedOnce() {
  // two passes: a quit-and-reopen relaunch can race the dying instance's
  // server during teardown — one settle-and-retry covers it
  let everyPortForeignOwned = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    let sawForeignOwner = false;
    for (const port of [8799, 18799, 28799]) {
      if (desktopShutdownStarted) return false;
      const started = await startServerOn(port);
      if (started.proc) {
        SERVER_PORT = port;
        if (serverSupervisor.ready(started.proc)) return true;
      }
      if (started.abort) return false;
      // A child that exited or timed out is not evidence of a port conflict —
      // only "another process answered health checks" is.
      if (started.reason !== "foreign-owner") everyPortForeignOwned = false;
      else sawForeignOwner = true;
    }
    // The second pass exists for a dying previous instance still holding a
    // port. A child that crashed or never answered on every port will do the
    // same again: retrying only doubles the wait before the error page.
    if (!sawForeignOwner) break;
    await new Promise((r) => setTimeout(r, 2500));
  }
  serverStartConflictOnly = everyPortForeignOwned;
  return false;
}

function syncManagedComposioCredentials() {
  if (!serverProc) return;
  try {
    serverProc.postMessage({
      type: "openmausbot:managed-composio",
      access: managedComposioAccess(composioBrokerUrl(), secureCredentials),
    });
  } catch (error) {
    slog(`connected-apps credential sync failed: ${error?.message ?? error}`);
  }
}

// The page is built at failure time (not import time): the message depends on
// how the boot failed, and the log path comes from LOG_DIR so Windows and
// Linux users see their real location instead of a macOS guess. The link
// opens the log through the window's setWindowOpenHandler, which routes to
// the platform handler.
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function buildErrorPage({ allPortsOccupied }) {
  const serverLogPath = path.join(LOG_DIR, "server.log");
  const serverLogHref = pathToFileURL(serverLogPath).href;
  const reason = allPortsOccupied
    ? "Every Sagax port answered health checks from another process — likely a second copy of the app, or another program on ports 8799–28799. Quit that program, then quit and reopen Sagax."
    : "The background server didn't come up in time — this is usually slow startup, not a port conflict. Quit and reopen Sagax.";
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(
      `<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#070707;color:#fcfcfc;font:15px -apple-system,system-ui"><div style="text-align:center;max-width:360px"><div style="font-size:40px">🐭</div><h2 style="font-weight:600;margin:12px 0 6px">Couldn't start the bot server</h2><p style="color:#fcfcfc99;line-height:1.5">${escapeHtml(reason)} If it keeps happening, check <a target="_blank" rel="noopener" href="${serverLogHref}" style="color:#fcfcfc">${escapeHtml(serverLogPath)}</a>.</p></div></body>`,
    )
  );
}

// How long one packaged-server child gets to answer /api/health before the
// parent reaps it and tries the next port. Wall-clock, deliberately generous:
// first boots write data dirs and pre-listen network calls (managed composio,
// workspace credentials) can stall a healthy child far past 20s on some
// machines, which used to surface as the misleading "ports are busy" page.
const SERVER_BOOT_TIMEOUT_MS = 60_000;

let cuaReady = Promise.resolve({ mode: "unavailable", reason: "not-started" });
const androidDevice = createAndroidDeviceController({ resourcesPath: process.resourcesPath });
const displayMediaGuard = createDisplayMediaGuard();
let displayMediaRequestCount = 0;

function rendererOrigin() {
  return new URL(app.isPackaged || desktopRemoteAccess ? `http://127.0.0.1:${SERVER_PORT}` : DEV_URL).origin;
}

function respondToDisplayMediaRequest(callback, response) {
  const error = invokeDisplayMediaCallback(callback, response);
  // An empty response intentionally rejects the renderer request, and Electron
  // can surface that rejection by throwing from the callback. A selected
  // source should never fail delivery, so keep that path visible in logs.
  if (error && response.video) {
    console.error("[screen-preview] failed to deliver selected source:", error);
  }
}

function notifyDesktopViewer(open) {
  if (!desktopViewerOwner?.isDestroyed()) {
    desktopViewerOwner.send("desktop-viewer:state", {
      open,
      contextId: desktopViewerContextId,
    });
  }
}

function desktopViewerErrorPage(message, retryUrl) {
  const escape = (value) =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll('"', "&quot;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  return (
    "data:text/html;charset=utf-8," +
    encodeURIComponent(`<!doctype html><meta name="color-scheme" content="dark"><title>Desktop unavailable</title>
      <body style="margin:0;display:grid;place-items:center;height:100vh;background:#070707;color:#f5f5f5;font:14px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif">
        <main style="max-width:420px;padding:32px;text-align:center"><h2 style="margin:0 0 10px;font-size:18px">Couldn't open the live desktop</h2>
        <p style="margin:0 0 20px;color:#a1a1aa;line-height:1.5">${escape(message)}</p>
        <a href="${escape(retryUrl)}" target="_blank" rel="noreferrer" style="display:inline-block;border-radius:9px;background:#fff;color:#111;padding:9px 14px;text-decoration:none;font-weight:600">Open in browser</a></main>
      </body>`)
  );
}

function openDesktopViewer(owner, rawUrl, rawTitle, contextId) {
  if (!owner || owner.isDestroyed()) throw new Error("The Sagax window is unavailable");
  const url = desktopViewerUrl(rawUrl);
  const titleCandidate = Object.prototype.toString.call(rawTitle) === "[object String]" ? rawTitle.trim() : "";
  const title = titleCandidate ? titleCandidate.slice(0, 80) : "Live desktop";

  const nextContextId =
    Object.prototype.toString.call(contextId) === "[object String]" ? contextId.slice(0, 120) : null;

  // Desktop URLs contain rotating access tokens. A newly minted URL replaces
  // the old viewer instead of being retained anywhere after its window closes.
  // Clear the ref first so the stale window's close handler no-ops; on a bot
  // change, tell the previous bot to release (same-bot reopen stays quiet).
  if (desktopViewerWindow && !desktopViewerWindow.isDestroyed()) {
    const previous = desktopViewerWindow;
    const previousOwner = desktopViewerOwner;
    const previousContextId = desktopViewerContextId;
    desktopViewerWindow = null;
    previous.close();
    if (previousContextId !== nextContextId && previousOwner && !previousOwner.isDestroyed()) {
      previousOwner.send("desktop-viewer:state", { open: false, contextId: previousContextId });
    }
  }
  desktopViewerOwner = owner.webContents;
  desktopViewerContextId = nextContextId;

  const viewer = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 760,
    minHeight: 520,
    parent: owner,
    // Not modal: the person still needs the app's "Hand control back" button
    // while the desktop is open. `parent` keeps it floating above the app.
    modal: false,
    show: false,
    title,
    icon: currentWindowIcon(),
    backgroundColor: "#070707",
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // Keep provider cookies away from the app renderer and discard them on
      // app exit. The secret-bearing URL is sufficient to authenticate.
      partition: "openmausbot-desktop-viewer",
    },
  });
  desktopViewerWindow = viewer;
  const viewerOrigin = url.origin;

  // VNC needs rendering, keyboard/mouse input and WebSockets, plus the few
  // permission-gated input capabilities a viewer page asks for: keyboard and
  // pointer capture, the clipboard for paste, full screen. Those go to the
  // viewer's own origin only — never camera, microphone, geolocation,
  // notifications, USB, or any other privileged browser capability in this
  // remote-content window (see desktop-viewer-permissions.mjs).
  viewer.webContents.session.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    desktopViewerPermissionAllowed(permission, requestingOrigin, viewerOrigin),
  );
  viewer.webContents.session.setPermissionRequestHandler((webContents, permission, callback, details) =>
    callback(desktopViewerPermissionAllowed(permission, details?.requestingUrl || webContents.getURL(), viewerOrigin)),
  );

  // A child window floats above the app but does not take the keyboard until
  // it is focused: clicks land in the VNC canvas either way, keystrokes only
  // reach the key window. Left unfocused, typing "into the VM" lands in the
  // composer and ⌘1–9 switch bots while the mouse appears to work.
  viewer.once("ready-to-show", () => {
    if (viewer.isDestroyed()) return;
    viewer.show();
    viewer.focus();
    viewer.webContents.focus();
  });
  viewer.on("closed", () => {
    if (desktopViewerWindow !== viewer) return;
    desktopViewerWindow = null;
    // The panel drops its "viewer open" state and releases control on this.
    notifyDesktopViewer(false);
    desktopViewerOwner = null;
    desktopViewerContextId = null;
  });
  viewer.on("page-title-updated", (event) => {
    event.preventDefault();
    viewer.setTitle(title);
  });
  viewer.webContents.setWindowOpenHandler(({ url: target }) => {
    try {
      const external = desktopViewerUrl(target);
      void shell.openExternal(external.toString());
    } catch {
      // Ignore non-web and insecure URLs from the remote viewer.
    }
    return { action: "deny" };
  });
  viewer.webContents.on("will-navigate", (event, target) => {
    if (sameDesktopViewerOrigin(target, viewerOrigin)) return;
    event.preventDefault();
    try {
      void shell.openExternal(desktopViewerUrl(target).toString());
    } catch {
      // Keep privileged or malformed navigation out of the viewer.
    }
  });
  viewer.webContents.on("did-fail-load", (_event, code, description, failedUrl, isMainFrame) => {
    if (!isMainFrame || code === -3 || viewer.isDestroyed() || failedUrl.startsWith("data:")) return;
    void viewer.loadURL(desktopViewerErrorPage(description || "The viewer did not respond.", url.toString()));
  });

  notifyDesktopViewer(true);
  void viewer.loadURL(url.toString()).catch((error) => {
    if (viewer.isDestroyed()) return;
    void viewer.loadURL(desktopViewerErrorPage(error?.message ?? "The viewer did not respond.", url.toString()));
  });
  return true;
}

function ensureDesktopWorkspace(owner) {
  if (!owner || owner.isDestroyed()) throw new Error("The Sagax window is unavailable");
  if (desktopWorkspaceManager) {
    if (desktopWorkspaceOwner !== owner) {
      throw new Error("The two-desktop view belongs to another app window");
    }
    return desktopWorkspaceManager;
  }

  desktopWorkspaceOwner = owner;
  const manager = createDesktopWorkspaceManager({
    owner,
    createView: (options) => new WebContentsView(options),
    partitionPrefix: `openmausbot-desktop-workspace-${randomUUID()}`,
    notify: (state) => {
      if (!owner.isDestroyed() && !owner.webContents.isDestroyed()) {
        owner.webContents.send("desktop-workspace:state", state);
      }
    },
  });
  desktopWorkspaceManager = manager;

  // Native child views outlive the renderer DOM unless we explicitly tear
  // them down. Reloads, renderer crashes and owner destruction all close both
  // panes without retaining their secret-bearing noVNC URLs.
  owner.webContents.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) manager.closeAll();
  });
  owner.webContents.on("render-process-gone", () => manager.closeAll());
  owner.once("closed", () => {
    manager.closeAll();
    if (desktopWorkspaceManager === manager) {
      desktopWorkspaceManager = null;
      desktopWorkspaceOwner = null;
    }
  });
  return manager;
}

function desktopWorkspaceForEvent(event, create = false) {
  const owner = mainWindow;
  if (!owner || owner.isDestroyed() || event.sender !== owner.webContents) {
    throw new Error("The two-desktop view is available only to the main app window");
  }
  if (desktopWorkspaceManager && desktopWorkspaceOwner !== owner) {
    throw new Error("The two-desktop view belongs to another app window");
  }
  return create ? ensureDesktopWorkspace(owner) : desktopWorkspaceManager;
}


ipcMain.on("screen:preview-intent", localOnlySync("screen:preview-intent", (event) => {
  event.returnValue = displayMediaGuard.begin(event.senderFrame);
}));

ipcMain.on("desktop:unread-count", (event, value) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!sender || sender !== mainWindow || sender.isDestroyed()) return;
  unreadCount = normalizeUnreadCount(value);
  applyUnreadBadge(sender);
});

// A nudge between the two people in a chat: bring this desktop's main
// window to the front and shake it. The sender and the recipient each ask
// from their own app. Floating windows stay where they are. A subframe
// cannot ask, and a second call during the shake does not focus again
// (electron/window-nudge.mjs).
const windowNudger = createWindowNudger(undefined, () => {
  if (process.platform === "darwin") {
    app.show();
    app.focus({ steal: true });
  } else {
    app.focus();
  }
});
ipcMain.on("desktop:nudge", (event) => {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!sender || sender !== mainWindow || sender.isDestroyed()) return;
  const frame = event.senderFrame;
  const mainFrame = event.sender?.mainFrame;
  if (frame && mainFrame && frame !== mainFrame) return;
  windowNudger.nudge(mainWindow);
});

// ── environments: this computer's server, or a paired remote one ──────
// The app switches by loading the chosen server's own UI (electron/menu.mjs).
// Only {id, name, origin} is stored here; the session credential is the
// HttpOnly cookie /pair set for that origin, kept by Chromium's cookie jar.
const { LOCAL_ID, activeEnvironment, allowedOrigins, bundledOrigin, parseEnvironments, parseHostedWorkspaceLink, serializeEnvironments, serverModeEnvironment, withActive, withEnvironment, withOrganizationUpgrade, withServerMode, withoutEnvironment, withoutServerMode, workspaceMenuTemplate, workspaceNavigationAllowed, workspaceSenderAllowed, workspaceSummary, workspaceWindowTitle } = environmentsModule;
let environmentsState = { environments: [], activeId: LOCAL_ID };
let computerSharing;
const sharingPrompts = new Set();

// Opt-in computer sharing is gated by the server this desktop runs, the same
// way every other server setting reaches this process: the booleans-only
// /api/config status (server/index.ts configStatus → features). It is read
// before the connector could start and again whenever a workspace control is
// used, so a maintainer who edits config.json and restarts the server does not
// have to reinstall the app. Unreachable or older server → off.
let sharedComputersAllowed = false;

async function refreshSharedComputersAllowed() {
  // Server mode runs no local server: the organization's server says
  // whether it accepts a person's computer (its public descriptor).
  const locked = serverModeEnvironment(environmentsState);
  if (locked) {
    sharedComputersAllowed = await fetchEnvironmentDescriptor(locked.origin, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(3_000) })
      .then((res) => (res.ok ? res.json() : null))
      .then((descriptor) => descriptor?.capabilities?.sharedComputers === true)
      .catch(() => false);
    return sharedComputersAllowed;
  }
  sharedComputersAllowed = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/config`, { signal: AbortSignal.timeout(3_000) })
    .then((res) => (res.ok ? res.json() : null))
    .then((status) => status?.features?.sharedComputers === true)
    .catch(() => false);
  return sharedComputersAllowed;
}

/** Refuse a workspace sharing control the server would refuse anyway. */
async function requireSharedComputers() {
  if (await refreshSharedComputersAllowed()) return;
  throw new Error("Computer sharing is turned off on this server.");
}

function sharingController() {
  computerSharing ??= createComputerSharing({
    file: path.join(app.getPath("userData"), "computer-sharing.json"),
    // The harness server's data directory holds provider API keys and
    // sessions.json, so a broad share must never reach it either.
    protectedPaths: [desktopDataDir()],
    // main's own calls never go through the bundled-UI handler (bundled-ui.cjs)
    fetch: (url, init) => session.defaultSession.fetch(url, { ...init, bypassCustomProtocolHandlers: true }),
    environments: () => environmentsState.environments,
    enabled: refreshSharedComputersAllowed,
    cuaConnection: () => cuaReady,
    hostControl: async (id, signal) => {
      // Server mode: no local server and no local bot compete for this
      // screen, so there is no local seat to lease.
      if (serverModeEnvironment(environmentsState) && !serverReady) return { renew: async () => {}, release: async () => {} };
      const lease = async action => {
        const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/desktop/shared-computer-control`, {
          method: "POST",
          headers: desktopServerHeaders({ "content-type": "application/json" }, { packaged: app.isPackaged, token: desktopMutationToken }),
          body: JSON.stringify({ id, action }),
          signal: action === "release" ? AbortSignal.timeout(3000) : AbortSignal.any([signal, AbortSignal.timeout(3000)]),
        });
        if (!response.ok) throw new Error("This computer is in use locally or held by a person. Wait, then observe it again before acting.");
      };
      await lease("acquire");
      return { renew: () => lease("acquire"), release: () => lease("release") };
    },
  });
  return computerSharing;
}

// ── desktop bridge (server mode) ────────────────────────────────────────
// The organization server's bots, working for the person signed in here,
// run their tools on this computer and their traffic leaves through it
// (electron/desktop-bridge.mjs, server/desktop-bridge.ts). Only while this
// app is locked to that server and signed in; the cookie and the bridge
// secret never leave the main process.
let desktopBridgeConnector = null;
let bridgeBrowseSession = null;
async function bridgeBrowse(url, screenshot, signal) {
  // Its own in-memory session: no cookie of the person's own browsing, and
  // never this app's own session with the server.
  bridgeBrowseSession ??= session.fromPartition("sagax-bridge-browse");
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: bridgeBrowseSession, offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const stop = () => { if (!win.isDestroyed()) win.destroy(); };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    await Promise.race([win.loadURL(url), new Promise((_, reject) => setTimeout(() => reject(new Error("The page took too long to load")), 30_000))]);
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (screenshot) {
      const image = await win.webContents.capturePage();
      return { content: [{ type: "image", data: image.toPNG().toString("base64"), mimeType: "image/png" }, { type: "text", text: `screenshot of ${url}` }] };
    }
    const html = String(await win.webContents.executeJavaScript("document.documentElement.outerHTML"));
    return { content: [{ type: "text", text: html.length > 512 * 1024 ? `${html.slice(0, 512 * 1024)}\n[page shortened]` : html }] };
  } finally {
    signal?.removeEventListener("abort", stop);
    stop();
  }
}
/** The person's yes, on this computer, before a bot creates the Local VM
 * here through the desktop bridge (as solo mode asks in its settings). */
async function confirmBridgeLocalVm({ runtime, needsImage, signal }) {
  const env = serverModeEnvironment(environmentsState);
  const french = /^fr\b/i.test(app.getLocale());
  const server = env?.name ?? (french ? "votre serveur" : "your server");
  const detail = french
    ? [
      `Un robot de ${server}, qui travaille pour vous, veut un bureau Linux (Local VM) sur cet ordinateur, avec ${runtime}.`,
      needsImage ? "Sagax télécharge et construit d'abord l'image du bureau (quelques Go, plusieurs minutes)." : "L'image du bureau est déjà prête.",
      "Le Local VM utilise jusqu'à 4 Go de mémoire et 2 processeurs, n'est joignable que depuis cet ordinateur et garde ses fichiers dans le dossier de Sagax. Vous pourrez le supprimer plus tard.",
    ]
    : [
      `A bot on ${server}, working for you, wants a Linux desktop (Local VM) on this computer, with ${runtime}.`,
      needsImage ? "Sagax first downloads and builds the desktop image (a few GB, several minutes)." : "The desktop image is already prepared.",
      "The Local VM uses up to 4 GB of memory and 2 processors, is reachable from this computer only and keeps its files in Sagax's folder. You can remove it later.",
    ];
  const { response } = await dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
    type: "question",
    message: french ? "Créer un Local VM sur cet ordinateur?" : "Create a Local VM on this computer?",
    detail: detail.join("\n\n"),
    buttons: french ? ["Créer", "Annuler"] : ["Create", "Cancel"],
    defaultId: 1, cancelId: 1,
    ...(signal ? { signal } : {}),
  });
  return response === 0 && !signal?.aborted;
}

/** The person's SOCKS5 user name and password for the system proxy, asked
 * once in a small window of the app when the proxy asks and none is known
 * (proxy-credentials.mjs). Resolves { username, password } or null. */
async function askProxyPassword({ host, port }) {
  const french = /^fr\b/i.test(app.getLocale());
  const parent = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
  const win = new BrowserWindow({
    parent, modal: Boolean(parent), width: 440, height: 330, resizable: false, minimizable: false, maximizable: false, show: false,
    title: french ? "Mot de passe du proxy" : "Proxy password",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: true, partition: "sagax-proxy-password" },
  });
  win.setMenuBarVisibility?.(false);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  const closed = new Promise((resolve) => win.once("closed", () => resolve(null)));
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(proxyPasswordPage({ host, port, french }))}`);
    win.show();
    return await Promise.race([win.webContents.executeJavaScript(proxyPasswordAnswerScript, true), closed]);
  } catch {
    return null;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

let bridgeProxyCredentials = null;
function desktopBridgeProxyCredentials() {
  bridgeProxyCredentials ??= createProxyCredentials({
    store: createProxyCredentialStore({
      file: path.join(app.getPath("userData"), "proxy-passwords.bin"), fs, log: (message) => slog(message),
      encryption: {
        available: async () => (await safeStorage.isAsyncEncryptionAvailable()) &&
          (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
        encrypt: (value) => safeStorage.encryptStringAsync(value),
        decrypt: (buffer) => safeStorage.decryptStringAsync(buffer),
      },
    }),
    prompt: askProxyPassword,
  });
  return bridgeProxyCredentials;
}

function desktopBridge() {
  desktopBridgeConnector ??= createDesktopBridge({
    environment: () => serverModeEnvironment(environmentsState),
    // main's own calls never go through the bundled-UI handler (bundled-ui.cjs)
    fetch: (url, init) => session.defaultSession.fetch(url, { ...init, bypassCustomProtocolHandlers: true }),
    cookieHeader: async (origin) => (await session.defaultSession.cookies.get({ url: origin })).map((cookie) => `${cookie.name}=${cookie.value}`).join("; "),
    attachmentsDir: path.join(app.getPath("temp"), "Sagax", "attachments"),
    // The app's own data (its cookies and grants) and the harness data dir
    // never pass through the bridge; the person's credential stores neither.
    protectedPaths: [app.getPath("userData"), desktopDataDir()],
    activityFile: path.join(app.getPath("userData"), "desktop-bridge-activity.jsonl"),
    // The person's own network: Chromium's stack, the OS proxy and the VPN.
    fetchUrl: (url, init) => session.fromPartition("sagax-bridge-net").fetch(url, init),
    // The system proxy for each destination (a PAC file included), and the
    // SOCKS5 password when the proxy asks: this app's environment, else what
    // the person typed once here (kept encrypted by the OS).
    resolveProxy: (url) => session.defaultSession.resolveProxy(url),
    proxyCredentials: desktopBridgeProxyCredentials(),
    browse: bridgeBrowse,
    cuaConnection: async () => {
      const connection = await cuaReady.catch(() => null);
      return connection?.mcpCommand ? connection : null;
    },
    // The Local VM on this computer, bound to this app's own data dir; an
    // install happens only after the person confirms here, in an OS dialog.
    localVm: createLocalVm({
      dataDir: desktopDataDir(),
      home: app.getPath("home"),
      openExternal: (url) => shell.openExternal(url),
      // A bot asking for a Local VM here: the person says yes on this computer.
      confirmCreate: confirmBridgeLocalVm,
      confirm: async ({ product, method }) => {
        const window = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
        const message = method === "brew" ? `Install ${product} with Homebrew?` : `Open the ${product} download page?`;
        const detail = method === "brew"
          ? `Sagax runs "brew install --cask ${product.toLowerCase()}" on this computer. ${product} runs the Local VM, an isolated Linux desktop for your bots. macOS may ask for your password.`
          : `${product} runs the Local VM, an isolated Linux desktop for your bots. Install it, open it once, then come back and choose Set up in one click.`;
        const options = { type: "question", buttons: ["Continue", "Cancel"], defaultId: 0, cancelId: 1, message, detail };
        const answer = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
        return answer.response === 0;
      },
    }),
  });
  return desktopBridgeConnector;
}

async function offerComputerSharing(win) {
  const env = activeEnvironment(environmentsState);
  if (!env || sharingPrompts.has(env.id) || win.isDestroyed()) return;
  // Never offer a grant this build's server will not honour.
  if (!(await refreshSharedComputersAllowed()) || win.isDestroyed()) return;
  sharingPrompts.add(env.id);
  try {
    const info = await sharingController().observe(env);
    if (!info || win.isDestroyed() || activeEnvironment(environmentsState)?.id !== env.id || new URL(win.webContents.getURL()).origin !== env.origin) return;
    const choice = await dialog.showMessageBox(win, {
      type: "question", message: `Share this computer with ${env.name}?`,
      detail: "Let this server’s bots use folders and capabilities you choose while this desktop app is running, only when you are the person asking. Nothing is shared unless you enable it. You can change this later in Settings → Organization.",
      buttons: ["Choose access", "Not now"], defaultId: 1, cancelId: 1,
    });
    sharingController().decline(env, info);
    if (choice.response === 0) openWorkspaceSettings(env.id);
  } catch { /* Not paired yet, an older server, or offline: no grant, no prompt. */ }
  finally { sharingPrompts.delete(env.id); }
}

function environmentsFile() {
  return path.join(app.getPath("userData"), "environments.json");
}

function readEnvironments() {
  try {
    return parseEnvironments(fs.readFileSync(environmentsFile(), "utf8"));
  } catch {
    return { environments: [], activeId: LOCAL_ID };
  }
}

function writeEnvironments(state) {
  const file = environmentsFile();
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, serializeEnvironments(state), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {}
    slog(`environments save failed: ${error?.message ?? error}`);
    throw new Error("Could not save server connections on this computer. Please try again.");
  }
}

/** Where the main window should be: the active remote server, else Local. */
function activeOrigin() {
  return activeEnvironment(environmentsState)?.origin ?? rendererOrigin();
}


function refreshApplicationMenu() {
  Menu.setApplicationMenu(
    buildApplicationMenu({
      environments: environmentsState.environments,
      activeId: environmentsState.activeId,
      onSwitch: (id) => void workspaceMenuAction(() => switchEnvironment(id)),
      onAddFromClipboard: () => void addServerFromClipboard(),
      onConnect: () => void workspaceMenuAction(openWorkspaceSettings),
      onForget: (id) => void workspaceMenuAction(() => forgetEnvironment(id)),
      onOpenSettings: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:open-settings");
      },
      onOpenReleaseNotes: () => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("release-notes:open");
      },
      serverModeId: serverModeEnvironment(environmentsState)?.id ?? null,
      onLeaveServerMode: () => void workspaceMenuAction(leaveServerMode),
    }),
  );
}

// ── this app's own UI on an organization server (electron/bundled-ui.cjs) ──
// While the active environment is an organization server, every page request
// to its origin is answered from this app's bundle and its API is passed
// through untouched: the same UI as on this computer, the server's session
// and authorization. The handler is installed only for that scheme and only
// while such a server is active.
let bundledScheme = null;
let currentBundledOrigin = null;
function bundledUiStaticDir() {
  if (app.isPackaged) return path.join(process.resourcesPath, "ui");
  return process.env.SAGAX_BUNDLED_UI_DIR || null;
}
function bundledUiDevOrigin() {
  if (app.isPackaged || process.env.SAGAX_BUNDLED_UI_DIR) return null;
  return new URL(DEV_URL).origin;
}
const bundledUiHandler = bundledUiModule.createBundledUiHandler({
  origin: () => currentBundledOrigin,
  staticDir: bundledUiStaticDir,
  devOrigin: bundledUiDevOrigin,
  fetch: (input, init) => net.fetch(input, init),
  readFile: (file) => fs.promises.readFile(file),
  log: (line) => slog(line),
});
function syncBundledUi() {
  const origin = bundledOrigin(environmentsState);
  const scheme = origin ? new URL(origin).protocol.slice(0, -1) : null;
  if (bundledScheme && bundledScheme !== scheme) {
    try { session.defaultSession.protocol.unhandle(bundledScheme); } catch {}
    bundledScheme = null;
  }
  if (scheme && bundledScheme !== scheme) {
    try {
      session.defaultSession.protocol.handle(scheme, bundledUiHandler);
      bundledScheme = scheme;
    } catch (error) {
      slog(`bundled UI: could not take over ${scheme} (${error?.message ?? error})`);
    }
  }
  currentBundledOrigin = bundledScheme ? origin : null;
  setBundledOrigin(currentBundledOrigin);
}

// The floating bots and the Hibou 98 assistant draw from the local server's
// page. In server mode the packaged app runs no local server, so they draw
// from this app's bundle instead, in an in-memory session of their own that
// holds no cookie and answers nothing but UI files.
let detachedUiSession = null;
function detachedUiSessionIfNeeded() {
  if (serverReady || !app.isPackaged) return null;
  if (!detachedUiSession) {
    detachedUiSession = session.fromPartition("sagax-detached-ui");
    detachedUiSession.protocol.handle("https", bundledUiModule.createDetachedUiHandler({
      staticDir: bundledUiStaticDir,
      devOrigin: () => null,
      fetch: (input, init) => net.fetch(input, init),
      readFile: (file) => fs.promises.readFile(file),
      log: (line) => slog(line),
    }));
  }
  return detachedUiSession;
}
function detachedPageOrigin() {
  return detachedUiSessionIfNeeded() ? bundledUiModule.DETACHED_UI_ORIGIN : rendererOrigin();
}

function persistEnvironments(next) {
  writeEnvironments(next);
  environmentsState = next;
  syncBundledUi();
  desktopBridge().sync();
  refreshApplicationMenu();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setTitle(workspaceWindowTitle(environmentsState, desktopRemoteAccess));
  // A server saved, marked, forgotten or left: the owner identity follows.
  void ownerIdentitySync.refresh("servers changed");
}

async function workspaceMenuAction(action) {
  try { await action(); } catch (error) {
    await dialog.showMessageBox({ type: "error", message: "Could not update servers", detail: error.message });
  }
}

function navigateMainWindow(url) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Floating bots and the detached assistant belong to the page that drives
  // them: another server's page brings its own.
  try {
    if (new URL(url).origin !== new URL(mainWindow.webContents.getURL()).origin) {
      floatingBotWindows.closeAll();
      retroAssistantWindow.close();
    }
  } catch {}
  // did-fail-load shows the connection error and returns to the local app.
  void mainWindow.loadURL(url).catch(() => {});
}

/** Server mode refuses anything that would show Local or another server. */
function requireNotServerMode() {
  const locked = serverModeEnvironment(environmentsState);
  if (locked) throw new Error(`This app is connected to ${locked.name}. Change the server in Settings > General first.`);
}

async function switchEnvironment(id) {
  if (id === environmentsState.activeId || (id !== LOCAL_ID && !environmentsState.environments.some((entry) => entry.id === id))) return;
  if (serverModeEnvironment(environmentsState)) return;
  persistEnvironments(withActive(environmentsState, id));
  navigateMainWindow(activeOrigin());
}

/** Signing in from the launch screen: the organization server becomes the
 * only one this app shows (environments.cjs withServerMode). */
let leavingServerMode = false;
/** Leave server mode, the one way out (Settings > General > Server >
 * Sign out, or Server > Change server…): after a native confirmation, sign out
 * of the server, forget it and its page data, and come back to this
 * computer's launch screen. Local bots, conversations and keys were never
 * touched and are as they were. A packaged app that ran no local server in
 * server mode restarts to start it. */
async function leaveServerMode() {
  const locked = serverModeEnvironment(environmentsState);
  if (!locked || leavingServerMode) return { left: false };
  leavingServerMode = true;
  try {
    const { response } = await dialog.showMessageBox(mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined, {
      type: "question",
      buttons: ["Sign out", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: `Sign out of ${locked.name}?`,
      detail: `This app signs out of ${new URL(locked.origin).host} and returns to the launch screen, where you choose No server or another server. Your bots stay on the server; nothing on this computer is changed.`,
    });
    if (response !== 0) return { left: false };
    try {
      const signedOut = await session.defaultSession.fetch(`${locked.origin}/api/auth/logout`, { method: "POST", credentials: "include", headers: { origin: locked.origin }, signal: AbortSignal.timeout(5_000), bypassCustomProtocolHandlers: true });
      if (!signedOut.ok) throw new Error(`HTTP ${signedOut.status}`);
    } catch (error) {
      slog(`leave server mode: logout not confirmed (${error?.message ?? error})`);
    }
    try {
      await session.defaultSession.clearStorageData({ origin: locked.origin, storages: ["localstorage", "indexdb", "serviceworkers", "cachestorage"] });
    } catch (error) {
      slog(`leave server mode: storage clear failed: ${error?.message ?? error}`);
    }
    try { sharingController().forget(locked); } catch {}
    floatingBotWindows.closeAll();
    retroAssistantWindow.close();
    persistEnvironments(withoutServerMode(environmentsState));
    if (app.isPackaged && !serverReady && !desktopRemoteAccess) {
      relaunchAfterDesktopRemoteChange();
    } else {
      navigateMainWindow(`${rendererOrigin()}/`);
    }
    return { left: true };
  } finally {
    leavingServerMode = false;
  }
}

const organizationEntry = createOrganizationEntry({
  readState: () => ({ environments: environmentsState, remoteAccess: desktopRemoteAccess,
    restartIntent: organizationRestartIntent(secureCredentialState?.read() ?? secureCredentials) }),
  confirm: async ({ kind, name, origin }) => {
    const { response } = await dialog.showMessageBox({
      type: "question",
      buttons: [kind === "companion" ? "Disconnect and restart locally" : "Use this computer", "Cancel"],
      defaultId: 1, cancelId: 1,
      message: kind === "companion" ? `Disconnect from ${name} to sign in locally?` : `Leave ${name} and sign in on this computer?`,
      detail: `${origin}\n\nOrganization sign-in connects company models to this computer. ${kind === "companion" ? "This disconnects desktop companion access and restarts the app. You can pair again later." : "The hosted connection stays saved and can be selected again from the Server menu."} No remote bots, conversations or provider accounts are moved or deleted.`,
    });
    return response === 0;
  },
  saveEnvironments: persistEnvironments,
  disconnectAndRemember: async expected => {
    await updateSecureCredentialDocument(credentials => {
      const current = desktopCompanionAccess(credentials);
      if (!current || current.endpoint !== expected.endpoint || current.deviceId !== expected.deviceId || current.token !== expected.token) {
        throw new Error("The companion connection changed. Choose organization sign-in again.");
      }
      return withOrganizationRestartIntent(credentials);
    });
    desktopRemoteAccess = null;
  },
  clearRestartIntent: () => updateSecureCredentialDocument(credentials =>
    organizationRestartIntent(credentials) && !desktopCompanionAccess(credentials)
      ? withoutOrganizationRestartIntent(credentials) : credentials),
  openLocalSettings: async () => {
    if (!app.isPackaged) throw new Error("Organization sign-in requires the installed desktop app.");
    if (!serverReady) throw new Error("This installation is unavailable. Restart the app and try organization sign-in again.");
    if (desktopRemoteAccess || activeEnvironment(environmentsState)) throw new Error("Choose this computer before signing in with your organization.");
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow({ deferNavigation: true });
    if (!win.webContents.isLoadingMainFrame() && senderIsLocal({ sender: win.webContents })) {
      win.webContents.send("app:open-settings", "organization");
    } else {
      await win.loadURL(`${rendererOrigin()}/?desktop-settings=organization`);
    }
  },
  relaunch: relaunchAfterDesktopRemoteChange,
});

function queueOrganizationEntry(link) {
  if (!isOrganizationDeepLink(link)) return false;
  pendingOrganizationEntry = true;
  if (!desktopTray?.show()) activateExistingWindow(BrowserWindow.getAllWindows());
  void deliverOrganizationEntry();
  return true;
}

async function deliverOrganizationEntry() {
  if (!organizationEntryReady || !pendingOrganizationEntry) return false;
  pendingOrganizationEntry = false;
  // Server mode: this computer's own organization sign-in does not apply.
  if (serverModeEnvironment(environmentsState)) {
    slog("organization entry ignored: server mode is on");
    return false;
  }
  let delivered = false;
  await workspaceMenuAction(async () => { delivered = await organizationEntry.request(); });
  return delivered;
}

function openWorkspaceSettings(computerId) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Server mode never leaves for the local page: the server's own Settings open.
  if (serverModeEnvironment(environmentsState)) {
    mainWindow.webContents.send("app:open-settings", "organization");
    return;
  }
  if (senderIsLocal({ sender: mainWindow.webContents })) {
    mainWindow.webContents.send("workspaces:open-settings", typeof computerId === "string" ? computerId : null);
  } else {
    persistEnvironments(withActive(environmentsState, LOCAL_ID));
    navigateMainWindow(`${rendererOrigin()}/?desktop-settings=workspaces${typeof computerId === "string" ? `&share-computer=${encodeURIComponent(computerId)}` : ""}`);
  }
}

async function addServerFromClipboard() {
  try {
    return await connectHostedWorkspace(await clipboard.readText());
  } catch (error) {
    await dialog.showMessageBox({ type: "info", message: "Could not connect to the server", detail: `${error.message}\nYou can also choose Connect to a server to enter an address in Settings.` });
    return false;
  }
}

async function connectHostedWorkspace(input, name) {
  requireNotServerMode();
  const link = parseHostedWorkspaceLink(input);
  if (!link) {
    throw new Error("Enter an HTTPS server address or a full pairing link. Keep the pairing code after #, not in the URL query.");
  }
  const host = new URL(link.origin).host;
  const { response } = await dialog.showMessageBox({
    type: "question",
    buttons: ["Connect", "Cancel"],
    defaultId: 0,
    cancelId: 1,
    message: `Connect to ${host}?`,
    detail: link.code
      ? "The pairing code in the link is used once, then this app stays signed in to that server."
      : "The link has no pairing code; the server will ask for one.",
  });
  if (response !== 0) return false;
  let next = withEnvironment(environmentsState, { origin: link.origin, name }, () => randomUUID());
  const added = next.environments.find((e) => e.origin === link.origin);
  next = withActive(next, added.id);
  persistEnvironments(next);
  navigateMainWindow(link.url);
  return true;
}

/** Whether a saved server signs people in with Perspicax (its public
 * descriptor), for the Forget dialog. Unreachable reads as no. */
/** The launch screen's choice, from this computer's own server (null when
 * it does not answer). */
async function localLaunchMode() {
  try {
    const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/config`, { signal: AbortSignal.timeout(3_000), redirect: "error" });
    const mode = response.ok ? (await response.json())?.onboarding?.launchMode : null;
    return mode === "server" || mode === "solo" ? mode : null;
  } catch {
    return null;
  }
}

/** A server saved before organization servers were marked (`org: true`) is
 * drawn from the server's own page, without the desktop bridge: no floating
 * mascot, no server mode. Probe it once at launch and upgrade the save
 * (environments.cjs withOrganizationUpgrade); when the window already shows
 * that server, reload it so it gets this app's bundle and bridge. */
async function upgradeSavedOrganizationServers() {
  const pending = environmentsState.environments.filter((entry) => entry.org !== true);
  const orgOrigins = new Set();
  for (const entry of pending) if (await isOrganizationServer(entry.origin)) orgOrigins.add(entry.origin);
  const serverModeChosen = !serverModeEnvironment(environmentsState) && orgOrigins.size ? (await localLaunchMode()) === "server" : false;
  const next = withOrganizationUpgrade(environmentsState, { orgOrigins, serverModeChosen });
  if (next === environmentsState) return;
  const before = bundledOrigin(environmentsState);
  try {
    persistEnvironments(next);
  } catch (error) {
    slog(`organization server upgrade not saved: ${error?.message ?? error}`);
    return;
  }
  slog(`organization servers marked: ${[...orgOrigins].join(", ")}${serverModeEnvironment(next) ? " (server mode)" : ""}`);
  const now = bundledOrigin(next);
  if (now && now !== before && mainWindow && !mainWindow.isDestroyed()) {
    let current = null;
    try { current = new URL(mainWindow.webContents.getURL()); } catch {}
    if (current?.origin === now) navigateMainWindow(current.href);
  }
}

async function isOrganizationServer(origin) {
  try {
    const response = await fetchEnvironmentDescriptor(origin, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(3_000) });
    return response.ok && (await response.json())?.identity?.kind === "perspicax";
  } catch {
    return false;
  }
}

async function forgetEnvironment(id) {
  const env = environmentsState.environments.find((e) => e.id === id);
  if (!env) return;
  // Forgetting the server-mode server is leaving server mode.
  if (serverModeEnvironment(environmentsState)?.id === id) {
    await leaveServerMode();
    return;
  }
  const { response } = await dialog.showMessageBox({
    type: "warning",
    buttons: ["Forget", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    message: `Forget “${env.name}”?`,
    detail: forgetDetail(await isOrganizationServer(env.origin)),
  });
  if (response !== 0) return;
  sharingController().forget(env);
  const wasActive = environmentsState.activeId === id;
  persistEnvironments(withoutEnvironment(environmentsState, id));
  // Leave a removed workspace immediately; forgetting an inactive connection
  // must not reload the local app or discard a Settings form/chat draft.
  if (wasActive) navigateMainWindow(activeOrigin());
  try {
    // Revoke the session on the server while the cookie is still here.
    const response = await session.defaultSession.fetch(`${env.origin}/api/auth/logout`, { method: "POST", credentials: "include", headers: { origin: env.origin }, signal: AbortSignal.timeout(5_000), bypassCustomProtocolHandlers: true });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    slog(`forget server: logout skipped (${error?.message ?? error})`);
    await dialog.showMessageBox({ type: "warning", message: "Connection forgotten; server sign-out could not be confirmed", detail: "Computer sharing is stopped. Revoke this desktop’s session on that server when it is reachable again." });
  }
  try {
    // Logout clears this server's exact cookie. Cookie storage is host-wide,
    // not port-scoped: clearing it here would sign out other saved workspaces.
    await session.defaultSession.clearStorageData({ origin: env.origin, storages: ["localstorage", "indexdb", "serviceworkers", "cachestorage"] });
  } catch (error) {
    slog(`forget server: storage clear failed: ${error?.message ?? error}`);
  }
}

/**
 * Displays the native context menu for editable fields, links, and selections,
 * enabling paste if text or a clipboard image is available.
 *
 * @param {Electron.BrowserWindow} win - Target browser window.
 * @param {Electron.ContextMenuParams} params - Context menu parameters from Electron.
 * @returns {Promise<void>}
 */
async function showContextMenu(win, params) {
  // nothing actionable here — no menu at all, rather than a wall of
  // disabled items
  if (!params.isEditable && !params.linkURL && !params.misspelledWord && !params.selectionText) return;
  const menuItems = [];
  if (params.misspelledWord) {
    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      menuItems.push({
        label: suggestion,
        click: () => win.webContents.replaceMisspelling(suggestion),
      });
    }
    if (menuItems.length) menuItems.push({ type: "separator" });
  }
  if (params.linkURL) {
    menuItems.push(
      { label: "Copy Link", click: () => { void clipboard.writeText(params.linkURL); } },
      { type: "separator" },
    );
  }
  menuItems.push(
    { label: "Undo", role: "undo", enabled: params.editFlags.canUndo },
    { label: "Redo", role: "redo", enabled: params.editFlags.canRedo },
    { type: "separator" },
    { label: "Cut", role: "cut", enabled: params.editFlags.canCut },
    { label: "Copy", role: "copy", enabled: params.editFlags.canCopy },
    await pasteMenuItem(params, clipboard, win.webContents),
    { label: "Paste and Match Style", role: "pasteAndMatchStyle", enabled: params.editFlags.canPaste },
    { type: "separator" },
    { label: "Select All", role: "selectAll", enabled: params.editFlags.canSelectAll },
  );
  if (win.isDestroyed()) return;
  Menu.buildFromTemplate(menuItems).popup({ window: win, frame: params.frame });
}

/**
 * Creates and initializes the primary Electron browser window and configures
 * its lifecycle hooks, context menus, and navigation guards.
 *
 * @returns {void}
 */
function createWindow({ deferNavigation = false } = {}) {
  const waitsForSkinSync = process.platform === "win32";
  const primary = screen.getPrimaryDisplay();
  const displays = [primary, ...screen.getAllDisplays().filter((display) => display.id !== primary.id)];
  const restored = resolveWindowState(readWindowState(), displays.map((display) => display.workArea));
  const win = new BrowserWindow({
    ...restored.bounds,
    minWidth: MIN_BOUNDS.width,
    minHeight: MIN_BOUNDS.height,
    // The renderer restores its persisted skin before mounting React and
    // mirrors it over desktop:skin. Keep Windows hidden until that handshake
    // recolors the native caption-button overlay, otherwise a saved light
    // skin still flashes the Midnight-black block on every cold start.
    show: !waitsForSkinSync && !startupScreen,
    icon: currentWindowIcon(),
    backgroundColor: "#070707",
    autoHideMenuBar: process.platform !== "darwin",
    ...windowChromeOptions(process.platform),
    webPreferences: {
      contextIsolation: true,
      preload: path.join(__dirname, "preload.cjs"),
      // The preload exposes the full bridge only to this origin (see preload.cjs).
      // Companion client mode still serves the bundled UI from its own
      // loopback relay, so it is a trusted local page while also needing the
      // renderer's remote-only feature gates. Keep the two facts independent:
      // upstream's origin boundary must not erase the client-mode marker.
      additionalArguments: [...desktopCompanionRendererArguments(rendererOrigin(), desktopRemoteAccess),
        ...(app.isPackaged && !desktopRemoteAccess ? ["--omb-company-desktop=1"] : [])],
    },
  });
  mainWindow = win;
  win.on("show", () => desktopTray?.windowShown(win));
  win.on("close", (event) => {
    if (process.platform === "win32" && !desktopShutdownStarted && desktopTray) {
      event.preventDefault();
      desktopTray.hide(win);
    }
  });
  win.setTitle(workspaceWindowTitle(environmentsState, desktopRemoteAccess));
  win.webContents.on("page-title-updated", event => {
    if (!desktopRemoteAccess && !activeEnvironment(environmentsState)) return;
    event.preventDefault();
    win.setTitle(workspaceWindowTitle(environmentsState, desktopRemoteAccess));
  });
  attachUpdaterWindow(win);
  if (startupScreen) startupScreen.attach(win, { maximized: restored.maximized });
  else if (waitsForSkinSync) {
    // A broken renderer or preload must not strand the app as an invisible
    // process. Normal startup shows from desktop:skin almost immediately;
    // this is only the bounded recovery path.
    const skinSyncFallback = setTimeout(() => {
      if (!win.isDestroyed() && !win.isVisible()) win.show();
    }, 5_000);
    skinSyncFallback.unref?.();
    const clearSkinSyncFallback = () => clearTimeout(skinSyncFallback);
    win.once("show", clearSkinSyncFallback);
    win.once("closed", clearSkinSyncFallback);
  }
  installWindowStatePersistence(win);
  applyUnreadBadge(win);
  if (restored.maximized && !startupScreen) win.maximize();
  win.once("closed", () => {
    if (mainWindow === win) mainWindow = null;
    // the detached Hibou 98 assistant is driven by this window's page
    retroAssistantWindow.mainWindowGone();
    floatingBotWindows.mainWindowGone();
  });
  win.webContents.on("render-process-gone", () => {
    retroAssistantWindow.mainWindowGone();
    floatingBotWindows.mainWindowGone();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(externalOpenUrl(url)).catch(() => {
        console.warn("The external web link could not be opened");
      });
    } catch {
      // Reject non-web links and embedded credentials without opening them.
    }
    return { action: "deny" };
  });
  // Only the selected workspace may navigate this window. Switching is a
  // native action, not a redirect/link from a remote page to the local bridge.
  const guardNavigation = (event, url) => {
    // "Sign in with Pulsatrix" on a saved organization server: the identity
    // provider's page opens in the system browser, never in this
    // preload-bearing window nor any other of this app
    // (electron/oidc-system-sign-in.cjs).
    const loginStart = oidcSignInModule.oidcLoginStartUrl(url, environmentsState);
    if (loginStart) {
      event.preventDefault();
      void startPulsatrixSignIn(win, loginStart);
      return;
    }
    let origin = null;
    try {
      origin = new URL(url).origin;
    } catch {}
    if (workspaceNavigationAllowed(url, environmentsState, rendererOrigin())) return;
    event.preventDefault();
    slog(`blocked navigation to ${origin ?? "an invalid address"}`);
  };
  win.webContents.on("will-navigate", guardNavigation);
  win.webContents.on("will-redirect", guardNavigation);
  // Subframes: a page may not embed the local server, or any other saved
  // server, inside this preload-bearing window.
  win.webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame) return;
    let target = null;
    let page = null;
    try {
      target = new URL(details.url).origin;
      page = new URL(win.webContents.getURL()).origin;
    } catch {}
    if (!target || !page || target === page) return;
    if (target === rendererOrigin() || allowedOrigins(environmentsState, rendererOrigin()).has(target)) {
      details.preventDefault();
      slog(`blocked subframe navigation to ${details.url}`);
    }
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3: aborted by a newer navigation
    const remote = activeEnvironment(environmentsState);
    if (!remote) return;
    let origin = null;
    try {
      origin = new URL(validatedURL).origin;
    } catch {}
    if (origin !== remote.origin) return;
    // Server mode has no Local to fall back to: the page says the server is
    // unreachable and Settings > General > Server > Change still works.
    if (serverModeEnvironment(environmentsState)) {
      slog(`server-mode server unreachable (${errorDescription})`);
      return;
    }
    slog(`remote server unreachable (${errorDescription}); back to Local`);
    void dialog.showMessageBox({
      type: "warning",
      message: `${remote.name} is not reachable`,
      detail: `${errorDescription}. Showing the local server instead; choose it again from the Server menu when it is back.`,
    });
    void workspaceMenuAction(() => switchEnvironment(LOCAL_ID));
  });
  win.webContents.on("did-finish-load", () => deliverPackageInstall(win));
  win.webContents.on("did-finish-load", () => void offerComputerSharing(win));

  // Native context menu for text inputs — without this, right-click does
  // nothing in the Electron window (no Cut/Copy/Paste/Select All).
  win.webContents.on("context-menu", (_event, params) => {
    showContextMenu(win, params).catch((error) => slog(`context menu: ${error?.message ?? error}`));
  });

  // Packaged CI smoke hook. It validates the real renderer/preload bridge and
  // same-origin embedded server, then follows the normal window-close path.
  // No debugging port or sandbox override is needed.
  if (process.env.SAGAX_SMOKE_TEST === "1") {
    win.webContents.once("did-finish-load", async () => {
      try {
        const result = await win.webContents.executeJavaScript(`
          (async () => {
            if (!window.ogb?.getCapabilities) throw new Error("desktop preload bridge is unavailable");
            let crashPromise = null;
            if (${JSON.stringify(process.env.SAGAX_SMOKE_CUA === "1")}) {
              crashPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                  unsubscribe?.();
                  reject(new Error("timed out waiting for CUA crash invalidation"));
                }, 10000);
                const unsubscribe = window.ogb.onCapabilitiesChanged((next) => {
                  if (next.localComputer.reasonCode !== "daemon-exited") return;
                  clearTimeout(timeout);
                  unsubscribe();
                  resolve(next.localComputer.reasonCode);
                });
              });
            }
            const [initialCapabilities, healthResponse, ownerMutationResponse] = await Promise.all([
              window.ogb.getCapabilities(),
              fetch("/api/health"),
              fetch("/api/auth/stream-ticket", { method: "POST" }),
            ]);
            if (!healthResponse.ok) {
              throw new Error(\`health request failed: \${healthResponse.status} \${healthResponse.statusText}\`);
            }
            const health = await healthResponse.json();
            if (!ownerMutationResponse.ok) {
              throw new Error(
                \`desktop mutation capability failed: \${ownerMutationResponse.status} \${ownerMutationResponse.statusText}\`,
              );
            }
            let capabilities = initialCapabilities;
            let cuaCrashReason = null;
            let cuaRetryStatus = null;
            if (crashPromise) {
              if (!initialCapabilities.localComputer.available) {
                throw new Error("CUA was not ready before the simulated crash");
              }
              cuaCrashReason = await crashPromise;
              cuaRetryStatus = await window.ogb.localControl.retry();
              capabilities = await window.ogb.getCapabilities();
            }
            return {
              initialCapabilities,
              capabilities,
              cuaCrashReason,
              cuaRetryStatus,
              health,
              location: window.location.href,
              title: document.title,
            };
          })()
        `);
        const expectedLocation = `http://127.0.0.1:${SERVER_PORT}/`;
        if (result.location !== expectedLocation) {
          throw new Error(
            `unexpected packaged renderer URL: ${result.location} (expected ${expectedLocation})`,
          );
        }
        if (process.env.SAGAX_SMOKE_BUNDLED_CUA === "1") {
          const connection = await cuaReady;
          const expectedDriver = path.join(
            process.resourcesPath,
            "cua-linux-x64",
            "cua-driver",
          );
          let exactBundledPath = false;
          try {
            exactBundledPath =
              Boolean(connection?.driver?.path) &&
              fs.realpathSync(connection.driver.path) === fs.realpathSync(expectedDriver);
          } catch {}
          result.cuaRuntime = {
            driverSource: connection?.driver?.source,
            exactBundledPath,
            appImagePrivateStage:
              Boolean(process.env.APPIMAGE) &&
              connection?.driver?.path !== expectedDriver &&
              path.basename(path.dirname(connection?.driver?.path ?? "")).startsWith(
                APPIMAGE_CUA_STAGE_PREFIX,
              ),
            driverPath: connection?.driver?.path,
            driverVersion: connection?.driver?.version,
            daemonPid: connection?.daemon?.pid,
            socketPath: connection?.daemon?.socketPath,
            pidFile: connection?.daemon?.socketPath
              ? path.join(path.dirname(connection.daemon.socketPath), "driver.pid")
              : undefined,
            mcpEnv: connection?.mcp?.env,
          };
        }
        result.hardwareAccelerationEnabled = app.isHardwareAccelerationEnabled();
        result.displayMediaRequests = displayMediaRequestCount;
        console.log(`[smoke] renderer-ready ${JSON.stringify(result)}`);
      } catch (error) {
        console.error(`[smoke] renderer-failed ${error?.stack ?? error}`);
      } finally {
        if (process.env.SAGAX_SMOKE_KEEP_OPEN !== "1") win.close();
      }
    });
  }

  const remote = activeEnvironment(environmentsState);
  if (!serverReady && (desktopRemoteAccess || (app.isPackaged && !remote))) serverUnavailableWindows.add(win);
  // The confirmed native organisation action supplies the fixed local URL.
  if (deferNavigation) return win;
  if (desktopRemoteAccess) {
    win.loadURL(serverReady ? `http://127.0.0.1:${SERVER_PORT}` : buildErrorPage({ allPortsOccupied: serverStartConflictOnly }));
  } else if (remote) {
    void win.loadURL(remote.origin).catch(() => {});
  } else if (app.isPackaged) {
    win.loadURL(serverReady ? `http://127.0.0.1:${SERVER_PORT}` : buildErrorPage({ allPortsOccupied: serverStartConflictOnly }));
  } else {
    win.loadURL(DEV_URL);
  }
  return win;
}

// Local-control screen preview — served from the main process so the Screen
// Recording permission prompt attributes to the app, never the server
// /pair in the main window asks whether the credential in its address is the
// one this app just handed it from a sign-in return (PairPage). Only the main
// window's top frame, on the origin of that return, can claim it, once.
ipcMain.handle("auth-return:take", (event, code) => {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  if (!win || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) {
    signInLog("a page that is not the main window's top frame asked to redeem a returned credential: refused");
    return false;
  }
  let origin;
  try {
    origin = new URL(event.senderFrame.url).origin;
  } catch {
    return false;
  }
  const handed = signInHandoff.redeem(origin, code);
  signInLog(`/pair on ${origin} asked to redeem a returned credential: ${handed ? "confirmed" : "refused (not handed over, another origin or expired)"}`);
  return handed;
});

// The waiting state of "Sign in with Pulsatrix" for /pair in the main window:
// read it, cancel it, or open the browser again. Main window, top frame only.
function signInSender(event) {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
  return Boolean(win) && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
}
ipcMain.handle("pulsatrix-sign-in:state", (event) => (signInSender(event) ? signInState : { status: "idle" }));
ipcMain.handle("pulsatrix-sign-in:cancel", (event) => {
  if (!signInSender(event)) return false;
  cancelPulsatrixSignIn();
  return true;
});
ipcMain.handle("pulsatrix-sign-in:reopen", async (event) => {
  if (!signInSender(event) || !currentSignIn) return false;
  await shell.openExternal(currentSignIn.url);
  return true;
});

ipcMain.handle("screen:frame", localOnly("screen:frame", async () => {
  if (process.platform !== "darwin") return null;
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 1280, height: 800 },
  });
  return sources[0]?.thumbnail.toDataURL() ?? null;
}));

// Onboarding permission checks. Status reads are free; the mic request
// pops the real TCC prompt attributed to the app.
//
// Screen Recording deliberately has NO request path here. On macOS 15+
// every pre-grant mechanism is broken: getMediaAccessStatus("screen")
// wraps CGPreflightScreenCaptureAccess, which caches per-process (stays
// "denied" for the whole session after the user grants); a helper child
// binary gets TCC-attributed to ITSELF on macOS 26, not the app, and
// plain executables no longer appear in the Settings pane at all; and
// Sequoia+ re-prompts periodically regardless, so a pre-grant expires.
// The one reliable path is the first real in-process capture
// (screen:frame above / getDisplayMedia via the handler below) — macOS
// prompts then, attributed correctly, at the moment of actual use. The
// perm:open-settings deep link stays as the repair path for denials.
// Copy the engine command, then open a blank terminal. Renderer-controlled
// text must never become a process argument: the user reviews and pastes it.
// Returns false when the renderer should show the clipboard fallback.
ipcMain.handle("engine:open-terminal", localOnly("engine:open-terminal", async (_event, command) => {
  if (typeof command !== "string" || !command.trim()) return false;
  await clipboard.writeText(command);
  return openBlankTerminal();
}));

// Fallback for the renderer's copy button when the web Clipboard API rejects
// (unfocused page, denied permission). Plain text only; resolves false on failure.
ipcMain.handle("clipboard:write-text", localOnly("clipboard:write-text", (_event, text) => writeClipboardText(clipboard, text)));

// OAuth/connect links are returned asynchronously, after Chromium's direct
// click gesture has ended. Opening them through window.open can therefore be
// rejected as a popup before setWindowOpenHandler ever sees the URL. Keep the
// renderer sandboxed and let the main process open only ordinary web links.
// A bot's working folder: the native picker, so the path is real and the
// user never types one. Returns null when they cancel.
ipcMain.handle("desktop:pick-folder", localOnly("desktop:pick-folder", async (event, current) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const result = await dialog.showOpenDialog(win, {
    title: "Choose a working folder",
    properties: ["openDirectory", "createDirectory"],
    ...(typeof current === "string" && current ? { defaultPath: current } : {}),
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
}));

// One-click bug-report bundle. Secrets are never read; the report is
// redacted again on the way out (diagnostics.mjs). null means the user
// cancelled the save dialog.
ipcMain.handle("desktop:export-diagnostics", localOnly("desktop:export-diagnostics", async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined;
  const report = await gatherDiagnostics();
  const result = await dialog.showSaveDialog(owner, {
    title: "Export diagnostics",
    defaultPath: diagnosticsFileName(),
    filters: [{ name: "Text", extensions: ["txt"] }],
  });
  if (result.canceled || !result.filePath) return null;
  if (process.platform === "win32") {
    fs.writeFileSync(result.filePath, report, { mode: 0o600 });
  } else {
    const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW;
    const handle = fs.openSync(result.filePath, flags, 0o600);
    try {
      fs.fchmodSync(handle, 0o600);
      fs.writeFileSync(handle, report, "utf8");
    } finally {
      fs.closeSync(handle);
    }
  }
  return result.filePath;
}));

// Bots hand users files as markdown links to paths inside the Sagax
// home (workspaces, attachments). As plain anchors those resolved against the
// page origin, so the click opened http://127.0.0.1:8799<path> in the default
// browser and the server's SPA fallback answered with index.html — a second
// copy of the chat UI instead of the file. Ask where to put it and copy it
// there instead: a save dialog tells the user the file landed somewhere and
// where, which a silent copy into ~/Downloads does not. The path is
// renderer-controlled, so it must resolve inside the data folder and be a
// regular file — never a symlink escape or directory.
ipcMain.handle("desktop:save-file", localOnly("desktop:save-file", async (event, rawPath) => {
  return withSavableFile(rawPath, { home: os.homedir() }, async ({ defaultName, copyTo }) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = await defaultSaveName(app.getPath("downloads"), defaultName);
    const choice = await dialog.showSaveDialog(parent ?? undefined, {
      title: "Where do you want to save it?",
      message: "Where do you want to save it?",
      defaultPath,
      buttonLabel: "Save",
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    // Cancelling is a decision, not a failure — the bubble stays quiet.
    if (choice.canceled || !choice.filePath) return null;
    await copyTo(choice.filePath);
    shell.showItemInFolder(choice.filePath);
    return choice.filePath;
  });
}));

// Settings > Appearance > App icon. The page draws every icon through the
// system template and sends PNGs; nothing here reads a file the page names.
ipcMain.handle("app-icon:get", desktopUiOnly("app-icon:get", () => {
  const saved = savedAppIcon();
  return { platform: process.platform, id: saved?.id ?? null, updatedAt: saved?.updatedAt ?? null };
}));
ipcMain.handle("app-icon:set", desktopUiOnly("app-icon:set", (_event, request) => {
  const parsed = parseAppIconRequest(request);
  const saved = appIconStore().save(parsed, { ico: process.platform === "win32" });
  showAppIcon(saved);
  return { platform: process.platform, id: saved?.id ?? null, updatedAt: saved?.updatedAt ?? null };
}));
ipcMain.handle("app-icon:reset", desktopUiOnly("app-icon:reset", () => {
  appIconStore().clear();
  showAppIcon(null);
  return { platform: process.platform, id: null, updatedAt: null };
}));

// "Show in folder" for a bot-linked file outside its conversation's workspace.
// The file must be on this computer: a window paired to another computer's
// server is refused, because that server's paths mean nothing here.
ipcMain.handle("desktop:reveal-file", localOnly("desktop:reveal-file", async (_event, rawPath) => {
  if (desktopRemoteAccess) throw new Error("That file is on the computer this app is connected to");
  return revealInFolder(rawPath, { reveal: (target) => shell.showItemInFolder(target) });
}));

// The renderer owns the skin, including the Windows caption buttons it draws
// itself (titleBarStyle hidden, no native overlay). Keep syncing the window
// background so a light skin never flashes the Midnight-black cold start.
ipcMain.handle("desktop:skin", (event, skin) => {
  if (!isKnownSkin(skin)) return false;
  try {
    const { color } = skinChrome(skin);
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (win && !win.isDestroyed()) {
      try { win.setBackgroundColor(color); } catch {}
      // Hibou 98 draws its own title bar; keep the lights inside it.
      const lights = trafficLightsForSkin(process.platform, skin);
      if (lights) {
        try { win.setWindowButtonPosition?.(lights); } catch {}
      }
    }
  } catch {}
  return true;
});

// Hibou 98: the assistant detached from the window, on its own always-on-top
// window. The main page drives it; see electron/retro-assistant-window.mjs.
const RETRO_ASSISTANT_POSITIONS = () => path.join(app.getPath("userData"), "retro-assistant-position.json");
const retroAssistantWindow = createRetroAssistantWindow({
  BrowserWindow,
  screen,
  ipcMain,
  Menu,
  getMainWindow: () => mainWindow,
  isTrustedMain: (event) => isDesktopUiSender(event),
  pageUrl: () => `${detachedPageOrigin()}/?${DETACHED_QUERY}`,
  session: detachedUiSessionIfNeeded,
  preload: path.join(__dirname, "retro-assistant-preload.cjs"),
  readPositions: () => JSON.parse(fs.readFileSync(RETRO_ASSISTANT_POSITIONS(), "utf8")),
  writePositions: (positions) => fs.writeFileSync(RETRO_ASSISTANT_POSITIONS(), JSON.stringify(positions), { mode: 0o600 }),
  log: (line) => slog(line),
});

// Floating bots: any bot put "on the desktop" from its right-click menu, one
// always-on-top window per bot. The main page is the brain and does every API
// call; see electron/floating-bot-window.mjs.
const FLOATING_BOT_POSITIONS = () => path.join(app.getPath("userData"), "floating-bot-positions.json");
const floatingBotWindows = createFloatingBotWindows({
  whenReady: () => app.whenReady(),
  // development: the page comes from Vite, which may not answer yet at launch
  ...(app.isPackaged ? {} : { waitForPage: (url) => waitForFloatingPage(url) }),
  BrowserWindow,
  screen,
  ipcMain,
  getMainWindow: () => mainWindow,
  isTrustedMain: (event) => isDesktopUiSender(event),
  pageUrl: () => `${detachedPageOrigin()}/?${FLOATING_QUERY}`,
  session: detachedUiSessionIfNeeded,
  preload: path.join(__dirname, "floating-bot-preload.cjs"),
  readPositions: () => JSON.parse(fs.readFileSync(FLOATING_BOT_POSITIONS(), "utf8")),
  writePositions: (positions) => fs.writeFileSync(FLOATING_BOT_POSITIONS(), JSON.stringify(positions), { mode: 0o600 }),
  focusMain: () => {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  },
  log: (line) => {
    slog(line);
    // in development the floating windows' troubles show in the terminal too
    if (!app.isPackaged) console.log(`[floating-bots] ${line}`);
  },
});

// Caption controls for the overlay-less frameless window. The renderer's
// buttons are the only way to act on the window, so the channels stay
// open for the local page; a remote server's page never has them.
for (const [channel, act] of [
  ["window:minimize", (win) => win.minimize()],
  ["window:toggle-maximize", (win) => (win.isMaximized() ? win.unmaximize() : win.maximize())],
  ["window:close", (win) => win.close()],
]) {
  ipcMain.handle(channel, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!win || win.isDestroyed()) return false;
    act(win);
    return true;
  });
}
ipcMain.handle("window:state", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
  return { maximized: Boolean(win && !win.isDestroyed() && win.isMaximized()) };
});

ipcMain.handle("desktop:open-external", desktopUiOnly("desktop:open-external", async (_event, rawUrl) => {
  await shell.openExternal(externalWebUrl(rawUrl));
  return true;
}));

// The Boat VNC viewer must be a top-level page for its token exchange. A
// sandboxed modal BrowserWindow satisfies that requirement while keeping the
// live desktop inside Sagax instead of sending the person to a browser.
ipcMain.handle("desktop-viewer:open", localOnly("desktop-viewer:open", (event, rawUrl, title, contextId) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  return openDesktopViewer(owner, rawUrl, title, contextId);
}));

// Two Local VM desktops share the existing app BrowserWindow. The renderer
// supplies only layout and intent; URL validation, sandboxing, session
// isolation and the one-interactive-pane invariant stay in the main process.
ipcMain.handle("desktop-workspace:open", localOnly("desktop-workspace:open", (event, input) =>
  desktopWorkspaceForEvent(event, true).open(input),
));
ipcMain.handle("desktop-workspace:layout", localOnly("desktop-workspace:layout", (event, items) => {
  const manager = desktopWorkspaceForEvent(event);
  if (!manager) return false;
  return manager.layout(items);
}));
ipcMain.handle("desktop-workspace:set-interactive", localOnly("desktop-workspace:set-interactive", (event, contextId) => {
  const manager = desktopWorkspaceForEvent(event);
  if (!manager) return contextId == null;
  return manager.setInteractive(contextId);
}));
ipcMain.handle("desktop-workspace:close", localOnly("desktop-workspace:close", (event, contextId) => {
  const manager = desktopWorkspaceForEvent(event);
  if (!manager) return true;
  return manager.close(contextId);
}));

// Close only when the caller owns the current viewer — otherwise one bot's
// "Hand control back" would close (and release) another bot's viewer.
ipcMain.handle("desktop-viewer:close", localOnly("desktop-viewer:close", (_event, contextId) => {
  const scoped = Object.prototype.toString.call(contextId) === "[object String]" ? contextId : null;
  if (scoped !== desktopViewerContextId) return false;
  if (desktopViewerWindow && !desktopViewerWindow.isDestroyed()) desktopViewerWindow.close();
  return true;
}));

// Lets a (re)mounted panel seed viewer-open state instead of defaulting to false.
ipcMain.handle("desktop-viewer:state-now", localOnly("desktop-viewer:state-now", () => ({
  open: Boolean(desktopViewerWindow && !desktopViewerWindow.isDestroyed()),
  contextId: desktopViewerContextId,
})));

// The session's permission handlers (app-permissions.mjs), set once the app
// is ready. perm:status asks them, so `pageMic` is the very rule that decides
// a page's microphone request: a blocked Live call then says whether this app
// refused the page (a web browser can make the call) or the computer did.
let appPermissions = null;
ipcMain.handle("perm:status", (event) => ({
  mic:
    nativeActions.appleMediaPermissions
      ? systemPreferences.getMediaAccessStatus?.("microphone") ?? "unknown"
      : "unsupported",
  pageMic: appPermissions?.pageMicrophone(event) ?? "refused",
}));
ipcMain.handle("perm:request-mic", localOnly("perm:request-mic", async () => {
  if (!nativeActions.appleMediaPermissions) return false;
  try {
    return await systemPreferences.askForMediaAccess("microphone");
  } catch {
    return false;
  }
}));

// macOS never re-prompts a denied permission — the only path is System
// Settings; deep-link straight to the right privacy pane.
ipcMain.handle("perm:open-settings", localOnly("perm:open-settings", (_event, pane) => {
  if (!nativeActions.applePrivacySettings) return false;
  const panes = {
    mic: "Privacy_Microphone",
    screen: "Privacy_ScreenCapture",
    speech: "Privacy_SpeechRecognition",
    accessibility: "Privacy_Accessibility",
  };
  // own-property lookup only — a renderer-supplied "__proto__"/"constructor"
  // would otherwise resolve up the prototype chain to a truthy object
  const anchor = Object.hasOwn(panes, pane) ? panes[pane] : "Privacy";
  return shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${anchor}`);
}));

ipcMain.handle("desktop:relaunch", localOnly("desktop:relaunch", (event) => {
  requireMainWindowSender(event);
  relaunchAfterDesktopRemoteChange();
  return true;
}));

ipcMain.handle("speech:start", localOnly("speech:start", (event, options) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (!nativeActions.appleSpeech) {
    win.webContents.send("speech:end", { code: 2, reason: "unsupported-platform" });
    return;
  }
  startSpeech(win, options);
}));
ipcMain.handle("speech:stop", localOnly("speech:stop", () => {
  if (nativeActions.appleSpeech) stopSpeech();
}));
ipcMain.handle("speech:finish", localOnly("speech:finish", () => {
  if (nativeActions.appleSpeech) finishSpeech();
}));

// ── companion sidecar ──────────────────────────────────────────────────
// The renderer gets these five and nothing else: it can turn the companion
// on and off, look at it, open or cancel a pairing window, and remove a
// device. It cannot reach the sidecar's control port itself.
ipcMain.handle("companion:state", localOnly("companion:state", () => desktopCompanionState()));
/** An enrolled organisation can turn remote access off. That refuses turning
 * the companion on and opening new pairings; it adds no prompt, and phones
 * that are already paired keep working until someone revokes them. */
function managedRemoteAccessRefusal() {
  const policy = managedDesktop?.policy?.();
  return policy?.remoteAccess === false ? `${policy.organizationName} does not allow remote access to this computer.` : null;
}
ipcMain.handle("companion:start", localOnly("companion:start", () => startDesktopCompanion()));
ipcMain.handle("companion:stop", localOnly("companion:stop", () => stopDesktopCompanion()));
ipcMain.handle("companion:keep-awake", localOnly("companion:keep-awake", async (_event, enabled) => {
  rememberCompanionKeepAwake(Boolean(enabled));
  return desktopCompanionState();
}));
// ── keep awake for routines ────────────────────────────────────────────
// The Automations page shows the hold and owns the toggle; the decision
// itself stays in the main process with the power assertion.
ipcMain.handle("routines:wake-state", localOnly("routines:wake-state", () => routineWake.poll()));
ipcMain.handle("routines:keep-awake", localOnly("routines:keep-awake", async (_event, enabled) => {
  rememberRoutineWake(app.getPath("userData"), Boolean(enabled));
  return routineWake.poll();
}));
ipcMain.handle("companion:refresh-tailscale", localOnly("companion:refresh-tailscale", () => refreshDesktopCompanionTailscale()));
ipcMain.handle("companion:pairing", localOnly("companion:pairing", (_event, open, expectedToken) => {
  const refusal = open ? managedRemoteAccessRefusal() : null;
  if (refusal) throw new Error(refusal);
  return companionPairing(Boolean(open), expectedToken).then(decorateDesktopCompanionState);
}));
ipcMain.handle("companion:cloud-desktop", localOnly("companion:cloud-desktop", (_event, deviceId, allowed) =>
  companionCloudDesktopAccess(deviceId, Boolean(allowed)).then(() => desktopCompanionState()),
));
ipcMain.handle("companion:browser-control", localOnly("companion:browser-control", (_event, deviceId, allowed) =>
  companionBrowserControlAccess(deviceId, Boolean(allowed)).then(() => desktopCompanionState()),
));
ipcMain.handle("companion:revoke", localOnly("companion:revoke", (_event, deviceId) =>
  companionRevoke(deviceId).then(() => desktopCompanionState()),
));

function publicDesktopRemoteState() {
  return desktopRemoteAccess
    ? {
        active: true,
        endpoint: desktopRemoteAccess.endpoint,
        serverName: desktopRemoteAccess.serverName,
        deviceId: desktopRemoteAccess.deviceId,
      }
    : { active: false };
}

function requireMainWindowSender(event) {
  const sender = BrowserWindow.fromWebContents(event.sender);
  if (!sender || sender !== mainWindow || sender.isDestroyed() ||
      !event.senderFrame || event.senderFrame !== event.sender.mainFrame) {
    throw new Error("The desktop client window is unavailable");
  }
}

function relaunchAfterDesktopRemoteChange() {
  if (desktopShutdownStarted) return;
  desktopShutdownStarted = true;
  const timer = setTimeout(() => {
    // Electron's default uses its original native argv, not the JS array
    // from which we consumed the one-shot organisation action.
    app.relaunch({ args: process.argv.slice(1) });
    app.quit();
  }, 250);
  timer.unref?.();
}

ipcMain.handle("desktop-remote:state", () => publicDesktopRemoteState());
ipcMain.handle("desktop-remote:pair", localOnly("desktop-remote:pair", async (event, endpoint, code) => {
  requireMainWindowSender(event);
  const access = await pairDesktopCompanion({
    endpoint,
    code,
    deviceName: `${installationDisplayName()} desktop`,
  });
  await updateSecureCredentialDocument((credentials) => withoutOrganizationRestartIntent(withDesktopCompanionAccess(credentials, access)));
  desktopRemoteAccess = access;
  relaunchAfterDesktopRemoteChange();
  return publicDesktopRemoteState();
}));
ipcMain.handle("desktop-remote:disconnect", localOnly("desktop-remote:disconnect", async (event) => {
  requireMainWindowSender(event);
  await updateSecureCredentialDocument(withoutDesktopCompanionAccess);
  desktopRemoteAccess = null;
  relaunchAfterDesktopRemoteChange();
  return { active: false };
}));

// Auth and connector credentials never cross this boundary. Every handler
// returns the same deliberately tiny, secret-free public account state.
ipcMain.handle("companion-account:state", localOnly("companion-account:state", () => ensureCompanionAccountService().state()));
ipcMain.handle("companion-account:request-code", localOnly("companion-account:request-code", (_event, email) =>
  ensureCompanionAccountService().requestCode(email),
));
ipcMain.handle("companion-account:verify-code", localOnly("companion-account:verify-code", (_event, email, code) =>
  ensureCompanionAccountService().verifyCode(email, code),
));
ipcMain.handle("companion-account:retry", localOnly("companion-account:retry", () => ensureCompanionAccountService().retry()));
ipcMain.handle("companion-account:sign-out", localOnly("companion-account:sign-out", () => ensureCompanionAccountService().signOut()));

const workspaceOnly = (handler) => (event, ...args) => {
  if (!workspaceSenderAllowed(event, mainWindow?.webContents, environmentsState, rendererOrigin())) throw new Error("These controls are only available in the main desktop window");
  return handler(event, ...args);
};
const localWorkspaceOnly = (channel, handler) => localOnly(channel, workspaceOnly(handler));

ipcMain.handle("organization:settings-opened", localWorkspaceOnly("organization:settings-opened", () => organizationEntry.settingsOpened()));
ipcMain.handle("organization:state", localWorkspaceOnly("organization:state", () => ensureManagedDesktop().state()));
ipcMain.handle("organization:begin", localWorkspaceOnly("organization:begin", (_event, input) => ensureManagedDesktop().begin(input)));
// Reopens only the pending attempt's own sign-in page: no renderer input.
ipcMain.handle("organization:reopen", localWorkspaceOnly("organization:reopen", () => ensureManagedDesktop().reopen()));
ipcMain.handle("organization:cancel", localWorkspaceOnly("organization:cancel", () => ensureManagedDesktop().cancelEnrollment()));
ipcMain.handle("organization:refresh", localWorkspaceOnly("organization:refresh", () => ensureManagedDesktop().refresh()));
ipcMain.handle("organization:disconnect", localWorkspaceOnly("organization:disconnect", () => {
  companyBackupConfigurationRevision++;
  companyBackupController?.abort(); preparedCompanyRestore = null;
  const client = ensureManagedDesktop();
  // Disconnecting pauses the daily schedule instead of deleting it, so
  // reconnecting the same organisation as the same person resumes it. Turning
  // daily backups off in Settings → Backups is what ends it.
  return client.disconnect();
}));
ipcMain.on("company-backups:client-state", receiveCompanyBackupClientState);
ipcMain.handle("company-backups:configure-schedule", localWorkspaceOnly("company-backups:configure-schedule", async (_event, input) => {
  ensureManagedDesktop();
  const revision = ++companyBackupConfigurationRevision;
  if (input?.enabled === true) {
    const scope = companyBackupScope(), proc = serverProc;
    if (!scope || companyBackupController || preparedCompanyRestore || companyRestoreCommitting) throw companyBackupDeferred();
    const status = await localBackupStatus(proc), current = companyBackupScope();
    if (revision !== companyBackupConfigurationRevision || status.busy || status.pendingRestore || !current || scope.key !== current.key || scope.generation !== current.generation ||
        companyBackupController || preparedCompanyRestore || companyRestoreCommitting) throw companyBackupDeferred();
  }
  await companyBackupSchedule.configure(input);
  return { ...companyBackupState, schedule: companyBackupSchedule.state() };
}));
ipcMain.handle("company-backups:state", localWorkspaceOnly("company-backups:state", async () => {
  const status = await localBackupStatus(serverProc);
  return { ...companyBackupState, pendingRestore: status.pendingRestore };
}));
ipcMain.handle("company-backups:list", localWorkspaceOnly("company-backups:list", () => ensureManagedDesktop().requestBackup("/api/desktop/backups")));
ipcMain.handle("company-backups:create", localWorkspaceOnly("company-backups:create", (_event, input) => runCompanyBackup("backup", input)));
ipcMain.handle("company-backups:preview", localWorkspaceOnly("company-backups:preview", (_event, input) => runCompanyBackup("restore", input)));
ipcMain.handle("company-backups:cancel", localWorkspaceOnly("company-backups:cancel", () => { companyBackupController?.abort(); }));
ipcMain.handle("company-backups:delete", localWorkspaceOnly("company-backups:delete", (_event, input) => {
  if (companyBackupController || input?.confirmation !== "DELETE" || !/^[a-f0-9-]{36}$/.test(input?.id)) throw new Error("Confirm the exact backup to delete when no transfer is running.");
  return ensureManagedDesktop().requestBackup(`/api/desktop/backups/${input.id}`, { method: "DELETE" });
}));
ipcMain.handle("company-backups:restore", localWorkspaceOnly("company-backups:restore", async (_event, input) => {
  const client = ensureManagedDesktop(), connection = client.connection();
  if (companyBackupController || companyRestoreCommitting || !preparedCompanyRestore || preparedCompanyRestore.id !== input?.id || input?.confirmation !== "REPLACE" ||
      !connection || client.state().status !== "connected" || !client.state().cloudBackups || connection.expiresAt <= Date.now() ||
      preparedCompanyRestore.proc !== serverProc || preparedCompanyRestore.deviceId !== connection.deviceId) throw new Error("Preview this backup again and type REPLACE to confirm.");
  // Consume the preview before yielding; duplicate IPC cannot commit it twice.
  // On an uncertain response the existing local backup status is authoritative.
  preparedCompanyRestore = null;
  companyRestoreCommitting = true;
  try {
    const response = await localBackupRequest(serverProc, "/api/workspace-backup/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: input.id, confirmation: "REPLACE" }) });
    if (!response.ok) throw new Error("This installation could not be replaced. Check local backup status before trying again.");
    publishCompanyBackupState({ busy: false, pendingRestore: true });
    return await response.json();
  } finally { companyRestoreCommitting = false; }
}));


const savedWorkspace = id => {
  const env = environmentsState.environments.find(entry => entry.id === id);
  if (!env) throw new Error("This server is no longer connected");
  return env;
};
// Share this computer: the local page for any saved server, and in server
// mode the organization server's page drawn from this app's bundle, for that
// server only (the person decides there what their own computer lends).
const sharingUiOnly = (channel, handler) => desktopUiOnly(channel, workspaceOnly((event, id, ...rest) => {
  if (!senderIsLocal(event)) {
    const locked = serverModeEnvironment(environmentsState);
    if (!locked || (id !== undefined && id !== locked.id)) throw new Error(`${channel} is only available for this server`);
  }
  return handler(event, id, ...rest);
}));
ipcMain.handle("sharing:state", sharingUiOnly("sharing:state", async (_event, id) => {
  await requireSharedComputers();
  return sharingController().state(savedWorkspace(id).id);
}));
ipcMain.handle("sharing:folder", sharingUiOnly("sharing:folder", async () => {
  await requireSharedComputers();
  const picked = await dialog.showOpenDialog(mainWindow, { title: "Choose a folder to share", properties: ["openDirectory"] });
  if (picked.canceled || !picked.filePaths[0]) return null;
  return (await validateSharedFolders([{ id: randomUUID(), path: picked.filePaths[0], write: false }]))[0];
}));
ipcMain.handle("sharing:revoke", sharingUiOnly("sharing:revoke", async (_event, id) => {
  await requireSharedComputers();
  return sharingController().revoke(savedWorkspace(id));
}));
// What that server's bots did here: the local log, never a server's claim.
ipcMain.handle("sharing:activity", sharingUiOnly("sharing:activity", async (_event, id) => {
  await requireSharedComputers();
  return sharingController().activity(savedWorkspace(id).id, 50);
}));
ipcMain.handle("sharing:save", sharingUiOnly("sharing:save", async (_event, id, input) => {
  await requireSharedComputers();
  const env = savedWorkspace(id);
  const info = await sharingController().identity(env);
  const folders = await validateSharedFolders(input?.folders);
  const detail = [
    `Server: ${env.origin}`,
    ...folders.map(folder => `${folder.write ? "Read and write" : "Read only"}: ${folder.path}`),
    input?.terminal === true ? "Terminal: UNRESTRICTED commands as your user. Can access files outside the folders above, including credentials." : "Terminal: off",
    input?.computer === true ? "Computer control: can view your screen and operate logged-in apps. Can access information outside the folders above." : "Computer control: off",
    "Shared content is sent to this server and may reach its model provider. Bots on this server can use these permissions until you revoke them. Closing the desktop stops access.",
  ].join("\n\n");
  const confirmation = await dialog.showMessageBox(mainWindow, { type: "warning", message: `Allow computer access for ${env.name}?`, detail, buttons: ["Allow access", "Cancel"], defaultId: 1, cancelId: 1 });
  if (confirmation.response !== 0) return null;
  savedWorkspace(id);
  return sharingController().save(env, { folders, terminal: input?.terminal === true, computer: input?.computer === true }, info);
}));

// window.confirm() has no parent window, so window managers (notably tiling
// ones on Linux) can't center it — it lands at a default screen origin
// instead of over the app. Route renderer confirms through the main process
// so dialog.showMessageBox can anchor it to mainWindow.
// "Join a Perspicax server" (slice 8, electron/org-join.mjs). probe and stage
// answer the local page only. The others answer only the main frame of the
// active saved server, and org-join itself checks that this origin is the
// one the copy was staged for.
const orgJoin = createOrgJoin({
  fetch: (url, init) => fetch(url, init),
  parseLink: (address) => parseHostedWorkspaceLink(address),
  // Probed first (org-join.mjs): an organization server, so the desktop
  // draws its own UI there (org: true). The launch screen's Server locks the
  // app to it (server mode).
  saveEnvironment: (origin, options) => {
    requireNotServerMode();
    let next = withEnvironment(environmentsState, { origin, name: new URL(origin).host, org: true }, () => randomUUID());
    const entry = next.environments.find((candidate) => candidate.origin === origin);
    if (!entry) throw new Error("The server could not be saved.");
    next = options?.serverMode === true ? withServerMode(next, entry.id) : withActive(next, entry.id);
    persistEnvironments(next);
  },
  navigate: (url) => navigateMainWindow(url),
  confirm: async (names) => {
    const { response } = await dialog.showMessageBox({
      type: "warning",
      buttons: ["Remove", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: names.length === 1 ? `Remove “${names[0]}” from this computer?` : `Remove ${names.length} bots from this computer?`,
      detail: `${names.join("\n")}\n\nTheir copies in the organization stay. This removes them and their conversations from this computer only.`,
    });
    return response === 0;
  },
  deleteLocalBot: async (key) => {
    const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/bots/${encodeURIComponent(key)}`, {
      method: "DELETE", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(15_000),
      headers: { [DESKTOP_MUTATION_HEADER]: desktopMutationToken ?? "" },
    }).catch(() => null);
    return Boolean(response?.ok);
  },
  postLinkedSubject: async (input) => {
    const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/identity/linked-subjects`, {
      method: "POST", redirect: "error", credentials: "omit", signal: AbortSignal.timeout(5_000),
      headers: { "content-type": "application/json", [DESKTOP_MUTATION_HEADER]: desktopMutationToken ?? "" },
      body: JSON.stringify(input),
    }).catch(() => null);
    if (!response?.ok) slog(`org join: the linked organization account could not be recorded (${response?.status ?? "unreachable"})`);
  },
  // The launch screen's Server mode: the same "Sign in with Pulsatrix" the
  // server's /pair page starts, on the server join just saved and selected.
  signIn: async (origin) => {
    if (!mainWindow || mainWindow.isDestroyed()) throw new Error("no main window");
    await startPulsatrixSignIn(mainWindow, `${origin}${oidcSignInModule.OIDC_START_PATH}`);
  },
});
/** The origin of a call from the active saved server's main frame, or null. */
function orgJoinSender(event) {
  const active = activeEnvironment(environmentsState);
  if (!active || !workspaceSenderAllowed(event, mainWindow?.webContents, environmentsState, rendererOrigin())) return null;
  try {
    const origin = new URL(event.senderFrame.url).origin;
    return origin === active.origin ? origin : null;
  } catch {
    return null;
  }
}
const orgJoinRemote = (handler) => (event, ...args) => {
  const origin = orgJoinSender(event);
  if (!origin) throw new Error("No copy was staged for this server.");
  return handler(origin, ...args);
};
ipcMain.handle("org-join:probe", localWorkspaceOnly("org-join:probe", (_event, address) => orgJoin.probe(address)));
ipcMain.handle("org-join:stage", localWorkspaceOnly("org-join:stage", (_event, input) => orgJoin.stage(input)));
ipcMain.handle("org-join:join", localWorkspaceOnly("org-join:join", (_event, input) => orgJoin.join(input)));
ipcMain.handle("org-join:staged", (event) => {
  const origin = orgJoinSender(event);
  return origin ? orgJoin.staged(origin) : null;
});
ipcMain.handle("org-join:take", (event) => {
  const origin = orgJoinSender(event);
  return origin ? orgJoin.take(origin) : null;
});
ipcMain.handle("org-join:take-preferences", (event) => {
  const origin = orgJoinSender(event);
  return origin ? orgJoin.takePreferences(origin) : null;
});
ipcMain.handle("org-join:finished", orgJoinRemote((origin, input) => orgJoin.finished(origin, input)));
ipcMain.handle("org-join:remove-local", orgJoinRemote((origin, keys) => orgJoin.removeLocal(origin, keys)));
ipcMain.handle("dialog:confirm", desktopUiOnly("dialog:confirm", workspaceOnly(async (_event, message) => {
  if (typeof message !== "string" || !message.trim() || message.length > 4096 || !mainWindow || mainWindow.isDestroyed()) return false;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    message,
    buttons: ["OK", "Cancel"],
    defaultId: 1,
    cancelId: 1,
  });
  return response === 0;
})));

// Server mode: the page asks which organization server this app is locked
// to, and leaves through the same confirmation as the Server menu. This
// app's own UI only (the local page, or the bundle on that server).
ipcMain.handle("server-mode:state", desktopUiOnly("server-mode:state", workspaceOnly(() => {
  const locked = serverModeEnvironment(environmentsState);
  return locked ? { active: true, id: locked.id, name: locked.name, origin: locked.origin } : { active: false };
})));
ipcMain.handle("server-mode:leave", desktopUiOnly("server-mode:leave", workspaceOnly(() => leaveServerMode())));
// The model picker opened: probe this computer's loopback model servers now
// (a server started after launch shows up) and publish the ids. Nothing
// comes back to the page: it reloads the server's catalog afterwards.
ipcMain.handle("server-mode:refresh-local-models", desktopUiOnly("server-mode:refresh-local-models", workspaceOnly(async () => {
  if (!serverModeEnvironment(environmentsState)) return { refreshed: false };
  await desktopBridge().refreshLocalModels();
  return { refreshed: true };
})));
// The preload asks once per page whether it is this app's bundle drawn on
// the active organization server (bundled-ui.cjs): only then does it expose
// the desktop-UI parts of the bridge. The main window's top frame only.
ipcMain.on("workspace:bundled-ui", (event) => {
  let bundled = false;
  try {
    const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
    bundled = Boolean(win && currentBundledOrigin && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame &&
      new URL(event.senderFrame.url).origin === currentBundledOrigin);
  } catch {
    bundled = false;
  }
  event.returnValue = bundled;
});

ipcMain.handle("environments:state", localWorkspaceOnly("environments:state", (event) => ({
  localOrigin: rendererOrigin(),
  remote: !senderIsLocal(event),
  activeId: environmentsState.activeId,
  environments: environmentsState.environments,
})));
ipcMain.handle("environments:switch", localWorkspaceOnly("environments:switch", (_event, id) => switchEnvironment(typeof id === "string" ? id : LOCAL_ID)));
ipcMain.handle("environments:add-from-link", localWorkspaceOnly("environments:add-from-link", (_event, link, name) => {
  return connectHostedWorkspace(link, typeof name === "string" ? name : undefined);
}));
ipcMain.handle("environments:forget", localWorkspaceOnly("environments:forget", (_event, id) => forgetEnvironment(typeof id === "string" ? id : "")));

// A cloud page can ask for the native chooser, not choose a destination or
// mutate the desktop's saved list. Only native menu clicks perform those acts.
ipcMain.handle("workspaces:state", workspaceOnly(() => workspaceSummary(environmentsState)));
let workspaceMenuOpen = false;
ipcMain.handle("workspaces:menu", workspaceOnly(async () => {
  if (workspaceMenuOpen) return;
  workspaceMenuOpen = true;
  try {
    const menu = Menu.buildFromTemplate(workspaceMenuTemplate(environmentsState, {
      onSwitch: (id) => void workspaceMenuAction(() => switchEnvironment(id)),
      onConnect: () => void workspaceMenuAction(openWorkspaceSettings),
      onForget: (id) => void workspaceMenuAction(() => forgetEnvironment(id)),
      onLeaveServerMode: () => void workspaceMenuAction(leaveServerMode),
    }));
    await new Promise((resolve) => menu.popup({ window: mainWindow, callback: resolve }));
  } finally {
    workspaceMenuOpen = false;
  }
}));

ipcMain.handle("desktop:capabilities", async (event) =>
  desktopCapabilities({
    remote: !senderIsLocal(event),
    platform: process.platform,
    env: process.env,
    packaged: app.isPackaged,
    localConnection: await cuaReady,
  }),
);

const CREDENTIAL_PATCH = {
  composioApiKey: (value) => ({ composio: { apiKey: value } }),
  xaiApiKey: (value) => ({ xai: { key: value } }),
  boxToken: (value) => ({ box: { token: value } }),
  opencodeGoApiKey: (value) => ({ opencodeGo: { apiKey: value } }),
  ttsKey: (value) => ({ tts: { key: value } }),
  fishAudioKey: (value) => ({ tts: { fishKey: value } }),
  xaiVoiceKey: (value) => ({ tts: { xaiKey: value } }),
  jevApiKey: (value) => ({ decider: { key: value } }),
  openaiImageApiKey: (value) => ({ imageGen: { key: value } }),
  customImageApiKey: (value) => ({ imageGen: { customApiKey: value } }),
  openaiLiveKey: (value) => ({ live: { key: value } }),
};

async function saveWorkspaceCredential(name, value) {
  const patchFor = CREDENTIAL_PATCH[name];
  if (!patchFor || typeof value !== "string") {
    throw new Error("Unsupported credential");
  }
  if (app.isPackaged && !(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error("The operating-system credential store is unavailable");
  }
  const secret = value.trim();
  const applyToHarness = async () => {
    if (app.isPackaged && !serverReady) throw new Error("The embedded bot server is unavailable");
    // In development the server is a separately launched process, so it
    // cannot receive credentials from Electron at boot. Keep its established
    // local config path there; production always uses the encrypted store.
    const secretStorage = app.isPackaged ? "?secretStorage=external" : "";
    const response = await fetch(`http://127.0.0.1:${SERVER_PORT}/api/config${secretStorage}`, {
      method: "PUT",
      headers: desktopServerHeaders(
        { "content-type": "application/json" },
        { packaged: app.isPackaged, token: desktopMutationToken },
      ),
      body: JSON.stringify(patchFor(secret)),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || `Could not save credential (HTTP ${response.status})`);
    return body;
  };
  if (!app.isPackaged) return applyToHarness();

  // Commit the encrypted value before the server makes it live. The shared
  // state rolls credentials.bin back if validation/reload fails, while also
  // keeping concurrent account and provider updates serialized.
  return updateSecureCredentialDocument(
    (credentials) => {
      if (secret) credentials[name] = secret;
      else delete credentials[name];
      return credentials;
    },
    applyToHarness,
  );
}

ipcMain.handle("credential:set", localOnly("credential:set", (_event, name, value) =>
  saveWorkspaceCredential(name, value),
));

ipcMain.handle("approvals:set-trusted-mode", localOnly("approvals:set-trusted-mode", (_event, botId, mode, options) => {
  // Development uses a separately launched server, which is intentionally
  // outside this trust path. Never degrade this grant to loopback HTTP.
  if (!app.isPackaged || !serverProc) {
    throw new Error("Full and Custom approval modes require the embedded desktop server");
  }
  return trustedApprovalMode.request(serverProc, botId, mode, options);
}));

async function broadcastDesktopCapabilities() {
  const localConnection = await cuaReady;
  const build = (remote) =>
    desktopCapabilities({ remote, platform: process.platform, env: process.env, packaged: app.isPackaged, localConnection });
  const local = build(false);
  let redacted = null;
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    let isLocal = false;
    try {
      isLocal = new URL(window.webContents.getURL()).origin === rendererOrigin();
    } catch {}
    if (!isLocal) redacted ??= build(true);
    window.webContents.send("desktop:capabilities-changed", isLocal ? local : redacted);
  }
}

setCuaStateListener((connection) => {
  cuaReady = Promise.resolve(connection);
  void broadcastDesktopCapabilities().catch((error) => {
    console.error("[desktop] capability broadcast failed:", error);
  });
});

app.whenReady().then(async () => {
  installSessionBlock(session.defaultSession, (line) => slog(`network: ${line}`));
  // Cached-before-the-fix attachment responses outlive `no-store`: entries
  // stored under the old one-year immutable policy can replay to a second
  // identity in this profile without the visibility gate re-running. The
  // first launch of each new version empties the HTTP cache, before any
  // window could serve one of those entries.
  await evictStartupCacheOnce({
    userData: app.getPath("userData"),
    currentVersion: app.getVersion(),
    clearCache: () => session.defaultSession.clearCache(),
    log: slog,
  });
  if (process.platform === "win32") {
    try {
      desktopTray = createSystemTray({
        Tray, Menu, nativeImage, iconPath: APP_ICON,
        getWindow: () => startupScreen?.window ?? mainWindow,
        onQuit: () => app.quit(),
      });
    } catch (error) {
      // A missing tray must leave a working close/quit path.
      slog(`system tray unavailable: ${error?.message ?? error}`);
    }
  }
  startupScreen = createStartupScreen({
    BrowserWindow, iconPath: APP_ICON, isQuitting: () => desktopShutdownStarted,
    onQuit: () => app.quit(),
    onHide: desktopTray ? (win) => desktopTray.hide(win) : undefined,
    isHidden: () => desktopTray?.isHidden() ?? false,
    onShow: (win) => desktopTray?.windowShown(win),
    onFinished: () => { startupScreen = null; },
    onOpenLogs: () => {
      fs.mkdirSync(LOG_DIR, { recursive: true });
      void shell.openPath(LOG_DIR).then((error) => { if (error) slog(`startup: open logs failed: ${error}`); });
    },
    onRetry: () => {
      slog("startup: retry requested from the loading screen");
      app.relaunch();
      app.quit();
    },
  });
  await startupScreen.ready;
  startupPhase("loading screen shown");
  if (desktopShutdownStarted) return;
  session.defaultSession.on("will-download", (_event, item) => {
    item.setSavePath(collisionFreeDownloadPath(app.getPath("downloads"), item.getFilename()));
    revealDownloadWhenDone(item, (filePath) => shell.showItemInFolder(filePath));
  });
  if (app.isPackaged) {
    try {
      // Acquire before either plaintext credential migration reads or writes
      // config.json. The parent retains ownership across utility-child port
      // fallbacks and restarts for the entire desktop process lifetime.
      desktopDataDirLease = acquireDataDirLease(desktopDataDir(), {
        legacyDataDir: path.join(app.getPath("home"), ".opengrokbot"),
      });
    } catch (error) {
      dialog.showErrorBox(
        "Sagax could not start safely",
        error?.message ?? "Another process is using this Sagax data folder.",
      );
      app.quit();
      return;
    }
  }
  if (app.isPackaged) {
    // sagax:// is primary; openmausbot:// stays for one release (legacy-names.mjs).
    // A packaged launch smoke must not take sagax:// away from the installed app.
    if (process.env.SAGAX_SMOKE_TEST !== "1") for (const scheme of URL_SCHEMES) app.setAsDefaultProtocolClient(scheme);
    // Chromium adds this capability below JavaScript, so renderer requests
    // can mutate the local harness while a Full-access shell using curl
    // cannot impersonate the person operating the desktop app.
    installDesktopMutationHeader();
  }
  // A runtime Dock image overrides the bundle icon with a flat PNG, which
  // on macOS 26 discards the Liquid Glass rendering (build/icon.icon) and
  // drops the icon into the gray "squircle jail". Packaged builds keep the
  // system icon. Unpackaged dev runs get the same compiled icon from
  // scripts/dev-desktop.mjs; the flat PNG is only the fallback
  // when that script could not run (no Xcode actool).
  // The person's custom app icon (Settings > Appearance) wins over both;
  // it is their choice to trade the Liquid Glass rendering for it.
  const customAppIcon = savedAppIcon();
  if (customAppIcon) { try { showAppIcon(customAppIcon); } catch (error) { console.warn("[app-icon] restore failed", error); } }
  else if (process.platform === "darwin" && !app.isPackaged && !devBundleHasSystemIcon()) app.dock.setIcon(APP_ICON);
  startupPhase("reading saved credentials");
  secureCredentials = await loadSecureCredentials();
  // The AssemblyAI key only fed the removed Teach a skill recorder, and its
  // set/clear handler went with it; drop the orphaned secret rather than
  // keep a third-party key at rest with no way to remove it.
  if (secureCredentials && Object.hasOwn(secureCredentials, "assemblyAiApiKey") && !credentialStoreUnavailable) {
    try {
      const { assemblyAiApiKey: _removed, ...rest } = secureCredentials;
      await saveSecureCredentials(rest);
      secureCredentials = rest;
    } catch (error) {
      slog(`orphaned AssemblyAI key not removed: ${error?.message ?? error}`);
    }
  }
  if (app.isPackaged) {
    await secureComposioConfig();
    await secureWorkspaceConfig();
  }
  // Boot migrations above are deliberately sequential. From this point on,
  // every account/API-key writer must use the shared serialized state.
  // An unreadable store must not become a WRITE of an empty document.
  secureCredentialState = createSecureCredentialState(secureCredentials, saveSecureCredentials, {
    writable: !credentialStoreUnavailable,
  });
  secureCredentials = secureCredentialState.read();
  startupPhase("preparing the credential store");
  if (app.isPackaged) await ensurePhoneSecretIdentity();
  if (app.isPackaged) await ensureMcpOAuthKey();
  desktopRemoteAccess = desktopCompanionAccess(secureCredentials);
  const hostedAccount = desktopRemoteAccess ? null : ensureCompanionAccountService();
  // Display capture remains user-initiated. The renderer first sends a
  // short-lived one-shot intent, then calls getDisplayMedia in the same click.
  // The handler binds that request to the same frame/origin, rejects audio,
  // and requires Electron's active user-gesture signal.
  if (process.platform === "darwin" || process.platform === "linux") {
    session.defaultSession.setDisplayMediaRequestHandler(
      (request, callback) => {
        displayMediaRequestCount += 1;
        if (!displayMediaGuard.consume(request, rendererOrigin())) {
          respondToDisplayMediaRequest(callback, {});
          return;
        }

        const capabilities = desktopCapabilities({
          platform: process.platform,
          env: process.env,
          packaged: app.isPackaged,
        });
        const captureHost =
          process.platform === "darwin" ? "darwin" : capabilities.host.session;
        if (!capabilities.screenPreview.available) {
          respondToDisplayMediaRequest(callback, {});
          return;
        }

        desktopCapturer
          .getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
          .then((sources) => {
            const source = selectCaptureSource({
              sources,
              host: captureHost,
              primaryDisplayId:
                process.platform === "linux" && captureHost === "x11"
                  ? screen.getPrimaryDisplay().id
                  : null,
            });
            if (!source) {
              console.warn(
                `[screen-preview] rejected ${captureHost} source set (${sources.length} candidates)`,
              );
            }
            respondToDisplayMediaRequest(callback, source ? { video: source } : {});
          })
          .catch((error) => {
            console.warn("[screen-preview] source discovery failed:", error);
            respondToDisplayMediaRequest(callback, {});
          });
      },
      { useSystemPicker: false },
    );
  }
  registerCuaIpc();
  androidDevice.registerIpc(ipcMain);
  registerUpdaterIpc({ pageAllowed: updaterPageAllowed });
  // Start the CUA daemon before the window so the harness can pick up the
  // connection descriptor on first render. Never blocks window creation on
  // failure — computer use degrades to "unavailable", the rest still works.
  cuaReady =
    !desktopRemoteAccess && (process.platform === "darwin" || process.platform === "linux" || process.platform === "win32")
      ? startCua().catch((e) => {
          console.error("[cua] start failed:", e);
          return { mode: "unavailable", reason: String(e) };
        })
      : Promise.resolve({ mode: "unavailable", reason: "unsupported-platform" });
  if (desktopRemoteAccess) {
    try {
      desktopCompanionRelay = await startDesktopCompanionRelay({
        access: desktopRemoteAccess,
        staticDir: app.isPackaged
          ? path.join(process.resourcesPath, "ui")
          : path.join(app.getAppPath(), "dist"),
      });
      SERVER_PORT = desktopCompanionRelay.port;
      serverReady = true;
    } catch (error) {
      serverReady = false;
      slog(`desktop companion relay failed: ${error?.message ?? error}`);
    }
  } else if (app.isPackaged && serverModeEnvironment(readEnvironments())) {
    // Server mode: every bot runs on the organization's server. No local
    // server starts, so nothing of this computer's own (routines, channels,
    // memory upkeep, queued sends) runs in the background. Leaving server
    // mode restarts the app, which starts it again.
    slog("server mode: the local server is not started");
  } else if (app.isPackaged) {
    await startServerPackaged();
  }
  if (desktopShutdownStarted) return;
  // The hosted Sagax Admin portal does not start with the desktop:
  // no saved company connection, no company cloud backups, no portal policy.
  // The companion the user left on comes back without anyone finding the
  // toggle again — one attempt, after the harness port is settled, with the
  // exact options the IPC handler uses. A failure surfaces in companionState
  // (the panel shows the error) rather than retrying; and it never delays
  // the window.
  if (!desktopRemoteAccess && serverReady && companionEnabledAtRest()) {
    // Wait until a saved organisation policy is known: it may turn remote access off.
    void (managedDesktop?.whenRestored() ?? Promise.resolve())
      .then(() => startDesktopCompanion({ waitForHosted: false, remember: false }))
      .catch(error => slog(`companion auto-start skipped: ${error?.message ?? error}`));
  }
  setLocalOrigin(rendererOrigin());
  // Device permissions (microphone, notifications, clipboard) are for the
  // local UI only; privileged capabilities (camera, geolocation, USB, MIDI,
  // serial) stay off. Client mode's loopback relay is the local UI.
  // Voice mode in server mode: the bundled UI drawn on the organization
  // server's origin (bundled-ui.cjs) may open the microphone, nothing else.
  // The active paired server, in this window's main frame, may also write
  // the clipboard (its copy buttons); it never reads it, and each request is
  // decided again, so a server switch withdraws it at once.
  appPermissions = appPermissionHandlers({
    rendererOrigin,
    mainContents: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null),
    microphoneOrigins: () => [bundledOrigin(environmentsState)],
    activeRemoteOrigin: () => activeEnvironment(environmentsState)?.origin ?? null,
  });
  session.defaultSession.setPermissionRequestHandler(appPermissions.request);
  session.defaultSession.setPermissionCheckHandler(appPermissions.check);
  environmentsState = readEnvironments();
  syncBundledUi();
  // Server mode: this app bridges the organization's bots to this computer
  // for the signed-in person (electron/desktop-bridge.mjs).
  desktopBridge().sync();
  // Maintainer grants never start while computer sharing is off: no poll
  // loop, no registration, no grant replay from disk.
  void refreshSharedComputersAllowed().then((allowed) => {
    sharingController().start({ maintainer: allowed });
  });
  startupPhase("opening the workspace", "Opening your workspace…");
  let restoredOrganizationEntry = false;
  await workspaceMenuAction(async () => { restoredOrganizationEntry = await organizationEntry.restore(); });
  organizationEntryReady = true;
  // A cold-start action owns its first navigation. Starting the default load
  // first would let the action abort that unawaited navigation immediately.
  const deliveredOrganizationEntry = await deliverOrganizationEntry();
  if (!restoredOrganizationEntry && !deliveredOrganizationEntry && (!mainWindow || mainWindow.isDestroyed())) createWindow();
  void upgradeSavedOrganizationServers().catch((error) => slog(`organization server upgrade failed: ${error?.message ?? error}`));
  startupPhase("workspace window created");
  // Reconcile incomplete setup and resume interrupted sign-out only after the
  // local app is usable. This background network work never gates LAN pairing
  // or the first window.
  if (hostedAccount) void hostedAccount.restore().catch(() => {});
  // Registration is optional network work. Start it only after the local
  // server and first window are usable, then update the server child over its
  // private parent port so Connected Apps becomes available without restart.
  // Registering while the store is unreadable would mint a SECOND installation
  // identity for a user who already has one — the first thing they would
  // notice is every connected app gone, permanently.
  if (credentialStoreUnavailable) {
    slog("skipping connected-apps registration: the credential store was unreadable this launch");
  }
  if (!desktopRemoteAccess && app.isPackaged && composioBrokerUrl() && !credentialStoreUnavailable) {
    void updateSecureCredentialDocument(async (credentials) => {
      await ensureManagedComposioCredentials({
        brokerUrl: composioBrokerUrl(),
        credentials,
        // The shared credential state performs the one atomic encrypted
        // write after this registration has derived its complete document.
        saveCredentials: async () => {},
        log: slog,
      });
      return credentials;
    }).finally(syncManagedComposioCredentials);
  }
  // in-app auto-update (packaged only) — checks GitHub releases and downloads
  // by itself; only "Restart to update", the person's click, installs
  startUpdater();
  refreshApplicationMenu();
  app.on("activate", () => {
    if (desktopTray?.show()) return;
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).finally(() => allWindowsClosedQuit.settleStartup());

// The startup splash is the only window while boot runs; its recovery
// timers can destroy it mid-boot (issue #2028). An unconditional
// last-window-closed quit would fire there, killing the app before the
// server child forks — exactly the exit the recovery was meant to avoid.
const allWindowsClosedQuit = createAllWindowsClosedQuit({
  app,
  allWindows: () => BrowserWindow.getAllWindows(),
});

// EMBEDDING.md lifecycle rule: defer the first quit until the embedded
// daemon's async cleanup completes — it can't run after the host exits.
// Cap the defer so a wedged daemon cannot keep the app alive forever.
const CUA_STOP_TIMEOUT_MS = 2500;
let cuaCleanedUp = false;
let signalQuitRequested = false;

// Package managers, desktop watchdogs, and terminal launchers commonly stop
// Linux apps with SIGTERM/SIGINT. Convert the first signal into Electron's
// normal quit path so the embedded server, Cua descriptor/socket, and private
// AppImage stage receive the same bounded cleanup as a window close. A second
// signal keeps Node's default force-quit behavior because these are `once`
// listeners.
const requestSignalQuit = () => {
  if (signalQuitRequested) return;
  signalQuitRequested = true;
  app.quit();
};
process.once("SIGINT", requestSignalQuit);
process.once("SIGTERM", requestSignalQuit);

app.on("before-quit", (e) => {
  desktopShutdownStarted = true;
  retroAssistantWindow.close();
  floatingBotWindows.closeAll();
  startupScreen?.dispose();
  companyBackupSchedule?.close();
  orgLibrary?.close();
  managedDesktop?.close();
  companyBackupController?.abort();
  computerSharing?.close();
  desktopBridgeConnector?.close();
  if (cuaCleanedUp) return;
  e.preventDefault();
  // Cancel a scheduled recovery before yielding, and stop the owned child
  // even if it has not passed its boot probe yet.
  const stoppingServer = serverSupervisor.shutdown();
  // Release the sleep blocker synchronously; child shutdown is awaited below.
  syncCompanionKeepAwake(false, false);
  routineWake.stop();
  try {
    desktopCompanionRelay?.close?.();
  } catch {}
  // a live dictation session runs its own helper child that holds the mic —
  // stop it here so quitting never orphans a recording process
  if (nativeActions.appleSpeech) stopSpeech();
  const ownedHelperCleanup = Promise.race([
    Promise.all([
      stopCua().catch(() => {}),
      // Both listeners reachable from outside the app are owned children.
      // Shut the connector down first, then the sidecar, without changing the
      // remembered toggle the next launch will restore.
      stopDesktopCompanion({ remember: false }).catch(() => {}),
    ]),
    new Promise((resolve) => setTimeout(resolve, CUA_STOP_TIMEOUT_MS).unref()),
  ]);
  const cleanup = Promise.all([
    ownedHelperCleanup,
    stoppingServer.then((stopped) => {
      if (!stopped) slog("server child did not stop before desktop exit; retaining the data-directory lease");
    }),
  ]);
  cleanup.then(() => {
    cuaCleanedUp = true;
    app.quit();
  });
});

function releaseDesktopDataDirLease() {
  if (!desktopDataDirLease) return;
  try {
    desktopDataDirLease.release();
    desktopDataDirLease = null;
  } catch (error) {
    // Never print the private child capability. Lease errors contain only the
    // data-safety reason and, for contention, the owning process id.
    slog(`data-directory lease release failed: ${error?.message ?? error}`);
  }
}

// before-quit is deliberately too early: this app defers it while owned
// helpers shut down. will-quit is the final Electron lifecycle boundary; the
// process hook covers app.exit()/fatal exits that bypass it.
app.on("will-quit", releaseDesktopDataDirLease);
app.on("will-quit", () => desktopTray?.destroy());
process.once("exit", releaseDesktopDataDirLease);
