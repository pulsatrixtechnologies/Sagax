// A security key ceremony for the desktop app (wave 2, package E; system
// browser since 2026-10-18).
//
// Electron has no WebAuthn interface of its own: no Touch ID (macOS reports
// no user-verifying platform authenticator), no iCloud Keychain passkey and
// no PIN prompt for a hardware key, so a ceremony that needs user
// verification never ends in an app window. The ceremony page therefore
// opens in the system browser, as "Sign in with Pulsatrix" does (passkeys
// and password managers live there): the server's own page, which asks the
// key and posts the answer itself (server/routes/security-keys.ts). The app
// learns the end by asking the ceremony's status (src/lib/step-up-client.ts).
//
// Where the page opens:
//   - the local page (127.0.0.1, never an RP ID): http://localhost:<port>,
//     the same server, RP ID `localhost`;
//   - this app's bundle drawn on an organization server: that server's own
//     origin, where the key's RP ID is the server's host.
// Nothing but a ceremony page path of that server is ever opened.

const PAGE = /^\/api\/security-keys\/ceremony\/[A-Za-z0-9_-]{43}\/page$/;

/** Whether a page path is a ceremony page this app may open. */
export function isCeremonyPage(pageUrl) {
  return typeof pageUrl === "string" && PAGE.test(pageUrl);
}

/** The address to open in the system browser, or null.
 * `local`: the sender is the local page; `bundledOrigin`: the organization
 * server whose page sent it (http(s) only). */
export function ceremonyBrowserUrl(pageUrl, { local, port, bundledOrigin }) {
  if (!isCeremonyPage(pageUrl)) return null;
  if (local) {
    const value = Number(port);
    return Number.isInteger(value) && value > 0 && value < 65536 ? `http://localhost:${value}${pageUrl}` : null;
  }
  if (typeof bundledOrigin !== "string") return null;
  try {
    const origin = new URL(bundledOrigin);
    if ((origin.protocol !== "https:" && origin.protocol !== "http:") || origin.origin !== bundledOrigin) return null;
    return `${origin.origin}${pageUrl}`;
  } catch {
    return null;
  }
}

/** The IPC side: open a ceremony in the system browser, and bring this
 * app back to the front once it ended. */
export function createSecurityKeyBrowser({ openExternal, port, isLocal, bundledOrigin, focusApp }) {
  return {
    async open(event, pageUrl) {
      const url = ceremonyBrowserUrl(pageUrl, { local: isLocal(event), port: port(), bundledOrigin: bundledOrigin(event) });
      if (!url) return { ok: false, error: "failed" };
      try {
        await openExternal(url);
        return { ok: true };
      } catch {
        return { ok: false, error: "browser" };
      }
    },
    returned() {
      focusApp();
      return true;
    },
  };
}
