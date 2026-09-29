// "Sign in with Pulsatrix" on a saved organization server, in the desktop app.
//
// The main window carries the app's preload bridge and may only navigate
// inside the selected workspace (environments.cjs). The identity provider's
// page must get neither, so the sign-in runs in its own small window: no
// preload, sandboxed, context isolated, popups denied, sharing the main
// window's session so the Pulsa Bot cookie the callback sets lands in the
// same jar. When that window comes back to the workspace outside
// /auth/oidc/, the main window loads that address and the sign-in window
// closes. No provider token is ever seen here: the server is the OIDC client
// (server/oidc-login.ts). Slice 2 moves this to the system browser (RFC 8252).
const OIDC_START_PATH = "/auth/oidc/start";

function activeOrigin(state) {
  const active = state?.environments?.find((entry) => entry.id === state.activeId);
  return active?.origin ?? null;
}

/** The sign-in start address when the main window is about to open it on the
 * selected saved server, else null (Local, another origin, another path). */
function oidcLoginStartUrl(url, state) {
  const origin = activeOrigin(state);
  if (!origin) return null;
  try {
    const target = new URL(url);
    return target.origin === origin && target.pathname === OIDC_START_PATH ? target.href : null;
  } catch {
    return null;
  }
}

/** Where the main window goes once the sign-in window is back on the
 * workspace (the app, or /pair with an error), else null (still signing in). */
function oidcLoginReturnUrl(url, origin) {
  try {
    const target = new URL(url);
    if (target.origin !== origin || target.pathname.startsWith("/auth/oidc/")) return null;
    return target.href;
  } catch {
    return null;
  }
}

/** Open the sign-in window. `onDone(url)` runs once, when it comes back. */
function openOidcLoginWindow({ BrowserWindow, parent, url, onDone, log = () => {} }) {
  const origin = new URL(url).origin;
  const login = new BrowserWindow({
    parent,
    modal: true,
    width: 520,
    height: 720,
    show: true,
    autoHideMenuBar: true,
    webPreferences: {
      session: parent.webContents.session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: false,
      allowRunningInsecureContent: false,
    },
  });
  let finished = false;
  const finish = (target) => {
    if (finished) return;
    finished = true;
    onDone(target);
    if (!login.isDestroyed()) login.close();
  };
  login.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  login.webContents.on("did-navigate", (_event, target) => {
    const back = oidcLoginReturnUrl(target, origin);
    if (back) finish(back);
  });
  login.webContents.on("did-fail-load", (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) log(`sign-in window failed to load (${errorCode})`);
  });
  void login.loadURL(url).catch(() => log("sign-in window could not open"));
  return login;
}

module.exports = { OIDC_START_PATH, oidcLoginStartUrl, oidcLoginReturnUrl, openOidcLoginWindow };
