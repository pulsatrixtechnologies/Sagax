// A security key ceremony for the desktop's own page (wave 2, package E).
//
// The local page is served on 127.0.0.1, and WebAuthn never takes an IP
// address as its RP ID. So the key runs in a small window on
// http://localhost:<port>, the same server, whose ceremony page
// (server/routes/security-keys.ts) asks the browser for the key and posts
// the answer itself. The window ends by setting its title; nothing but that
// outcome comes back here, and the window has no preload, no node and its
// own in-memory session (no cookie of the app's).

const PAGE = /^\/api\/security-keys\/ceremony\/[A-Za-z0-9_-]{43}\/page$/;
const DONE = /^sagax-security-key:(ok|error(?::[a-z-]{1,40})?)$/;
const TIMEOUT_MS = 150_000;

/** Whether a page path is a ceremony page this window may open. */
export function isCeremonyPage(pageUrl) {
  return typeof pageUrl === "string" && PAGE.test(pageUrl);
}

/** The outcome a ceremony page's title says, or null while it runs. */
export function ceremonyOutcome(title) {
  const match = DONE.exec(String(title ?? ""));
  if (!match) return null;
  if (match[1] === "ok") return { ok: true };
  return { ok: false, error: match[1].slice("error:".length) || "failed" };
}

/** Open the ceremony and resolve with its outcome. One at a time. */
export function createSecurityKeyWindow({ BrowserWindow, session, port, parent, french }) {
  let open = null;
  return async function ceremony(pageUrl) {
    if (!isCeremonyPage(pageUrl)) throw new Error("Not a security key page");
    if (open && !open.isDestroyed()) {
      open.focus();
      return { ok: false, error: "busy" };
    }
    const partition = session.fromPartition("sagax-security-key");
    const parentWindow = parent?.();
    const win = new BrowserWindow({
      width: 420,
      height: 320,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: french ? "Clé de sécurité" : "Security key",
      ...(parentWindow && !parentWindow.isDestroyed() ? { parent: parentWindow, modal: true } : {}),
      webPreferences: { session: partition, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    open = win;
    win.removeMenu?.();
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // let the person read the last line a moment on success
        setTimeout(() => { if (!win.isDestroyed()) win.destroy(); }, outcome.ok ? 600 : 0);
        open = null;
        resolve(outcome);
      };
      const timer = setTimeout(() => finish({ ok: false, error: "expired" }), TIMEOUT_MS);
      win.on("page-title-updated", (event, title) => {
        const outcome = ceremonyOutcome(title);
        if (!outcome) return;
        event.preventDefault();
        finish(outcome);
      });
      win.on("closed", () => finish({ ok: false, error: "cancelled" }));
      win.loadURL(`http://localhost:${port()}${pageUrl}`).catch(() => finish({ ok: false, error: "unreachable" }));
    });
  };
}
