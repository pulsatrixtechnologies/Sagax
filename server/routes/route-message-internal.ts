// route_message (server/busy-routing.ts): the bot moves a message the person
// sent while it worked, which the server steered into its running turn with a
// routing handle. Served behind the per-turn agents capability the internal
// block of server/index.ts checks first (bearer, bot, live turn), so this
// module is in INTERNAL_ROUTES, never in ROUTES. The bot and the conversation
// are the capability's, never the body's.
//
//   POST /api/internal/route-message   { handle, mode: "parallel" | "after", title?, resources? }
//
// Only a person's own turn (depth 0) in the conversation the words were
// steered into may route them; any other handle reads as missing.
import { z } from "zod";

import { MAX_ROUTE_RESOURCES, routeResources } from "../busy-routing.ts";
import { PASS } from "./table.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";

const body = z.object({
  /** Older proxies send these; the capability's own values win. */
  fromBotId: z.string().optional(),
  fromThreadId: z.string().optional(),
  handle: z.string().min(1).max(128).regex(/^[\w-]+$/),
  mode: z.enum(["parallel", "after"]),
  title: z.string().max(120).optional(),
  resources: z.array(z.string().max(200)).max(MAX_ROUTE_RESOURCES).optional(),
}).strict();

export function createRouteMessageInternalRoutes(deps: {
  /** The conversation belongs to this bot (connectorThread in index.ts). */
  ownsThread(botId: string, threadId: string): boolean;
  route(input: { botId: string; threadId: string; handle: string; mode: "parallel" | "after"; title?: string; resources: string[] }): Promise<{ status: number; body: Record<string, unknown> }>;
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/route-message") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    if ((capability as InternalCapabilityView).depth) {
      return json(res, 403, { error: "route_message works only in a person's own turn" });
    }
    const parsed = body.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: "Invalid route_message request" });
    const title = parsed.data.title?.trim();
    try {
      const out = await deps.route({
        botId: capability.botId,
        threadId: capability.threadId,
        handle: parsed.data.handle,
        mode: parsed.data.mode,
        ...(title ? { title } : {}),
        resources: routeResources(parsed.data.resources),
      });
      return json(res, out.status, out.body);
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 500;
      const code = typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : undefined;
      return json(res, status, { error: error instanceof Error ? error.message : String(error), ...(code ? { code } : {}) });
    }
  };
}
