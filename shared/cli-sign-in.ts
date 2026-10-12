// A sign-in page a CLI prints when it cannot show a one-time code (Cursor's
// `cursor-agent login` with NO_OPEN_BROWSER=1). The server reads only an
// allowlisted https URL. The app checks the same rules again before it
// opens the page. A token, a hash or another host never becomes a link.

const CURSOR_HOSTS = new Set(["cursor.com", "www.cursor.com", "authenticator.cursor.sh"]);
const CURSOR_PATHS = new Set(["/login", "/loginDeepControl", "/loginDeepPage"]);
const CURSOR_QUERY = new Set(["challenge", "uuid", "mode", "redirect_uri", "state"]);

/** Cursor's own sign-in page, or null for anything else. */
export function cursorSignInLink(value: string | null | undefined): string | null {
  if (!value || !/^https:\/\/[^\s#]+$/.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.username || url.password || url.port || url.hash) return null;
  if (!CURSOR_HOSTS.has(url.hostname)) return null;
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (!CURSOR_PATHS.has(path)) return null;
  for (const [key, carried] of url.searchParams) {
    if (!CURSOR_QUERY.has(key) || carried.length > 256 || /\s/.test(carried)) return null;
  }
  return url.href;
}

/** The first allowlisted sign-in URL in a CLI's output. A line that is still
 * arriving is read too: Cursor may not print a newline after the URL, and a
 * half-printed URL fails the allowlist rather than being opened. `text` is
 * already free of terminal styling. */
export function cursorSignInPrompt(text: string): { authorizationUrl: string } | null {
  for (const token of text.split(/\s+/)) {
    const cleaned = token.replace(/[),.;]+$/, "");
    const authorizationUrl = cursorSignInLink(cleaned);
    if (authorizationUrl) return { authorizationUrl };
  }
  return null;
}

/** Drop URLs, device codes and long tokens from CLI output before a failure
 * is classified. The result is never shown to a person. */
export function stripSignInSecrets(output: string): string {
  return output
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/\b[A-Z0-9]{4,12}(?:-[A-Z0-9]{2,12}){1,3}\b/g, "")
    .replace(/[A-Za-z0-9+/=_-]{20,}/g, "");
}
