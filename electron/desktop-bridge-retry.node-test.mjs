import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createDesktopBridge } from "./desktop-bridge.mjs";

test("tunnel retries keep one cancellation listener and close the current tunnel", async (context) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-bridge-retry-"));
  context.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const signals = [];
  const any = AbortSignal.any;
  context.mock.method(AbortSignal, "any", (sources) => {
    const signal = any(sources);
    signals.push(signal);
    return signal;
  });
  const sockets = [];
  class Socket {
    constructor() {
      sockets.push(this);
      queueMicrotask(() => {
        if (sockets.length < 20) this.onerror();
        else this.onopen();
      });
    }
    close() { this.closed = true; this.onclose(); }
  }
  const bridge = createDesktopBridge({
    environment: () => ({ id: "org", name: "Example", origin: "https://example.test" }),
    fetch: async (url, options) => {
      const route = new URL(url).pathname;
      if (route.endsWith("/poll")) await delay(60_000, undefined, { signal: options.signal });
      const body = route === "/api/auth/session" ? { kind: "session", identity: "perspicax" }
        : route === "/api/me/preferences" ? { preferences: {} } : { ok: true };
      return new Response(JSON.stringify(body));
    },
    cookieHeader: async () => "", WebSocketImpl: Socket, retryMs: 1,
    home, attachmentsDir: path.join(home, "attachments"), activityFile: path.join(home, "activity.jsonl"),
    systemInfo: async () => ({ info: {}, sample: null }),
  });
  context.after(() => bridge.close());
  bridge.sync();
  for (let attempt = 0; attempt < 200 && sockets.length < 20; attempt++) await delay(5);
  assert.equal(sockets.length, 20, "the tunnel retried while the same registration stayed active");
  assert.equal(bridge.state().connected, true);
  assert.ok(getEventListeners(signals[0], "abort").length <= 8, "retries must not add listeners to the registration");
  bridge.close();
  assert.equal(sockets.at(-1).closed, true, "cancelling closes the currently connected socket");
  await delay(10);
  assert.equal(sockets.length, 20, "cancelling stops retries");
});
