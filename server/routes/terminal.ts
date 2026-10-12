import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import { z } from "zod";

import { isSameOrigin, type RequestAuth } from "../request-auth.ts";
import { encodeWebSocketFrame, websocketAccept, webSocketFrameDecoder } from "../ws-bridge.ts";
import { PASS, type RouteHandler } from "./table.ts";
import type { createTerminalSessionManager } from "../terminal-sessions.ts";
import type { TerminalResourceRegistry } from "../terminal-resources/registry.ts";

const SESSION = /^\/api\/terminal\/sessions\/([\w-]+)(?:\/(ws|bot-input|close))?$/;

export interface TerminalRouteDeps {
  registry: TerminalResourceRegistry;
  sessions: ReturnType<typeof createTerminalSessionManager>;
  principalId(auth: RequestAuth): string | undefined;
  live(auth: RequestAuth): boolean;
  /** Pending upgrade from routes/desktop-viewer.ts (authenticated like HTTP). */
  upgrade?(req: IncomingMessage): { socket: Socket; head: Buffer; release(): void } | undefined;
}

function handshake(req: IncomingMessage): { key: string } | { status: number; error: string } {
  if (!isSameOrigin(req)) return { status: 403, error: "forbidden" };
  const wsKey = req.headers["sec-websocket-key"];
  if (req.headers.upgrade?.toLowerCase() !== "websocket" || req.headers["sec-websocket-version"] !== "13"
    || typeof wsKey !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(wsKey)) {
    return { status: 400, error: "Invalid WebSocket handshake" };
  }
  return { key: wsKey };
}

export function createTerminalRoutes(deps: TerminalRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/terminal/resources" && method === "GET") {
      const principalId = deps.principalId(auth);
      if (!principalId) return json(res, 401, { error: "Sign in to list terminal resources." });
      const resources = await deps.registry.listAll({
        auth,
        principalId,
        botId: typeof req.headers["x-sagax-bot-id"] === "string" ? req.headers["x-sagax-bot-id"] : undefined,
      });
      return json(res, 200, { resources });
    }

    const match = SESSION.exec(path);
    if (!match) return PASS;
    const sessionId = match[1]!;
    const action = match[2];
    const principalId = deps.principalId(auth);
    if (!principalId) return json(res, 401, { error: "Sign in to use the terminal." });

    if (action === "ws" && method === "GET") {
      const upgrade = deps.upgrade?.(req);
      if (!upgrade) return json(res, 426, { error: "WebSocket upgrade required" });
      const shake = handshake(req);
      if ("status" in shake) return json(res, shake.status, { error: shake.error });
      if (!deps.live(auth)) return json(res, 401, { error: "Session expired" });
      const attachment = deps.sessions.attachIo(sessionId, principalId);
      if (!attachment) return json(res, 404, { error: "Session not found" });
      const { socket } = upgrade;
      upgrade.release();
      const head = upgrade.head;
      res.detachSocket(socket);
      socket.write(
        `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAccept(shake.key)}\r\n\r\n`,
      );
      const decode = webSocketFrameDecoder();
      const closeBridge = () => {
        attachment.close();
        socket.destroy();
      };
      attachment.output.on("data", (chunk: Buffer) => {
        if (!socket.destroyed) socket.write(encodeWebSocketFrame(2, chunk));
      });
      const onData = (chunk: Buffer) => {
        deps.sessions.noteActivity(sessionId, principalId);
        const frames = decode(chunk);
        if (!Array.isArray(frames)) {
          closeBridge();
          return;
        }
        for (const frame of frames) {
          if (frame.opcode === 1 || frame.opcode === 2) attachment.input.write(frame.payload);
          if (frame.opcode === 8) closeBridge();
        }
      };
      if (head.length) onData(head);
      socket.on("data", onData);
      socket.on("close", closeBridge);
      attachment.output.on("end", closeBridge);
      return;
    }

    if (action === "bot-input" && method === "POST") {
      const body = z.object({ allowed: z.boolean() }).strict().safeParse(await readBody(req));
      if (!body.success) return json(res, 400, { error: "Send { allowed: true|false }" });
      if (!deps.sessions.setBotInput(sessionId, principalId, body.data.allowed)) return json(res, 404, { error: "Session not found" });
      return json(res, 200, { ok: true });
    }

    if (action === "close" && method === "POST") {
      if (!deps.sessions.close(sessionId, principalId)) return json(res, 404, { error: "Session not found" });
      return json(res, 200, { ok: true });
    }

    if (!action && method === "GET") {
      const session = deps.sessions.get(sessionId);
      if (!session) return json(res, 404, { error: "Session not found" });
      return json(res, 200, { session });
    }

    return PASS;
  };
}
