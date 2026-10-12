import { z } from "zod";

import type { TerminalProviderKind } from "../../shared/terminal-resources.ts";
import { PASS, type RouteHandler } from "./table.ts";
import type { createTerminalRequestService } from "../terminal-requests.ts";
import type { TerminalResourceRegistry } from "../terminal-resources/registry.ts";
import type { RequestAuth } from "../request-auth.ts";

const offerBody = z.object({
  fromBotId: z.string().min(1),
  fromThreadId: z.string().min(1),
  resourceId: z.string().min(1),
  provider: z.string().min(1),
  reason: z.string().max(2_000).optional(),
}).strict();

export function createTerminalInternalRoutes(deps: {
  requests: ReturnType<typeof createTerminalRequestService>;
  registry: TerminalResourceRegistry;
  principalId(auth: RequestAuth): string | undefined;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/internal/terminal/resources" && method === "GET") {
      const principalId = deps.principalId(auth);
      if (!principalId) return json(res, 403, { error: "forbidden" });
      const botId = String(new URL(req.url ?? "", "http://x").searchParams.get("fromBotId") ?? "");
      const threadId = String(new URL(req.url ?? "", "http://x").searchParams.get("fromThreadId") ?? "");
      const resources = await deps.registry.listAll({ auth, principalId, botId, threadId });
      return json(res, 200, { resources });
    }
    if (path === "/api/internal/terminal/offer" && method === "POST") {
      const parsed = offerBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Invalid terminal offer" });
      const provider = parsed.data.provider as TerminalProviderKind;
      const result = await deps.requests.submit({
        botId: parsed.data.fromBotId,
        threadId: parsed.data.fromThreadId,
        resourceId: parsed.data.resourceId,
        provider,
        reason: parsed.data.reason ?? "",
      });
      if ("error" in result) return json(res, 404, { error: result.error });
      return json(res, 200, result);
    }
    return PASS;
  };
}
