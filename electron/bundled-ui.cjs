// The desktop's own UI on an organization server's origin.
//
// A remote environment used to load the server's own served page, built from
// whatever image is deployed there: another version of the UI than the app
// the person installed, and without the desktop-only parts. For an
// organization server (environments.cjs `org: true`), the main window still
// navigates to the server's origin, but every page request (the document,
// scripts, styles, images, fonts) is answered from THIS app's bundle, while
// the server keeps everything that is the server's: /api/*, /.well-known/*
// and /auth/* (the OIDC start and callback). The page therefore stays
// same-origin with its API: the session cookie (HttpOnly, SameSite) rides as
// before, no CORS, no token in the renderer, and the server's authorization
// is unchanged. Only the code that draws the page comes from the desktop.
//
// Electron routes a scheme to one handler (protocol.handle), so requests to
// any other origin are passed through untouched, with
// bypassCustomProtocolHandlers. Pure apart from the injected fetch and file
// reader, so node:test covers every rule.
const path = require("node:path");

/** Paths the server answers itself; everything else is the UI. */
const SERVER_PREFIXES = ["/api/", "/.well-known/", "/auth/"];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".glb": "model/gltf-binary",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
};

/** True when the server owns this path (the API, discovery, OIDC). */
function servedByServer(pathname) {
  if (typeof pathname !== "string") return true;
  return SERVER_PREFIXES.some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix));
}

/**
 * What to do with one request.
 *   { kind: "pass" }                 another origin, or the server's own path
 *   { kind: "redirect", location }  the old invitation page: an organization
 *                                    server sends it to sign-in (server/index.ts)
 *   { kind: "bundle", pathname }     the UI, from this app's bundle
 */
function routeRequest({ url, method }, bundled) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return { kind: "pass" };
  }
  if (!bundled || target.origin !== bundled) return { kind: "pass" };
  if (method !== "GET" && method !== "HEAD") return { kind: "pass" };
  if (servedByServer(target.pathname)) return { kind: "pass" };
  if (target.pathname === "/join" || target.pathname === "/join/") return { kind: "redirect", location: `${bundled}/pair` };
  return { kind: "bundle", pathname: target.pathname };
}

/** The file for a UI path inside the bundle, or null. A path with no
 * extension is a page of the single-page app: index.html. A missing asset is
 * a 404, never the app shell (a stale script must fail loudly). */
function bundleFile(staticDir, pathname) {
  if (typeof staticDir !== "string" || !staticDir) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const root = path.resolve(staticDir);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  const extension = path.extname(file).toLowerCase();
  if (!extension) return { file: path.join(root, "index.html"), type: MIME[".html"], fallback: true };
  return { file, type: MIME[extension] ?? "application/octet-stream", fallback: false };
}

/** Whether a request to the organization server was sent BY the bundled
 * page itself. Chromium hands a custom handler neither the Origin header nor
 * the real credentials mode, so the referrer is the only witness: the
 * bundled page's own requests carry its URL (the default policy keeps the
 * full same-origin URL). A sandboxed widget (srcdoc, opaque origin), a page
 * of another origin, or a request with no referrer is not the page. */
function fromBundledPage(request, bundled) {
  if (!bundled) return false;
  try {
    return new URL(request.referrer).origin === bundled && new URL(request.url).origin === bundled;
  } catch {
    return false;
  }
}

/** Headers for a pass-through to the organization server. The server checks
 * Origin on cookie writes (server/request-auth.ts isSameOrigin), so a write
 * sent by the bundled page carries that origin again. Any other request gets
 * none, and no cookie either (see createBundledUiHandler). */
function passThroughHeaders(request, bundled) {
  const headers = new Headers(request.headers);
  headers.delete("origin");
  if (request.method === "GET" || request.method === "HEAD") return headers;
  if (fromBundledPage(request, bundled)) headers.set("origin", bundled);
  return headers;
}

const BUNDLE_HEADERS = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

/**
 * @param {{
 *   origin: () => string | null,              the bundled origin right now
 *   staticDir?: () => string | null,          the built UI (packaged: resources/ui)
 *   devOrigin?: () => string | null,          the Vite dev server when unpackaged
 *   fetch: (input: any, init?: any) => Promise<Response>,  net.fetch
 *   readFile: (file: string) => Promise<Uint8Array>,
 *   log?: (line: string) => void,
 * }} deps
 */
function createBundledUiHandler(deps) {
  const log = deps.log ?? (() => {});
  const bypass = { bypassCustomProtocolHandlers: true };
  return async function handle(request) {
    const bundled = deps.origin();
    const route = routeRequest(request, bundled);
    if (route.kind === "pass") {
      if (!bundled || new URL(request.url).origin !== bundled) return deps.fetch(request, bypass);
      // The session cookie rides only with the bundled page's own requests,
      // like SameSite would keep it from a cross-site one: a bot-made widget
      // or another origin's frame reaches the API signed out. This app's
      // main process calls the server with bypassCustomProtocolHandlers and
      // never comes through here.
      const init = {
        ...bypass,
        method: request.method,
        headers: passThroughHeaders(request, bundled),
        credentials: fromBundledPage(request, bundled) ? "include" : "omit",
        redirect: "follow",
      };
      if (request.method !== "GET" && request.method !== "HEAD" && request.body) {
        init.body = request.body;
        init.duplex = "half";
      }
      return deps.fetch(request.url, init);
    }
    if (route.kind === "redirect") {
      return new Response(null, { status: 302, headers: { location: route.location, "cache-control": "no-store" } });
    }
    const search = new URL(request.url).search;
    const dev = deps.devOrigin?.();
    if (dev) {
      // Development: the page comes from Vite, like the local window's.
      const upstream = await deps.fetch(`${dev}${route.pathname}${search}`, bypass);
      const headers = new Headers(BUNDLE_HEADERS);
      const type = upstream.headers.get("content-type");
      if (type) headers.set("content-type", type);
      return new Response(request.method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
    }
    const target = bundleFile(deps.staticDir?.(), route.pathname);
    if (!target) return new Response("Not found", { status: 404, headers: BUNDLE_HEADERS });
    try {
      const data = await deps.readFile(target.file);
      return new Response(request.method === "HEAD" ? null : data, { status: 200, headers: { ...BUNDLE_HEADERS, "content-type": target.type } });
    } catch {
      if (!target.fallback) log(`bundled UI: no ${route.pathname} in this app's bundle`);
      return new Response("Not found", { status: 404, headers: BUNDLE_HEADERS });
    }
  };
}

/**
 * Serve the bundle and nothing else: for the floating bot and Hibou 98
 * windows when this app runs no local server (server mode). They live in
 * their own in-memory session, so they hold no cookie of any server, and
 * every request that is not a UI file is refused.
 */
const DETACHED_UI_ORIGIN = "https://ui.sagax.invalid";
function createDetachedUiHandler(deps) {
  const inner = createBundledUiHandler({ ...deps, origin: () => DETACHED_UI_ORIGIN });
  return async function handle(request) {
    const route = routeRequest(request, DETACHED_UI_ORIGIN);
    if (route.kind !== "bundle") return new Response("Not available", { status: 403, headers: BUNDLE_HEADERS });
    return inner(request);
  };
}

module.exports = {
  DETACHED_UI_ORIGIN,
  bundleFile,
  createBundledUiHandler,
  createDetachedUiHandler,
  fromBundledPage,
  passThroughHeaders,
  routeRequest,
  servedByServer,
};
