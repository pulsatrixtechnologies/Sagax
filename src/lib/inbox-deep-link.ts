/** Deep links that open the cross-bot inbox (attention) surface. */

export const INBOX_VIEW = "inbox";
const LEGACY_TODO_VIEW = "todo";

export type InboxDeepLink = { view: typeof INBOX_VIEW };

/** `?view=todo` is kept as an alias; it is rewritten to `?view=inbox`. */
export function parseInboxViewParam(search: string): InboxDeepLink | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const view = params.get("view");
  if (view === INBOX_VIEW || view === LEGACY_TODO_VIEW) return { view: INBOX_VIEW };
  return null;
}

export function parseInboxHash(hash: string): InboxDeepLink | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (text === INBOX_VIEW || text === LEGACY_TODO_VIEW) return { view: INBOX_VIEW };
  return null;
}

export function inboxDeepLinkFromLocation(
  loc: Pick<Location, "hash" | "search">,
): InboxDeepLink | null {
  return parseInboxHash(loc.hash) ?? parseInboxViewParam(loc.search);
}

/** Rewrites a legacy `view=todo` (or `#todo`) to inbox in the address bar. */
export function normalizeInboxDeepLink(
  loc: Pick<Location, "hash" | "pathname" | "search">,
  history: Pick<History, "replaceState"> | null = globalThis.history ?? null,
): InboxDeepLink | null {
  const fromHash = parseInboxHash(loc.hash);
  const fromSearch = parseInboxViewParam(loc.search);
  const target = fromHash ?? fromSearch;
  if (!target) return null;

  const url = new URL(loc.pathname + loc.search + loc.hash, "http://local");
  if (url.searchParams.get("view") === LEGACY_TODO_VIEW) {
    url.searchParams.set("view", INBOX_VIEW);
  }
  if (url.hash === `#${LEGACY_TODO_VIEW}`) url.hash = `#${INBOX_VIEW}`;

  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${loc.pathname}${loc.search}${loc.hash}`;
  if (next !== current) history?.replaceState(null, "", next);

  return target;
}
