// Tailcat remote-support sessions for the person who owns the conversation.
// The tunnel address never enters a request body or a JSON answer.
import type { ServerResponse } from "node:http";
import { z } from "zod";

import {
  parseRemoteSessionCode,
  parseRemoteSessionId,
  parseRemoteSessionOs,
  publicText,
  safeRemotePath,
  safeUploadName,
} from "../../shared/remote-session.ts";
import { PASS } from "./table.ts";
import type { RouteHandler } from "./table.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { PublishRemoteSession, RemoteSessionService } from "../remote-sessions.ts";

const LIST = /^\/api\/bots\/([\w-]{1,80})\/remote-sessions$/;
const ONE = /^\/api\/bots\/([\w-]{1,80})\/remote-sessions\/([a-f0-9]{12})(?:\/(close|focus|shell|upload|download|screen))?$/;
const UPLOAD_JSON_MAX = 12_000_000;

const publishBody = z.object({
  flow_session_id: z.string(),
  code: z.string(),
  os: z.enum(["windows", "macos", "linux"]),
  rights: z.enum(["standard", "elevated"]),
  end_at: z.string(),
  hostname: z.string().max(200).optional(),
  user: z.string().max(200).optional(),
  model: z.string().max(200).optional(),
  serial: z.string().max(200).optional(),
  cpu: z.string().max(200).optional(),
  ram: z.string().max(80).optional(),
  disk: z.string().max(200).optional(),
  os_name: z.string().max(200).optional(),
}).strict();

export function parsePublishBody(body: unknown, now: number): { error: string } | { value: Omit<PublishRemoteSession, "botId" | "threadId" | "principalId"> } {
  const parsed = publishBody.safeParse(body);
  if (!parsed.success) return { error: "Send flow_session_id, code, os, rights and end_at. Do not send an address or a key." };
  const id = parseRemoteSessionId(parsed.data.flow_session_id);
  const code = parseRemoteSessionCode(parsed.data.code);
  const os = parseRemoteSessionOs(parsed.data.os);
  if (!id || !code || !os) return { error: "flow_session_id must be 12 hex, code a 6-character support code, and os windows, macos or linux." };
  const end = Date.parse(parsed.data.end_at);
  if (!Number.isFinite(end) || end < now - 15 * 60_000 || end > now + 26 * 60 * 60_000) {
    return { error: "end_at must be an ISO-8601 time within the next day." };
  }
  const fact = (value: string | undefined) => publicText(value);
  return {
    value: {
      id,
      code,
      os,
      elevated: parsed.data.rights === "elevated",
      endAt: new Date(end).toISOString(),
      facts: {
        hostname: fact(parsed.data.hostname),
        user: fact(parsed.data.user),
        model: fact(parsed.data.model),
        serial: fact(parsed.data.serial),
        cpu: fact(parsed.data.cpu),
        ram: fact(parsed.data.ram),
        disk: fact(parsed.data.disk),
        osName: fact(parsed.data.os_name),
      },
    },
  };
}

function filenameOf(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._ -]/g, "_").slice(0, 120);
  return cleaned.replace(/^\.+/, "") || "download";
}

function sendBytes(res: ServerResponse, status: number, type: string, body: Buffer, filename?: string) {
  const headers: Record<string, string> = { "content-type": type, "cache-control": "no-store" };
  if (filename) headers["content-disposition"] = `attachment; filename="${filenameOf(filename)}"`;
  res.writeHead(status, headers);
  res.end(body);
}

