/**
 * An artifact in a window of its own, outside the app's frame (#1140).
 *
 * A popped-out artifact is a floating window drawn inside Sagax's window
 * (src/components/artifacts/artifact-windows.ts), so it cannot leave it. This
 * opens the same artifact in a real desktop window that can be moved beside the
 * app, resized and put on another monitor. One window per artifact: asking
 * again brings it forward.
 *
 *   main renderer  --artifact-window:open {botId, artifactId, title, width?, height?}-->  main
 *                  -->  BrowserWindow(<page origin>/artifact-window#bot=…&artifact=…)
 *   person closes it  -->  main  --artifact-window:closed {artifactId}-->  main renderer (docks it)
 *
 * The window draws the app's own page (same origin, build and Content Security
 * Policy as the main window) on its `/artifact-window` route, in the default
 * session so the person's sign-in applies as it does in the main window. Like
 * the Data window it gets no preload: no `window.ogb`, no way to call main,
 * plus contextIsolation, a sandbox and no Node. It may only navigate within its
 * own route; any other link goes to the system browser. Only the main window's
 * own page may ask for one.
 */

export const ARTIFACT_WINDOW_PATH = "/artifact-window";
export const ARTIFACT_WINDOW_SIZE = Object.freeze({ width: 960, height: 720 });
export const ARTIFACT_WINDOW_MIN = Object.freeze({ width: 320, height: 240 });
/** More artifact windows than this at once is a mistake, not a desk. */
export const MAX_ARTIFACT_WINDOWS = 24;
const TITLE_MAX = 120;

const ID_RE = /^[a-zA-Z0-9:_-]{1,128}$/;

const isString = (value) => Object.prototype.toString.call(value) === "[object String]";
const clampSize = (value, fallback, min) =>
  Number.isFinite(value) ? Math.min(4000, Math.max(min, Math.round(value))) : fallback;

/** The request as the renderer sent it, or null: the bot and artifact ids, a
 * short plain title and an optional size. */
export function sanitizeArtifactWindowRequest(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { botId, artifactId } = raw;
  if (!isString(botId) || !ID_RE.test(botId) || !isString(artifactId) || !ID_RE.test(artifactId)) return null;
  // eslint-disable-next-line no-control-regex
  const title = isString(raw.title) ? raw.title.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, TITLE_MAX) : "";
  return {
    botId,
    artifactId,
    title: title || "Artifact",
    width: clampSize(raw.width, ARTIFACT_WINDOW_SIZE.width, ARTIFACT_WINDOW_MIN.width),
    height: clampSize(raw.height, ARTIFACT_WINDOW_SIZE.height, ARTIFACT_WINDOW_MIN.height),
  };
}

/** The window's page: the asking page's own origin, on the artifact route. */
export function artifactWindowUrl(origin, botId, artifactId) {
  const params = new URLSearchParams({ bot: botId, artifact: artifactId });
  return `${origin}${ARTIFACT_WINDOW_PATH}#${params}`;
}

/** Whether `url` stays on the artifact route of `origin` (a hash change does). */
export function artifactWindowNavigationAllowed(url, origin) {
  try {
    const target = new URL(url);
    return target.origin === origin && target.pathname === ARTIFACT_WINDOW_PATH;
  } catch {
    return false;
  }
}

