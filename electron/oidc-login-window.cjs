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
// (server/oidc-login.ts).
//
// Slice 2: when this app is the system's openmausbot handler and the server
// says it returns to native apps (descriptor identity.nativeReturn), the
// sign-in runs in the person's own browser instead (RFC 8252), where their
// password manager and passkeys live. The server ends that flow on
// openmausbot://auth?origin=<o>#code=<credential>; the app then opens
// <o>/pair#code=<credential>&auto=1 in the main window, which redeems it.
// Only a return this app is waiting for (same origin, under ten minutes, one
// at a time) is honoured.
const OIDC_START_PATH = "/auth/oidc/start";
const SYSTEM_SIGN_IN_TTL_MS = 10 * 60_000;

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

/** The same sign-in, started in the system browser for the desktop return. */
function systemBrowserStartUrl(url, state) {
  const start = oidcLoginStartUrl(url, state);
  return start ? `${new URL(start).origin}${OIDC_START_PATH}?client=desktop` : null;
}

/** The one system-browser sign-in this app is waiting for. */
function createPendingSystemSignIn({ now = Date.now } = {}) {
  let pending = null;
  return {
    begin(origin) {
      pending = { origin, startedAt: now() };
    },
    /** True once, for a fresh return from the origin that was started. */
    take(origin) {
      const current = pending;
      if (!current || now() - current.startedAt >= SYSTEM_SIGN_IN_TTL_MS) {
        pending = null;
        return false;
      }
      if (current.origin !== origin) return false;
      pending = null;
      return true;
    },
  };
}

/** Where the main window goes for a parsed return link. */
function authReturnTarget(parsed) {
  return "code" in parsed ? `${parsed.origin}/pair#code=${parsed.code}&auto=1` : `${parsed.origin}/pair#signin_error=${parsed.error}`;
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

module.exports = { OIDC_START_PATH, SYSTEM_SIGN_IN_TTL_MS, authReturnTarget, createPendingSystemSignIn, oidcLoginStartUrl, oidcLoginReturnUrl, openOidcLoginWindow, systemBrowserStartUrl };
