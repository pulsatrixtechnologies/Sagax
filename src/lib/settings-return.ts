// A Settings page that sends the person to sign in again (Settings >
// Security: the first key needs a fresh sign-in) comes back after it. The
// sign-in leaves this page (the web: /auth/oidc/start then /pair; the
// desktop: the system browser, then /pair in this window) and ends on `/`,
// so the page waits in sessionStorage meanwhile, as an "Open in Sagax" link
// does (open-thread-hash.ts). Used once; an old one is dropped.

export const SETTINGS_RETURN_KEY = "sagax.settingsReturn";
/** A sign-in that took longer than this does not reopen Settings. */
export const SETTINGS_RETURN_MAX_AGE_MS = 15 * 60_000;
const SECTION = /^[a-zA-Z][\w-]{0,40}$/;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function sessionStore(): StorageLike | null {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** Remember the Settings page to reopen after the sign-in. Never throws. */
export function rememberSettingsReturn(section: string, storage: StorageLike | null = sessionStore(), now = Date.now()): void {
  if (!storage || !SECTION.test(section)) return;
  try {
    storage.setItem(SETTINGS_RETURN_KEY, JSON.stringify({ section, at: now }));
  } catch {
    /* storage blocked: the person opens Settings again themselves */
  }
}

/** The Settings page to reopen, once, or null. */
export function takeSettingsReturn(storage: StorageLike | null = sessionStore(), now = Date.now()): string | null {
  if (!storage) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(SETTINGS_RETURN_KEY);
    if (raw !== null) storage.removeItem(SETTINGS_RETURN_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { section?: unknown; at?: unknown };
    if (typeof value.section !== "string" || !SECTION.test(value.section) || typeof value.at !== "number") return null;
    if (now - value.at > SETTINGS_RETURN_MAX_AGE_MS || value.at > now + 60_000) return null;
    return value.section;
  } catch {
    return null;
  }
}