function pageOrigin(event) {
  const url = event?.senderFrame?.url || event?.sender?.getURL?.() || "";
  try {
    const origin = new URL(url).origin;
    return origin && origin !== "null" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} deps
 * @param {typeof import("electron").BrowserWindow} deps.BrowserWindow
 * @param {import("electron").IpcMain} deps.ipcMain
 * @param {() => import("electron").BrowserWindow | null} deps.getMainWindow
 * @param {(event: import("electron").IpcMainInvokeEvent) => boolean} deps.isTrustedMain
 * @param {(url: string) => void} [deps.openExternal] a link out of the window (validated by the caller)
 * @param {() => unknown} [deps.icon]
 * @param {(line: string) => void} [deps.log]
 */
export function createArtifactWindows(deps) {
  const { BrowserWindow, ipcMain, getMainWindow, isTrustedMain } = deps;
  const log = deps.log ?? (() => {});
  /** artifactId -> { win, origin, botId, title, quiet } */
  const windows = new Map();

  const live = (artifactId) => {
    const entry = windows.get(artifactId);
    if (!entry) return null;
    if (entry.win.isDestroyed()) {
      windows.delete(artifactId);
      return null;
    }
    return entry;
  };

  const bringForward = (win) => {
    if (win.isMinimized?.()) win.restore?.();
    win.show?.();
    win.focus?.();
  };

  const fromMainWindow = (event) => {
    if (!isTrustedMain(event)) return false;
    const main = getMainWindow();
    return Boolean(main && !main.isDestroyed() && event?.sender === main.webContents);
  };

  const closeQuietly = (artifactId) => {
    const entry = windows.get(artifactId);
    if (!entry) return;
    windows.delete(artifactId);
    entry.quiet = true;
    if (!entry.win.isDestroyed()) entry.win.close();
  };

  /** "created" or "focused", or "refused" (not the main window's page, a bad
   * request, too many windows). */
  function open(event, raw) {
    if (!fromMainWindow(event)) return "refused";
    const request = sanitizeArtifactWindowRequest(raw);
    const origin = pageOrigin(event);
    if (!request || !origin) return "refused";

    const existing = live(request.artifactId);
    if (existing && existing.origin === origin) {
      existing.win.setTitle?.(request.title);
      existing.title = request.title;
      bringForward(existing.win);
      return "focused";
    }
    // Another server's window for this artifact id: it is not this artifact's.
    if (existing) closeQuietly(request.artifactId);
    if (windows.size >= MAX_ARTIFACT_WINDOWS) return "refused";

    const win = new BrowserWindow({
      width: request.width,
      height: request.height,
      minWidth: ARTIFACT_WINDOW_MIN.width,
      minHeight: ARTIFACT_WINDOW_MIN.height,
      resizable: true,
      show: false,
      title: request.title,
      ...(deps.icon ? { icon: deps.icon() } : {}),
      backgroundColor: "#070707",
      autoHideMenuBar: true,
      webPreferences: {
        // No preload: this page gets no bridge into main.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const entry = { win, origin, botId: request.botId, title: request.title, quiet: false };
    windows.set(request.artifactId, entry);

    win.once("ready-to-show", () => {
      if (win.isDestroyed()) return;
      win.show();
      win.focus();
    });
    win.on("closed", () => {
      if (windows.get(request.artifactId)?.win === win) windows.delete(request.artifactId);
      if (entry.quiet) return;
      // The person closed it: the page docks the artifact, as closing its
      // floating window does.
      const main = getMainWindow();
      if (main && !main.isDestroyed()) {
        main.webContents.send("artifact-window:closed", { botId: request.botId, artifactId: request.artifactId });
      }
    });
    // The window keeps the title main gave it.
    win.on("page-title-updated", (titleEvent) => {
      titleEvent.preventDefault();
      if (!win.isDestroyed()) win.setTitle(entry.title);
    });
    const leave = (url) => {
      try {
        const target = new URL(url);
        // The app's own other pages stay in the app; the web goes out.
        if (target.origin === origin) return;
        if (target.protocol === "http:" || target.protocol === "https:") deps.openExternal?.(target.toString());
      } catch {
        // not a web link: nothing to open
      }
    };
    win.webContents.setWindowOpenHandler(({ url }) => {
      leave(url);
      return { action: "deny" };
    });
    const guard = (navigationEvent, url) => {
      if (artifactWindowNavigationAllowed(url, origin)) return;
      navigationEvent.preventDefault();
      leave(url);
    };
    win.webContents.on("will-navigate", guard);
    win.webContents.on("will-redirect", guard);

    void Promise.resolve(win.loadURL(artifactWindowUrl(origin, request.botId, request.artifactId))).catch((error) => {
      log(`artifact window: the page did not load (${error?.message ?? error})`);
    });
    return "created";
  }

  /** The page docked or deleted the artifact: its window goes, without
   * telling the page it was closed. */
  function close(event, raw) {
    if (!fromMainWindow(event)) return false;
    const artifactId = raw && typeof raw === "object" ? raw.artifactId : undefined;
    if (!isString(artifactId) || !ID_RE.test(artifactId)) return false;
    closeQuietly(artifactId);
    return true;
  }

  ipcMain.handle("artifact-window:open", (event, raw) => open(event, raw));
  ipcMain.handle("artifact-window:close", (event, raw) => close(event, raw));

  return {
    open,
    close,
    /** Artifact ids with a window open. */
    list: () => [...windows.keys()].filter((artifactId) => live(artifactId)),
    /** The main window now shows another server: its artifacts' windows go. */
    mainNavigated(url) {
      let origin = null;
      try {
        origin = new URL(url).origin;
      } catch {
        // an unparseable address closes every window below
      }
      for (const [artifactId, entry] of windows) {
        if (entry.origin !== origin) closeQuietly(artifactId);
      }
    },
    /** The app quits: every artifact window closes with it. */
    closeAll() {
      for (const artifactId of windows.keys()) closeQuietly(artifactId);
    },
    dispose() {
      ipcMain.removeHandler("artifact-window:open");
      ipcMain.removeHandler("artifact-window:close");
    },
  };
}
