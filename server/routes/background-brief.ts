// The person's background brief (server/background-brief.ts).
//
//   GET  /api/bots/:id/background-brief
//   PUT  /api/bots/:id/background-brief   { enabled?, everyHours?, subjects? }
//   POST /api/bots/:id/background-brief/pass { tools, pieces, costUsd }
//   POST /api/bots/:id/background-brief/:suggestionId/reject
//   POST /api/bots/:id/background-brief/:suggestionId/keep
//
// A pass does not invent pieces. It files only what the caller already read,
// and only when every tool named is a read. Keep writes one memory line
// stamped for the person.

import { PASS, type RouteHandler } from "./table.ts";
import type { RequestAuth } from "../request-auth.ts";
import {
  keptMemoryLine,
  runBriefPass,
  type BriefPiece,
  type BriefSettings,
  type BriefStore,
} from "../background-brief.ts";

export interface BackgroundBriefRouteDeps {
  store: BriefStore;
  /** The signed-in person owns this bot. A bot or a service does not. */
  owns: (auth: RequestAuth, botId: string) => boolean;
  /** The bot's fast model, or null when none is set. */
  fastModel: (botId: string) => string | null;
  /** Write the kept line into the person's memory. */
  keep: (botId: string, line: string) => void;
}

function piecesOf(value: unknown): BriefPiece[] | null {
  if (!Array.isArray(value)) return null;
  const pieces: BriefPiece[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const row = item as { piece?: unknown; asOf?: unknown; text?: unknown };
    if (typeof row.piece !== "string" || typeof row.asOf !== "string" || typeof row.text !== "string") return null;
    pieces.push({ piece: row.piece, asOf: row.asOf, text: row.text });
  }
  return pieces;
}

export function createBackgroundBriefRoutes(deps: BackgroundBriefRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json, readBody, req }) => {
    const match = /^\/api\/bots\/([^/]+)\/background-brief(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(path);
    if (!match) return PASS;
    res.setHeader("cache-control", "no-store");
    const botId = decodeURIComponent(match[1]!);
    if (!deps.owns(auth, botId)) return json(res, 403, { error: "Sign in as the bot's person." });
    const suggestionId = match[2];
    const action = match[3];

    if (!suggestionId && method === "GET") return json(res, 200, deps.store.view(botId));
    if (!suggestionId && method === "PUT") {
      const body = await readBody(req) as Partial<BriefSettings>;
      const subjects = Array.isArray(body.subjects) ? body.subjects.filter((item): item is string => typeof item === "string") : undefined;
      const settings = deps.store.saveSettings(botId, {
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(typeof body.everyHours === "number" ? { everyHours: body.everyHours } : {}),
        ...(subjects ? { subjects } : {}),
      });
      return json(res, 200, { settings });
    }
    if (suggestionId === "pass" && method === "POST") {
      if (!deps.store.due(botId)) return json(res, 409, { error: "This brief is off, or its cadence has not elapsed.", code: "brief_not_due" });
      const body = await readBody(req) as { tools?: unknown; pieces?: unknown; costUsd?: unknown };
      const tools = Array.isArray(body.tools) && body.tools.every((tool) => typeof tool === "string") ? body.tools : null;
      const pieces = piecesOf(body.pieces);
      if (!tools || !pieces || typeof body.costUsd !== "number") return json(res, 400, { error: "A pass names the read tools, the pieces, and its cost." });
      const pass = runBriefPass({ tools, pieces, costUsd: body.costUsd, fastModel: deps.fastModel(botId) }, deps.store.view(botId).suggestions.filter((item) => item.status === "rejected").map((item) => item.identity));
      if (!pass.ok) return json(res, 400, { error: pass.error });
      return json(res, 200, { model: pass.model, costUsd: pass.costUsd, added: deps.store.recordPass(botId, pass) });
    }
    if (suggestionId && action === "reject" && method === "POST") {
      const rejected = deps.store.reject(botId, suggestionId);
      if (!rejected) return json(res, 404, { error: "No pending suggestion." });
      return json(res, 200, { suggestion: rejected });
    }
    if (suggestionId && action === "keep" && method === "POST") {
      const kept = deps.store.takePending(botId, suggestionId);
      if (!kept) return json(res, 404, { error: "No pending suggestion." });
      deps.keep(botId, kept.text);
      return json(res, 200, { suggestion: kept, line: keptMemoryLine(kept.text) });
    }
    return json(res, 405, { error: "Method not allowed." });
  };
}
