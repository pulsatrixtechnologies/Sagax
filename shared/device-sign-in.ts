// Where a person enters the one-time code that signs an engine's CLI in on
// the machine running Sagax (`codex login --device-auth`, `grok login
// --device-auth`). The server reads the page and the code from the CLI's
// output with these rules, and the app checks them again before it shows a
// link. Neither ever turns arbitrary output into a link, or lets a token ride
// along in one.

export type DeviceSignInProvider = "codex" | "grok" | "kimi";

const CODEX_PAGE = "https://auth.openai.com/codex/device";

const RULES: Record<DeviceSignInProvider, { page(value: string): string | null; code: RegExp }> = {
  codex: {
    page: (value) => (/^https:\/\/auth\.openai\.com\/codex\/device\/?$/.test(value) ? CODEX_PAGE : null),
    code: /^[A-Z0-9]{4,8}-[A-Z0-9]{4,8}$/,
  },
  grok: {
    // xAI's own sign-in hosts. The page may carry the code itself (the
    // provider's "complete" link); nothing else may ride in its query.
    page: (value) => {
      if (!/^https:\/\/[^\s#]+$/.test(value)) return null;
      let url: URL;
      try { url = new URL(value); } catch { return null; }
      if (url.username || url.password || url.port || !/(^|\.)(x\.ai|grok\.com)$/.test(url.hostname)) return null;
      return [...url.searchParams.keys()].every((key) => key === "user_code") ? url.href : null;
    },
    code: /^[A-Z0-9]{4,12}(?:-[A-Z0-9]{2,12}){0,3}$/,
  },
  kimi: {
    // Kimi prints the page in the middle of a line
    // (`https://www.kimi.ai/code/authorize_device?user_code=XXXX-XXXX`).
    page: (value) => {
      if (!/^https:\/\/[^\s#]+$/.test(value)) return null;
      let url: URL;
      try { url = new URL(value); } catch { return null; }
      if (url.username || url.password || url.port) return null;
      if (url.hostname !== "www.kimi.ai" && url.hostname !== "www.kimi.com") return null;
      if (url.pathname.replace(/\/$/, "") !== "/code/authorize_device") return null;
      return [...url.searchParams.keys()].every((key) => key === "user_code") ? url.href : null;
    },
    code: /^[A-Z0-9]{4,8}-[A-Z0-9]{4,8}$/,
  },
};

/** The provider's own page for entering `userCode`, or null for anything
 * else. A code carried in the page's link must be that same code. */
export function deviceSignInLink(provider: DeviceSignInProvider, value: string | null | undefined, userCode?: string): string | null {
  const page = value ? RULES[provider].page(value) : null;
  if (!page) return null;
  return [...new URL(page).searchParams.values()].every((carried) => carried === userCode) ? page : null;
}

/** A one-time code as this provider formats it. */
export function isDeviceSignInCode(provider: DeviceSignInProvider, value: string | null | undefined): value is string {
  return typeof value === "string" && RULES[provider].code.test(value);
}

const TRAILING = /[),.;'"]+$/;

/** The provider's page when it is the whole line, or a token inside one.
 * A half-printed last line is never read. */
function pageOnLine(provider: DeviceSignInProvider, line: string): string | null {
  const whole = RULES[provider].page(line);
  if (whole) return whole;
  for (const word of line.split(/\s+/)) {
    const page = RULES[provider].page(word.replace(TRAILING, ""));
    if (page) return page;
  }
  return null;
}

/** A code the CLI states on its own, not one only buried in a query. */
function statedCodes(provider: DeviceSignInProvider, line: string): string[] {
  const found: string[] = [];
  const stripped = line.replace(/^(?:enter\s+)?code:\s*/i, "").trim();
  if (stripped !== line.trim() && isDeviceSignInCode(provider, stripped)) found.push(stripped);
  for (const word of line.split(/[\s:]+/)) {
    const cleaned = word.replace(TRAILING, "");
    if (isDeviceSignInCode(provider, cleaned) && !found.includes(cleaned)) found.push(cleaned);
  }
  return found;
}

/** The page and the code from a CLI's output, once the lines have arrived
 * whole: output arrives in chunks that may stop halfway through a code, so
 * the last, unfinished line is never read. The page may be a whole line
 * (Codex, Grok) or a token in a line (Kimi). A code printed later wins over
 * a different code carried in the link. `text` is already free of terminal
 * styling. */
export function deviceSignInPrompt(provider: DeviceSignInProvider, text: string): { authorizationUrl: string; userCode: string } | null {
  const lines = text.split(/\r?\n/).slice(0, -1).map((line) => line.trim());
  let page: string | null = null;
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    const found = pageOnLine(provider, lines[i] ?? "");
    if (found) { page = found; at = i; break; }
  }
  if (!page || at < 0) return null;
  const stated = lines.slice(at).flatMap((line) => statedCodes(provider, line));
  let userCode = stated[0] ?? null;
  if (!userCode) {
    const carried = new URL(page).searchParams.get("user_code");
    if (isDeviceSignInCode(provider, carried)) userCode = carried;
  }
  if (!userCode || stated.some((code) => code !== userCode)) return null;
  const authorizationUrl = deviceSignInLink(provider, page, userCode);
  return authorizationUrl ? { authorizationUrl, userCode } : null;
}
