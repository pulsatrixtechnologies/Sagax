// Live control of a connected Tailcat session, over a WebSocket on the app's
// own origin (same upgrade plumbing as the in-chat terminal). The browser
// sends grant toggles and validated input events as text; the server streams
// the helper's screen metadata as text and its JPEG frames as binary. The
// tunnel address and the keys never cross this socket.
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";

import { isSameOrigin, type RequestAuth } from "../request-auth.ts";
import { websocketAccept } from "../ws-bridge.ts";
import { webSocketSession } from "../ws-session.ts";
import { parseControlEvent, type ControlEvent } from "../../shared/remote-control.ts";
import { PASS, type RouteHandler } from "./table.ts";
import type { ControlHandle, OpenControl } from "../remote-control-session.ts";

const CONTROL = /^\/api\/bots\/([\w-]{1,80})\/remote-sessions\/([a-f0-9]{12})\/control$/;
/** Enough for a burst of input; frames only go the other way. */
const WS_MAX_BYTES = 128 * 1024;
const EVENTS_PER_MESSAGE = 200;

export function isRemoteControlPath(path: string): boolean {
  return CONTROL.test(path);
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

export interface OpenControlRequest {
  principalId: string;
  botId: string;
  id: string;
  onMeta: OpenControl["onMeta"];
  onFrame: OpenControl["onFrame"];
  onClosed: OpenControl["onClosed"];
}

export interface RemoteControlRouteDeps {
  principalId(auth: RequestAuth): string | undefined;
  live(auth: RequestAuth): boolean;
  /** Open the control helper for a session this person owns, or an error. */
  openControl(input: OpenControlRequest): ControlHandle | { error: string };
  upgrade?(req: IncomingMessage): { socket: Socket; head: Buffer; release(): void } | undefined;
}

export function createRemoteControlRoutes(deps: RemoteControlRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json }) => {
    const match = CONTROL.exec(path);
    if (!match) return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const botId = match[1]!;
    const id = match[2]!;
    const principalId = deps.principalId(auth);
    if (!principalId) return json(res, 401, { error: "Sign in to control a remote session." });

    const upgrade = deps.upgrade?.(req);
    if (!upgrade) return json(res, 426, { error: "WebSocket upgrade required" });
    const shake = handshake(req);
    if ("status" in shake) return json(res, shake.status, { error: shake.error });
    if (!deps.live(auth)) return json(res, 401, { error: "Session expired" });

    const { socket } = upgrade;
    upgrade.release();
    res.detachSocket(socket);
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${websocketAccept(shake.key)}\r\n\r\n`,
    );

    let handle: ControlHandle | null = null;
    const ws = webSocketSession(socket, {
      onText(text) {
        if (!handle) return;
        let message: unknown;
        try { message = JSON.parse(text); } catch { return; }
        if (!message || typeof message !== "object" || Array.isArray(message)) return;
        const record = message as Record<string, unknown>;
        if (record.t === "grant") {
          handle.setControl(record.on === true);
          return;
        }
        if (record.t === "ev" && Array.isArray(record.e)) {
          const events: ControlEvent[] = [];
          for (const raw of record.e.slice(0, EVENTS_PER_MESSAGE)) {
            const ev = parseControlEvent(raw);
            if (ev) events.push(ev);
          }
          if (events.length) handle.input(events);
        }
      },
      onClose() {
        handle?.close("closed");
      },
    }, WS_MAX_BYTES);

    const opened = deps.openControl({
      principalId,
      botId,
      id,
      onMeta: (meta) => ws.sendText(JSON.stringify({ t: "meta", w: meta.w, h: meta.h })),
      onFrame: (bytes) => ws.sendBinary(bytes),
      onClosed: (reason) => {
        ws.sendText(JSON.stringify({ t: "closed", reason }));
        ws.close();
      },
    });
    if ("error" in opened) {
      ws.sendText(JSON.stringify({ t: "error", message: opened.error }));
      ws.close();
      return;
    }
    handle = opened;
    return;
  };
}