export function createRemoteSessionRoutes(deps: {
  sessions: RemoteSessionService;
  principalId(auth: RequestAuth): string | undefined;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody: readJson }) => {
    const list = LIST.exec(path);
    const one = ONE.exec(path);
    if (!list && !one) return PASS;
    const principalId = deps.principalId(auth);
    if (!principalId) return json(res, 401, { error: "Sign in to use a remote session." });
    const botId = (list ?? one)![1]!;
    if (list) {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      return json(res, 200, { sessions: deps.sessions.list(principalId, botId) });
    }
    const id = one![2]!;
    const action = one![3];
    if (!action && method === "GET") return json(res, 200, { session: deps.sessions.list(principalId, botId).find((row) => row.id === id) ?? null });
    if (action === "close" && method === "POST") {
      const session = await deps.sessions.close(principalId, botId, id);
      if (!session) return json(res, 404, { error: "That remote session is not open." });
      return json(res, 200, { session });
    }
    if (action === "focus" && method === "POST") {
      const session = deps.sessions.focus(principalId, botId, id);
      if (!session) return json(res, 404, { error: "That remote session is not open." });
      return json(res, 200, { session });
    }
    if (action === "shell" && method === "POST") {
      const opened = await deps.sessions.openShell({ principalId, botId, threadId: "", id });
      if (!opened) return json(res, 404, { error: "That remote session is not open." });
      if ("error" in opened) return json(res, 409, { error: opened.error });
      return json(res, 200, { hostLabel: opened.hostLabel, messageId: opened.messageId });
    }
    if (action === "upload" && method === "POST") {
      let body: { name?: unknown; dataBase64?: unknown };
      try {
        body = await readJson(req, UPLOAD_JSON_MAX);
      } catch (error) {
        const status = (error as { status?: number }).status ?? 400;
        return json(res, status, { error: status === 413 ? "The file must be under 8 MB." : "Choose a file to send." });
      }
      const name = safeUploadName(body.name);
      const data = typeof body.dataBase64 === "string" ? body.dataBase64 : "";
      if (!name || !data || data.length > UPLOAD_JSON_MAX) return json(res, 400, { error: "Choose a simple file name and a file under 8 MB." });
      let bytes: Buffer;
      try {
        bytes = Buffer.from(data, "base64");
      } catch {
        return json(res, 400, { error: "Choose a file to send." });
      }
      const sent = await deps.sessions.upload(principalId, botId, id, name, bytes);
      if ("error" in sent) return json(res, 409, { error: sent.error });
      return json(res, 200, sent);
    }
    if (action === "download" && method === "POST") {
      const body = z.object({ path: z.string().max(500) }).strict().safeParse(await readJson(req));
      if (!body.success || !safeRemotePath(body.data.path)) return json(res, 400, { error: "That path cannot be downloaded." });
      const file = await deps.sessions.download(principalId, botId, id, body.data.path);
      if ("error" in file) return json(res, 409, { error: file.error });
      return sendBytes(res, 200, "application/octet-stream", file.bytes, file.name);
    }
    if (action === "screen" && method === "GET") {
      const png = await deps.sessions.screen(principalId, botId, id);
      if (!png) return json(res, 404, { error: "The screen is not available." });
      return sendBytes(res, 200, "image/png", png);
    }
    return json(res, 405, { error: "method not allowed" });
  };
}

export function createRemoteSessionInternalRoutes(deps: {
  sessions: RemoteSessionService;
  ownsThread(botId: string, threadId: string): boolean;
  now?: () => number;
}): InternalRouteHandler {
  const now = deps.now ?? (() => Date.now());
  return async ({ res, path, method, json, capability, readBody: readJson }) => {
    if (path !== "/api/internal/remote-sessions/publish") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const principalId = deps.sessions.principalFor(capability.botId, capability.threadId);
    if (!principalId) return json(res, 403, { error: "This conversation has no owner." });
    const parsed = parsePublishBody(await readJson(), now());
    if ("error" in parsed) return json(res, 400, { error: parsed.error });
    try {
      const published = await deps.sessions.publish({
        ...parsed.value,
        botId: capability.botId,
        threadId: capability.threadId,
        principalId,
      });
      const host = published.view.hostname || published.view.code;
      return json(res, 200, {
        ok: true,
        hostLabel: host,
        code: published.view.code,
        reachable: published.reachable,
      });
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (status === 403) return json(res, 403, { error: "That remote session belongs to someone else." });
      return json(res, 500, { error: "The remote session card could not be posted." });
    }
  };
}
