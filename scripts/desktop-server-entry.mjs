// The packaged desktop forks this file instead of the index.js beside it
// (electron/server-child-launch.mjs). It turns on Node's on-disk compile
// cache for this one process, so a relaunch reuses the compiled 5 MB bundle
// instead of parsing and compiling all of it again, then runs the server
// unchanged. Copied verbatim to dist-server/desktop-entry.mjs by
// scripts/bundle-server.mjs: bundling it would inline index.js and defeat
// the point.
import module from "node:module";
import { lstatSync, readdirSync, rmSync, utimesSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const cacheRoot = process.env.SAGAX_SERVER_COMPILE_CACHE;
// Engine CLIs, MCP servers and terminals the server spawns must not inherit
// it. enableCompileCache does not set NODE_COMPILE_CACHE, so they inherit
// nothing from this.
delete process.env.SAGAX_SERVER_COMPILE_CACHE;

let enabled = false;
if (cacheRoot) {
  try {
    enabled = module.enableCompileCache(cacheRoot).status === module.constants.compileCacheStatus.ENABLED;
  } catch {
    // An unusable cache costs only the compile it would have saved.
  }
}

// Open the port before loading the server: the desktop window asks for its
// page while index.js loads and starts (early-listener.js, built from
// server/early-listener.ts). If the port cannot be opened here, index.js
// listens itself and the desktop waits for /api/health, as before.
const port = Number(process.env.SAGAX_PORT);
if (process.env.SAGAX_DESKTOP_PARENT === "1" && process.env.SAGAX_STATIC_DIR && Number.isInteger(port) && port > 0) {
  try {
    const { PORT_OPEN_MESSAGE, startEarlyListener } = await import("./early-listener.js");
    globalThis.__sagaxEarlyListener = await startEarlyListener({ port, staticDir: process.env.SAGAX_STATIC_DIR });
    // The desktop opens its window on this (electron/main.mjs startServerOn):
    // its requests wait in the port until the server can answer them.
    if (globalThis.__sagaxEarlyListener) process.parentPort?.postMessage({ type: PORT_OPEN_MESSAGE, port });
  } catch {
    globalThis.__sagaxEarlyListener = null;
  }
}

await import("./index.js");

// Node writes new entries when the process exits normally; a crash or a
// Windows kill skips that, so write them once the server is up. Then drop
// caches of other Node versions (one is left behind by each Electron
// upgrade) that no launch has used for a day. Only `v<node version>-…`
// directories inside the cache root Node reports are ever removed.
if (enabled) {
  setTimeout(() => {
    try {
      module.flushCompileCache();
      const current = module.getCompileCacheDir();
      if (dirname(current) !== resolve(cacheRoot)) return;
      const now = new Date();
      utimesSync(current, now, now);
      for (const name of readdirSync(cacheRoot)) {
        if (name === basename(current) || !/^v\d+\.\d+\.\d+-/.test(name)) continue;
        const stale = join(cacheRoot, name);
        const stat = lstatSync(stale);
        if (stat.isDirectory() && now - stat.mtimeMs > 24 * 60 * 60 * 1000) {
          rmSync(stale, { recursive: true, force: true });
        }
      }
    } catch {
      // Best effort: anything not written or removed now is retried next launch.
    }
  }, 10_000).unref();
}
