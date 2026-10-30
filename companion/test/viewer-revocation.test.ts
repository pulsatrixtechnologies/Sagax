// The sandbox viewer a phone opens is held under its device: revoking the
// device, or its cloud desktop access, closes the stream it already holds.
import { createServer, request, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { describe, expect, it } from "vitest";
import { createProxyHandler } from "../src/proxy.ts";

const listen = (server: Server) => new Promise<number>((resolve) => {
  server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port));
});
const close = (server: Server) => new Promise<void>((resolve) => {
  server.closeAllConnections();
  server.close(() => resolve());
});

/** Opens the viewer through the sidecar and resolves once it is upgraded. */
const openViewer = (port: number) => new Promise<Duplex>((resolve, reject) => {
  const req = request({
    hostname: "127.0.0.1",
    port,
    path: "/api/desktop-viewer/sandbox/me/websockify",
    headers: {
      authorization: "Bearer fixture-token",
      connection: "Upgrade",
      upgrade: "websocket",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
      "sec-websocket-version": "13",
    },
  });
  req.once("upgrade", (_response, socket) => resolve(socket));
  req.once("response", (response) => reject(new Error(`no upgrade: ${response.statusCode}`)));
  req.once("error", reject);
  req.end();
});

const closed = (socket: Duplex) => new Promise<void>((resolve) => {
  if (socket.destroyed) return resolve();
  socket.once("close", () => resolve());
});
/** The harness side hears the sidecar hang up (its server keeps a half-open socket). */
const hungUp = (socket: Duplex) => new Promise<void>((resolve) => {
  if (socket.destroyed || socket.readableEnded) return resolve();
  socket.once("end", () => resolve());
  socket.once("close", () => resolve());
});

describe("sandbox viewer and device access", () => {
  for (const revoke of ["device", "cloud desktop access"] as const) {
    it(`closes an open viewer when the ${revoke} is revoked`, async () => {
      let valid = true;
      let allowed = true;
      const harnessSides: Duplex[] = [];
      const upstream = createServer();
      upstream.on("upgrade", (_req, socket) => {
        harnessSides.push(socket);
        socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n");
      });
      const upstreamPort = await listen(upstream);
      const handler = createProxyHandler({
        harnessPort: upstreamPort,
        authenticate: (token) => token === "fixture-token" && valid
          ? { id: "fixture-phone", cloudDesktopAccess: allowed, browserControlAccess: false } : null,
        redeem: () => ({ error: "offline fixture" }),
        serverName: () => "Synthetic computer",
      });
      const relay = createServer(handler);
      relay.on("upgrade", (req, socket, head) => handler.upgrade(req, socket, head));
      const relayPort = await listen(relay);
      try {
        const viewer = await openViewer(relayPort);
        expect(viewer.destroyed).toBe(false);
        expect(harnessSides).toHaveLength(1);
        const harnessClosed = hungUp(harnessSides[0]!);

        if (revoke === "device") valid = false; else allowed = false;
        handler.disconnectDevice("fixture-phone");

        await closed(viewer);
        await harnessClosed;
        expect(viewer.destroyed).toBe(true);

        // Another device's revocation leaves a fresh viewer open.
        valid = true;
        allowed = true;
        const fresh = await openViewer(relayPort);
        handler.disconnectDevice("another-phone");
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(fresh.destroyed).toBe(false);
        fresh.destroy();
      } finally {
        for (const socket of harnessSides) socket.destroy();
        await close(relay);
        await close(upstream);
      }
    });
  }
});
