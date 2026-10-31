// Relayed viewer WebSockets must not take the sidecar down on a network
// blip, and closeAllRelays must drop them so companion.close() can finish.
import { EventEmitter } from "node:events";
import { createServer, request, type Server } from "node:http";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";

import { createProxyHandler } from "../src/proxy.ts";
import { attachRelayErrorHandlers } from "../src/relay-sockets.ts";
import { CompanionViewerRelay } from "../src/viewer-relay.ts";

const servers: Server[] = [];
const sockets: Duplex[] = [];

const listen = (server: Server): Promise<number> =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));

const close = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  await Promise.all(servers.splice(0).map(close));
});

const watchingForCrashes = async (body: () => Promise<void>): Promise<Error[]> => {
  const escaped: Error[] = [];
  const onUncaught = (error: Error) => escaped.push(error);
  process.on("uncaughtException", onUncaught);
  try {
    await body();
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    process.off("uncaughtException", onUncaught);
  }
  return escaped;
};

const openSandboxViewer = (port: number) =>
  new Promise<Duplex>((resolve, reject) => {
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

describe("attachRelayErrorHandlers", () => {
  it("swallows an error on either side instead of letting it escape", async () => {
    const escaped = await watchingForCrashes(async () => {
      const socket = new EventEmitter() as EventEmitter & { destroy: () => void };
      const remote = new EventEmitter() as EventEmitter & { destroy: () => void };
      socket.destroy = () => undefined;
      remote.destroy = () => undefined;
      attachRelayErrorHandlers(socket as unknown as Duplex, remote as unknown as Duplex);
      socket.emit("error", new Error("read ECONNRESET"));
      remote.emit("error", new Error("write EPIPE"));
    });
    expect(escaped).toEqual([]);
  });

  it("destroys the peer when one side errors", () => {
    const socket = new EventEmitter() as EventEmitter & { destroy: () => void };
    const remote = new EventEmitter() as EventEmitter & { destroy: () => void };
    const destroyed: string[] = [];
    socket.destroy = () => { destroyed.push("socket"); };
    remote.destroy = () => { destroyed.push("remote"); };
    attachRelayErrorHandlers(socket as unknown as Duplex, remote as unknown as Duplex);
    socket.emit("error", new Error("boom"));
    expect(destroyed).toEqual(["remote"]);
    remote.emit("error", new Error("boom"));
    expect(destroyed).toEqual(["remote", "socket"]);
  });
});

describe("relayed WebSocket shutdown", () => {
  it("closeAllRelays drops an upgraded sandbox viewer so the server can close", async () => {
    const harnessSides: Duplex[] = [];
    const upstream = createServer();
    upstream.on("upgrade", (_req, socket) => {
      harnessSides.push(socket);
      sockets.push(socket);
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
          + "Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n\r\n",
      );
    });
    servers.push(upstream);
    const upstreamPort = await listen(upstream);
    const handler = createProxyHandler({
      harnessPort: upstreamPort,
      authenticate: () => ({ id: "fixture-phone", cloudDesktopAccess: true, browserControlAccess: false }),
      redeem: () => ({ error: "offline fixture" }),
      serverName: () => "Synthetic computer",
    });
    const relay = createServer(handler);
    relay.on("upgrade", (req, socket, head) => handler.upgrade(req, socket, head));
    servers.push(relay);
    const relayPort = await listen(relay);

    const viewer = await openSandboxViewer(relayPort);
    sockets.push(viewer);
    expect(viewer.destroyed).toBe(false);

    const closed = new Promise<void>((resolve) => viewer.once("close", () => resolve()));
    handler.closeAllRelays();
    await expect(Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("viewer stayed open")), 2_000)),
    ])).resolves.toBeUndefined();
    expect(viewer.destroyed).toBe(true);

    await expect(new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("server.close hung")), 2_000);
      relay.close(() => {
        clearTimeout(timer);
        resolve();
      });
    })).resolves.toBeUndefined();
  });

  it("closeAll drops VPS viewer sockets so the sidecar can stop", async () => {
    const viewer = createServer();
    viewer.on("upgrade", (_req, socket) => {
      sockets.push(socket);
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
          + "Sec-WebSocket-Accept: test\r\n\r\n",
      );
    });
    servers.push(viewer);
    const viewerPort = await listen(viewer);

    const relay = new CompanionViewerRelay();
    const rewritten = relay.rewriteJoinResponse(
      "/api/bots/bot-1/computer/join",
      { joinUrl: `http://127.0.0.1:${viewerPort}/vnc.html#password=secret` },
      "device-1",
    ) as { joinUrl: string };
    const sessionId = rewritten.joinUrl.split("/")[2];
    const sidecar = createServer();
    sidecar.on("upgrade", (req, socket, head) =>
      relay.handleUpgrade(req, socket, head, { id: "device-1", cloudDesktopAccess: true }));
    servers.push(sidecar);
    const sidecarPort = await listen(sidecar);

    const client = await new Promise<Duplex>((resolve, reject) => {
      const req = request({
        hostname: "127.0.0.1",
        port: sidecarPort,
        path: `/vps-viewer/${sessionId}/websockify`,
        headers: {
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
    sockets.push(client);
    expect(client.destroyed).toBe(false);

    const closed = new Promise<void>((resolve) => client.once("close", () => resolve()));
    relay.closeAll();
    await expect(Promise.race([
      closed,
      new Promise((_, reject) => setTimeout(() => reject(new Error("viewer stayed open")), 2_000)),
    ])).resolves.toBeUndefined();
  });
});
