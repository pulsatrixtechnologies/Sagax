/**
 * The one place a published page's frame is watched, for every window of
 * this app: the ones that exist today (the main window and each account's
 * page, an artifact's or a page's own window, the Data window, the floating
 * bots, Hibou 98) and any window added later.
 *
 * Two things happen on a subframe navigation (will-frame-navigate, which
 * knows it is a subframe and runs before the request goes out):
 *
 * 1. The published page frame guard (electron/page-frame-guard.mjs): a page
 *    frame may only reload its own address and a wrapper may only frame a
 *    page frame path. A refused navigation is prevented, and nothing else is
 *    done for it.
 * 2. The bundled UI handler is told that this address is being loaded as an
 *    iframe (electron/bundled-ui.cjs createPageFrameLoads): on an
 *    organization server the handler passes the request through net.fetch,
 *    which cannot say what the request is for, and the server answers a
 *    page frame only to an iframe (Sec-Fetch-Dest). Each window used to hook
 *    this itself (0.8.12: the main window, then 0.8.14: the artifact
 *    window), and every window that forgot drew a blank page. Now
 *    `installPageFrameWatch` hooks every WebContents the app creates, once,
 *    from app's `web-contents-created`; a window module never has to know.
 *
 * Pure apart from the injected guard and note, so node:test covers it with
 * fake contents.
 */

/**
 * Watch one WebContents (a window's page, a view, a frame host).
 *
 * @param {{ on(event: string, listener: (...args: any[]) => void): unknown }} contents
 * @param {{
 *   block: (details: unknown) => boolean,   true when the guard refuses this subframe navigation
 *   expect: (url: string) => unknown,       a subframe is about to load this address (a page frame is noted, anything else ignored)
 *   log?: (line: string) => void,
 * }} deps
 */
export function watchPageFrames(contents, deps) {
  const log = deps.log ?? (() => {});
  contents.on("will-frame-navigate", (details) => {
    if (!details || details.isMainFrame) return;
    let blocked = false;
    try {
      blocked = deps.block(details) === true;
    } catch (error) {
      // the guard failed closed on an unreadable frame: refuse it
      blocked = true;
      log(`page frame guard failed (${error?.message ?? error}); the navigation was refused`);
    }
    if (blocked) {
      details.preventDefault?.();
      log("blocked a published page's frame navigation");
      return;
    }
    try {
      deps.expect(String(details.url ?? ""));
    } catch (error) {
      log(`page frame note failed (${error?.message ?? error})`);
    }
  });
}

/**
 * Watch every WebContents the app creates from now on. Returns a function
 * that stops watching new ones (the ones already watched stay watched).
 *
 * @param {{ on(event: "web-contents-created", listener: (event: unknown, contents: any) => void): unknown, off?(event: string, listener: (...args: any[]) => void): unknown, removeListener?(event: string, listener: (...args: any[]) => void): unknown }} app
 * @param {Parameters<typeof watchPageFrames>[1]} deps
 */
export function installPageFrameWatch(app, deps) {
  const listener = (_event, contents) => {
    if (!contents || typeof contents.on !== "function") return;
    watchPageFrames(contents, deps);
  };
  app.on("web-contents-created", listener);
  return () => {
    (app.off ?? app.removeListener)?.call(app, "web-contents-created", listener);
  };
}
