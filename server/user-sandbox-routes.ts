// Settings > Organization > "Your server environment": the signed-in
// person's own environment only. There is no route that names another
// person's environment, and none that names a bot.
//
//   GET  /api/me/server-environment         status, resources, last used
//   POST /api/me/server-environment/reset   recreate it ({ confirm: true })
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { UserSandboxManager } from "./user-sandbox-manager.ts";
import { UserSandboxUnavailable } from "./user-sandbox-manager.ts";

export function createUserSandboxRoutes(deps: {
  /** Null on a server without the provisioner: the card says it is off. */
  manager: () => UserSandboxManager | null;
  organization: boolean;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/me/server-environment" && path !== "/api/me/server-environment/reset") return PASS;
    res.setHeader("cache-control", "no-store");
    if (!deps.organization) return json(res, 404, { error: "not found" });
    const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : undefined;
    if (!principalId) return json(res, 403, { error: "Sign in with Pulsatrix to use a server environment.", code: "identity_perspicax" });
    const manager = deps.manager();
    if (path === "/api/me/server-environment") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      if (!manager) return json(res, 200, { configured: false });
      return json(res, 200, { configured: true, ...(await manager.status(principalId)) });
    }
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!manager) return json(res, 409, { error: "This server has no server environments.", code: "not_configured" });
    const body = await readBody(req) as Record<string, unknown> | null;
    if (body?.confirm !== true) return json(res, 400, { error: "Confirm the reset: it erases /workspace.", code: "confirm" });
    try {
      return json(res, 200, { configured: true, ...(await manager.reset(principalId)) });
    } catch (error) {
      if (error instanceof UserSandboxUnavailable) return json(res, 409, { error: error.message, code: error.code });
      return json(res, 502, { error: "The server environment could not be reset.", code: "unavailable" });
    }
  };
}
