// The built UI, when this process serves it (SAGAX_STATIC_DIR: set by the
// desktop app and by the container image). Public by design: it is the same
// bundle anyone can download, holds no secrets, and a remote browser must be
// able to load /pair before it has a session. Shared by the server and by
// the packaged desktop's early listener (server/early-listener.ts), so both
// answer a file the same way.
import type { ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";

export const UI_MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp3": "audio/mpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
};

/** The web UI's pages: never framed by another page (a hidden frame could
 * otherwise act on a pair or sign-in page unseen), and they send no Referer.
 * Nothing frames the web UI: the desktop app shows it in its own window. */
export const PAGE_HEADERS = { "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY", "referrer-policy": "no-referrer" } as const;

/** The file under `staticDir` for `path`, written to `res`. With
 * `fallback`, a path with no file is the SPA page; without it, false and
 * nothing written. False also when there is nothing to serve, so the caller
 * can answer 404. */
export function serveStaticUi(res: ServerResponse, staticDir: string | null, path: string, { fallback = true }: { fallback?: boolean } = {}): boolean {
  if (!staticDir) return false;
  const safe = path === "/" ? "/index.html" : path.replace(/\.\./g, "");
  const file = join(staticDir, safe);
  let data: Buffer;
  try {
    data = readFileSync(file);
  } catch {
    if (!fallback) return false;
    // SPA fallback. Never immutable: a missing chunk answered with the page
    // must not stay cached under the chunk's URL.
    try {
      const page = readFileSync(join(staticDir, "index.html"));
      res.writeHead(200, { "content-type": "text/html", "cache-control": "no-cache", ...PAGE_HEADERS });
      res.end(page);
      return true;
    } catch {
      return false;
    }
  }
  const type = UI_MIME[extname(file)] ?? "application/octet-stream";
  // Vite puts a content hash in the name of every file it writes under
  // /assets/, so a URL there never changes: the browser keeps it instead of
  // downloading the bundle on every load. That only holds while public/ has
  // no assets/ dir (index.test.ts checks). Pages are revalidated, so a new
  // build shows up on the next load.
  const cache = type === "text/html" ? "no-cache" : safe.startsWith("/assets/") ? "public, max-age=31536000, immutable" : null;
  res.writeHead(200, { "content-type": type, ...(type === "text/html" ? PAGE_HEADERS : {}), ...(cache ? { "cache-control": cache } : {}) });
  res.end(data);
  return true;
}
