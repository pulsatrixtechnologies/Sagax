// The main window's pages, one per account: this computer's own server
// (Personal) and each saved server. Switching accounts shows the page that is
// already open for that account instead of loading it again, the way a chat
// app keeps one page per workspace: its sign-in, its live stream, its
// conversations and the screen it was on stay as they were, and the switch
// costs a frame instead of a full load (no sign-in, no loading screen, no new
// handshake).
//
// The window's own webContents is the first page (the "home" page: whatever
// account the window opened on). Every other account gets a WebContentsView
// laid over it, the size of the window's content. Only the active page is
// visible; the others keep running hidden (Chromium throttles them, their
// live stream keeps them current) and the least recently shown are closed
// past `maxPages`, never the active one nor the home page.
//
// Each page stays on its own origin, in the app's one persistent session:
// cookies, storage and the session cookie are the origin's, so one server's
// page never reads another's (the same isolation a browser gives two sites).
// The main process decides which page is active; a page never chooses.
//
// Pure apart from the injected window and view factory, so node:test covers
// every rule with fakes.

/**
 * @param {{
 *   window: () => any,                    the main BrowserWindow (or null)
 *   createView: () => any,                a new WebContentsView for one account
 *   onCreated?: (contents: any, origin: string) => void,  wire a new page
 *   onDropped?: (contents: any, origin: string) => void,
 *   maxPages?: number,                    pages kept open, the home page counted
 *   log?: (line: string) => void,
 * }} deps
 */
