// Published pages (server/routes/published-pages.ts) inside this app's
// window: the preview in Pages publiées and on a page's card is a Sagax
// wrapper (/pages/preview/...) that frames the page itself
// (/pages/preview-frame/... or /pages/frame/...). A page runs sandboxed with
// scripts; the one thing a sandbox cannot forbid is navigating its own
// frame, which would carry data out in the address. The wrapper's CSP pins
// the frame to its exact path; this is the second lock, in the app:
//
// - a page frame may navigate only to its own exact address (same origin,
//   same path), never anywhere else;
// - a frame inside a wrapper may only load a page frame path.
//
// Every other frame is not this guard's business (null).
const FRAME_PATHS = ["/pages/frame/", "/pages/preview-frame/"];
const WRAPPER_PATHS = ["/pages/view/", "/pages/preview/"];

function parse(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

const isFrame = (url) => Boolean(url) && FRAME_PATHS.some((prefix) => url.pathname.startsWith(prefix));
const isWrapper = (url) => Boolean(url) && WRAPPER_PATHS.some((prefix) => url.pathname.startsWith(prefix));

/** true: let it go; false: block it; null: not a published page's frame. */
export function pageFrameNavigationAllowed({ currentUrl, parentUrl, targetUrl }) {
  const current = parse(currentUrl ?? "");
  const parent = parse(parentUrl ?? "");
  const target = parse(targetUrl ?? "");
  if (isFrame(current)) {
    return Boolean(target) && target.origin === current.origin && target.pathname === current.pathname;
  }
  if (isWrapper(parent)) return isFrame(target) && (target.protocol === "https:" || target.protocol === "http:");
  return null;
}

/** For a will-frame-navigate `details`: true when it must be prevented. */
export function blockPageFrameNavigation(details) {
  if (details?.isMainFrame) return false;
  const frame = details?.frame ?? null;
  // A subframe whose frame is unknown (already gone): fail closed.
  if (!frame) return true;
  let currentUrl = "";
  let parentUrl = "";
  try {
    currentUrl = frame?.url ?? "";
    parentUrl = frame?.parent?.url ?? "";
  } catch {
    // a frame already gone: nothing to guard
  }
  return pageFrameNavigationAllowed({ currentUrl, parentUrl, targetUrl: details?.url }) === false;
}
