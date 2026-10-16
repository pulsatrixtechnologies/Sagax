// The packaged desktop's server opens its port before it has loaded.
//
// Loading the server (a 13 MB bundle) and starting it up (stores, sessions,
// providers) takes about 0.4 s on a quiet Mac and more on a busy one. The
// desktop window used to wait for all of it before it even asked for the
// page, so the window's own start (its renderer, the page, 200 scripts) came
// on top. desktop-entry.mjs starts this listener first, on the same port:
//
//   - the page and its scripts (GET / and /assets/*, from the loopback
//     address the window uses) are answered from the UI folder at once, the
//     same way the server answers them (server/static-ui.ts);
//   - the desktop's main process is told the port is open (a message on
//     the utility process's private parent port, desktop-entry.mjs), so the
//     window opens now instead of after the server's own /api/health;
//   - every other request waits, untouched, and is handed to the server's
//     own handler the moment it is ready (adopt), in arrival order. Nothing
//     about who may do what is decided here.
//
// server/index.ts takes this listener over as its HTTP server: its upgrade
// handlers, the desktop viewer and everything else attach to it as before.
// When the port cannot be opened here, the server listens itself and fails
// or succeeds exactly as it did without this.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { serveStaticUi } from "./static-ui.ts";

/** What desktop-entry.mjs tells the desktop once the port is open. */
export const PORT_OPEN_MESSAGE = "sagax:server-port-open";

type Handler = (req: IncomingMessage, res: ServerResponse) => unknown;

export interface EarlyListener {
  readonly server: Server;
  /** The server's handler takes every request from now on, those waiting first. */
  adopt(handler: Handler): void;
}

/** Answered here before the server is ready: the page and its hashed assets. */
function earlyStatic(req: IncomingMessage, port: number): string | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const host = req.headers.host?.toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return null;
  let path: string;
  try {
    path = new URL(req.url ?? "/", `http://127.0.0.1:${port}`).pathname;
  } catch {
    return null;
  }
  return path === "/" || path.startsWith("/assets/") ? path : null;
}

export function startEarlyListener(options: {
  port: number;
  staticDir: string;
  /** Tests: where the listener says it is up or could not open the port. */
  onListening?: () => void;
  onError?: (error: Error) => void;
}): Promise<EarlyListener | null> {
  const { port, staticDir } = options;
  let handler: Handler | null = null;
  const waiting: Array<[IncomingMessage, ServerResponse]> = [];
  const server = createServer((req, res) => {
    if (handler) return void handler(req, res);
    const path = earlyStatic(req, port);
    // A file this folder does not hold is the server's to answer (its SPA
    // fallback, a 404), once it is ready.
    if (path && serveStaticUi(res, staticDir, path, { fallback: false })) return;
    waiting.push([req, res]);
  });
  const listener: EarlyListener = {
    server,
    adopt(next) {
      handler = next;
      for (const [req, res] of waiting.splice(0)) void next(req, res);
    },
  };
  return new Promise((resolve) => {
    const failed = (error: Error) => {
      options.onError?.(error);
      server.close();
      resolve(null);
    };
    server.once("error", failed);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", failed);
      options.onListening?.();
      resolve(listener);
    });
  });
}
