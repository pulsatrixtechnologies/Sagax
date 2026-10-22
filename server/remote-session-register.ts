// A remote support session the bot opened with its own tool call becomes a
// Sagax session: a row in the bot panel and a card in the chat. Both the
// agents catalog tool (server/remote-support-local.ts, through
// /api/internal/perspicax/tool) and a Perspicax MCP profile the engine mounts
// directly reach Perspicax through PerspicaxMcp.relay, which hands every
// remote_support_* answer here. Nothing here reads or keeps the tunnel
// address: the open call carries the session id, the rights, the OS and the
// end time; the status call says when it is connected; the close call ends it.
import {
  parseRemoteSessionCode,
  parseRemoteSessionId,
  parseRemoteSessionOs,
  type RemoteSessionOs,
} from "../shared/remote-session.ts";

export interface RemoteSupportCall {
  threadId: string;
  botId: string;
  name: string;
  args: unknown;
  /** The MCP `result` object (content, structuredContent, isError). */
  result: unknown;
}

export interface RegisteredOpen {
  id: string;
  code: string;
  elevated: boolean;
  endAt: string;
  os?: RemoteSessionOs;
}

const MAX_OPEN = 200;
const DAY_MS = 26 * 60 * 60 * 1000;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The JSON object a tool answered: structuredContent, else the first text block parsed. */
export function toolResultObject(result: unknown): Json | null {
  if (!isObject(result) || result.isError === true) return null;
  if (isObject(result.structuredContent)) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  for (const block of content) {
    if (!isObject(block) || typeof block.text !== "string") continue;
    try {
      const parsed = JSON.parse(block.text) as unknown;
      if (isObject(parsed)) return parsed;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

export function createRemoteSessionRegistrar(deps: {
  /** Post or refresh the card and the panel row (RemoteSessionService.publish). */
  publish(input: { botId: string; threadId: string; open: RegisteredOpen }): Promise<unknown>;
  /** Mark the card closed (RemoteSessionService.endByCode). */
  end(input: { botId: string; threadId: string; code: string }): Promise<unknown>;
  /** A session opened before a restart: what the support folder kept for this code. */
  recall?(code: string): RegisteredOpen | null;
  now?: () => number;
}) {
  const now = deps.now ?? (() => Date.now());
  const opened = new Map<string, { open: RegisteredOpen; at: number }>();
  const published = new Set<string>();
  const key = (botId: string, code: string) => `${botId}\u0000${code}`;

  function remember(botId: string, open: RegisteredOpen) {
    const at = now();
    for (const [k, row] of opened) if (at - row.at > DAY_MS) opened.delete(k);
    while (opened.size >= MAX_OPEN) {
      const first = opened.keys().next().value;
      if (first === undefined) break;
      opened.delete(first);
    }
    opened.set(key(botId, open.code), { open, at });
  }

  return {
    /** Feed one remote_support_* answer. Returns what it did, for tests and logs. */
    async observe(call: RemoteSupportCall): Promise<"opened" | "published" | "ended" | null> {
      const args = isObject(call.args) ? call.args : {};
      const answer = toolResultObject(call.result);
      if (!answer) return null;
      if (call.name === "remote_support_open") {
        const id = parseRemoteSessionId(args.session);
        const code = parseRemoteSessionCode(answer.code);
        const end = typeof args.end_at === "string" ? Date.parse(args.end_at) : Number.NaN;
        if (!id || !code || !Number.isFinite(end)) return null;
        const os = parseRemoteSessionOs(args.os);
        remember(call.botId, {
          id,
          code,
          elevated: args.rights === "elevated",
          endAt: new Date(end).toISOString(),
          ...(os ? { os } : {}),
        });
        return "opened";
      }
      const code = parseRemoteSessionCode(args.code);
      if (!code) return null;
      if (call.name === "remote_support_status") {
        if (answer.state !== "connected") return null;
        const open = opened.get(key(call.botId, code))?.open ?? deps.recall?.(code) ?? null;
        if (!open) return null;
        const once = `${call.botId}\u0000${call.threadId}\u0000${open.id}`;
        if (published.has(once)) return null;
        await deps.publish({ botId: call.botId, threadId: call.threadId, open });
        published.add(once);
        return "published";
      }
      if (call.name === "remote_support_close") {
        const open = opened.get(key(call.botId, code))?.open ?? deps.recall?.(code) ?? null;
        opened.delete(key(call.botId, code));
        if (open) published.delete(`${call.botId}\u0000${call.threadId}\u0000${open.id}`);
        await deps.end({ botId: call.botId, threadId: call.threadId, code });
        return "ended";
      }
      return null;
    },
  };
}

export type RemoteSessionRegistrar = ReturnType<typeof createRemoteSessionRegistrar>;