export function createPageContexts(deps) {
  const log = deps.log ?? (() => {});
  const maxPages = Math.max(2, deps.maxPages ?? 4);
  /** origin -> { view, shownAt } */
  const views = new Map();
  let home = null;
  let active = null;
  let tick = 0;

  const win = () => {
    const value = deps.window();
    return value && !value.isDestroyed() ? value : null;
  };
  const alive = (contents) => Boolean(contents) && !contents.isDestroyed();

  function bounds() {
    const owner = win();
    if (!owner) return null;
    const [width, height] = owner.getContentSize();
    return { x: 0, y: 0, width, height };
  }

  /** The page of `origin`, or null when none is open. */
  function contentsFor(origin) {
    if (!origin) return null;
    const owner = win();
    if (owner && origin === home) return owner.webContents;
    const entry = views.get(origin);
    return entry && alive(entry.view.webContents) ? entry.view.webContents : null;
  }

  /** The account a page belongs to, or null when it is not one of these pages. */
  function originOf(contents) {
    if (!contents) return null;
    const owner = win();
    if (owner && contents === owner.webContents) return home;
    for (const [origin, entry] of views) if (entry.view.webContents === contents) return origin;
    return null;
  }

  /** Any page of the main window: the home page or an account's view. */
  function isPage(contents) {
    if (!contents) return false;
    const owner = win();
    if (owner && contents === owner.webContents) return true;
    for (const entry of views.values()) if (entry.view.webContents === contents) return true;
    return false;
  }

  /** The page on screen: the active account's, else the window's own. */
  function activeContents() {
    const owner = win();
    if (!owner) return null;
    return contentsFor(active) ?? owner.webContents;
  }

  function hideViews(except = null) {
    for (const [origin, entry] of views) {
      if (origin === except) continue;
      try { entry.view.setVisible(false); } catch {}
    }
  }

  function closeView(origin) {
    const entry = views.get(origin);
    if (!entry) return;
    views.delete(origin);
    const owner = win();
    try { owner?.contentView.removeChildView(entry.view); } catch {}
    const contents = entry.view.webContents;
    try { deps.onDropped?.(contents, origin); } catch {}
    try { if (alive(contents)) contents.close(); } catch {}
  }

  /** Close the least recently shown views past the limit. */
  function trim() {
    const open = views.size + (home ? 1 : 0);
    if (open <= maxPages) return;
    const candidates = [...views.entries()]
      .filter(([origin]) => origin !== active)
      .sort((a, b) => a[1].shownAt - b[1].shownAt);
    let excess = open - maxPages;
    for (const [origin] of candidates) {
      if (excess <= 0) break;
      log(`page contexts: closed the page of ${origin} (least recently shown)`);
      closeView(origin);
      excess--;
    }
  }

  /**
   * Show `origin`'s page. An open page is shown as it is; otherwise the page
   * is opened on `url` (the window's own when no account owns it yet, else a
   * new view). Answers the page and whether it was already open.
   */
  function show(origin, url = origin) {
    const owner = win();
    if (!owner || !origin) return null;
    active = origin;
    if (origin === home) {
      hideViews();
      try { owner.webContents.focus(); } catch {}
      return { contents: owner.webContents, reused: true };
    }
    // The window's own page belongs to no account (its account went): an
    // account that has its view keeps it; only one without takes that page.
    const existing = views.get(origin);
    if (!home && !(existing && alive(existing.view.webContents))) {
      if (existing) closeView(origin);
      home = origin;
      hideViews();
      void owner.webContents.loadURL(url).catch(() => {});
      return { contents: owner.webContents, reused: false };
    }
    let entry = views.get(origin);
    let reused = Boolean(entry) && alive(entry.view.webContents);
    if (entry && !reused) closeView(origin);
    if (!reused) {
      const view = deps.createView();
      entry = { view, shownAt: 0 };
      views.set(origin, entry);
      try { deps.onCreated?.(view.webContents, origin); } catch (error) { log(`page contexts: wiring failed (${error?.message ?? error})`); }
      void view.webContents.loadURL(url).catch(() => {});
    }
    entry.shownAt = ++tick;
    const box = bounds();
    if (box) entry.view.setBounds(box);
    // Adding a child again raises it above every other child view.
    owner.contentView.addChildView(entry.view);
    entry.view.setVisible(true);
    hideViews(origin);
    try { entry.view.webContents.focus(); } catch {}
    trim();
    return { contents: entry.view.webContents, reused };
  }

  /**
   * Open `origin`'s page hidden, so a later switch shows it at once. Nothing
   * when it is already open or there is no room left for it.
   */
  function prepare(origin, url = origin) {
    const owner = win();
    if (!owner || !origin || contentsFor(origin) || !home) return null;
    if (views.size + 1 >= maxPages) return null;
    const view = deps.createView();
    const entry = { view, shownAt: 0 };
    views.set(origin, entry);
    try { deps.onCreated?.(view.webContents, origin); } catch (error) { log(`page contexts: wiring failed (${error?.message ?? error})`); }
    const box = bounds();
    if (box) view.setBounds(box);
    view.setVisible(false);
    owner.contentView.addChildView(view);
    void view.webContents.loadURL(url).catch(() => {});
    return view.webContents;
  }

  /**
   * Close `origin`'s page (the account was signed out or forgotten). The
   * window's own page has no view to close: it no longer belongs to any
   * account until the next one is shown in it.
   */
  function drop(origin) {
    if (!origin) return;
    if (origin === home) {
      home = null;
      if (active === origin) active = null;
      // Nothing of that account stays behind the other pages.
      const owner = win();
      if (owner) {
        try { deps.onDropped?.(owner.webContents, origin); } catch {}
        try { void owner.webContents.loadURL("about:blank").catch(() => {}); } catch {}
      }
      return;
    }
    closeView(origin);
    if (active === origin) active = home;
  }

  /** The window's own page now shows `origin` (main loaded it there); it is
   * on screen unless another account already is. */
  function setHome(origin) {
    if (origin && views.has(origin)) closeView(origin);
    home = origin ?? null;
    if (!active) active = home;
  }

  /** Every view follows the window's content size. */
  function layout() {
    const box = bounds();
    if (!box) return;
    for (const entry of views.values()) {
      try { entry.view.setBounds(box); } catch {}
    }
  }

  /** The window went away: its views went with it. */
  function reset() {
    for (const origin of views.keys()) closeView(origin);
    home = null;
    active = null;
  }

  return {
    activeContents,
    activeOrigin: () => active,
    contentsFor,
    drop,
    homeOrigin: () => home,
    isPage,
    layout,
    openOrigins: () => [...(home ? [home] : []), ...views.keys()],
    originOf,
    prepare,
    reset,
    setHome,
    show,
  };
}
