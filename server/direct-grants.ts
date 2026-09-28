import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";

export interface DirectGrant {
  botId: string;
  userId: string;
}

export function grantDirect(input: {
  actorId: string;
  ownerUserId: string;
  botId: string;
  userId: string;
  grants: DirectGrant[];
}): { ok: true; grants: DirectGrant[] } | { ok: false; error: "not-owner" } {
  if (input.actorId.trim().toLowerCase() !== input.ownerUserId.trim().toLowerCase()) return { ok: false, error: "not-owner" };
  if (input.grants.some((grant) => grant.botId === input.botId && grant.userId === input.userId)) {
    return { ok: true, grants: input.grants };
  }
  return { ok: true, grants: [...input.grants, { botId: input.botId, userId: input.userId }] };
}

/** Stored shape on the bot: user ids. grantDirect stays { botId, userId }[]. */
export function grantDirectRoute(input: {
  actorId: string;
  bot?: { id: string; ownerUserId?: string; directGrants?: string[] } | null;
  userId: string;
}): { status: 200; directGrants: string[] } | { status: 403; error: "not-owner" } | { status: 404 } {
  const bot = input.bot;
  if (!bot) return { status: 404 };
  const ownerUserId = bot.ownerUserId;
  if (typeof ownerUserId !== "string" || !ownerUserId) return { status: 403, error: "not-owner" };
  const result = grantDirect({
    actorId: input.actorId,
    ownerUserId,
    botId: bot.id,
    userId: input.userId,
    grants: (bot.directGrants ?? []).map((userId) => ({ botId: bot.id, userId })),
  });
  if (!result.ok) return { status: 403, error: result.error };
  return { status: 200, directGrants: result.grants.filter((grant) => grant.botId === bot.id).map((grant) => grant.userId) };
}

export interface DirectGrantRouteDeps {
  bot(id: string): { id: string; ownerUserId?: string; directGrants?: string[] } | undefined;
  patchBot(id: string, patch: { directGrants: string[] }): unknown;
  actorId(auth: RequestAuth): string;
}

export function createDirectGrantRoutes(deps: DirectGrantRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = path.match(/^\/api\/bots\/([\w-]+)\/direct-grants$/);
    if (!m || method !== "POST") return PASS;
    const body = await readBody(req);
    if (typeof body?.userId !== "string" || !body.userId) return json(res, 400, { error: "userId is required" });
    const bot = deps.bot(m[1]!);
    const result = grantDirectRoute({ actorId: deps.actorId(auth), bot, userId: body.userId });
    if (result.status === 404 || !bot) return json(res, 404, { error: "no such bot" });
    if (result.status === 403) return json(res, 403, { error: result.error });
    deps.patchBot(bot.id, { directGrants: result.directGrants });
    return json(res, 200, { directGrants: result.directGrants });
  };
}
