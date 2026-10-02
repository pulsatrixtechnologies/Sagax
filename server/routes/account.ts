// DELETE /api/me: the phone's Account > Delete Account (iOS parity, 16).
//
// Organization server (OMB_IDENTITY=perspicax): the account is the person's
// Perspicax account. With { confirm: true } the server asks Perspicax to
// delete it, then deletes the person's Sagax data: the bots they own (with
// their threads, memory and computers), their own threads on other bots,
// their server environment and /workspace, their saved settings, and signs
// out every session of theirs. Perspicax has no account-deletion endpoint
// for a linked server yet (pulsatrix-v3 route table, 2026-10-01): until it
// does this answers 501 `perspicax_deletion_unavailable` and deletes nothing,
// so an account is never half removed. The phone shows the row and explains.
//
// Personal server: there is no account here; 400 `personal_server`, and the
// phone forgets its pairing and erases its own data.
import { PASS, type RouteHandler } from "./table.ts";

export interface AccountRouteDeps {
  organization: () => boolean;
  /** Deletes the person's Perspicax account, or null while Perspicax offers no such call. */
  perspicaxDeletion: ((principalId: string) => Promise<void>) | null;
  /** Deletes the person's data on this server (see the header). */
  deletePersonData: (principalId: string) => Promise<{ bots: number; threads: number }>;
}

export function createAccountRoutes(deps: AccountRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/me") return PASS;
    if (method !== "DELETE") return json(res, 405, { error: "DELETE only" });
    res.setHeader("cache-control", "no-store");
    if (!deps.organization()) {
      return json(res, 400, { error: "This is a personal computer: there is no account on it to delete. Forget this computer on the phone instead.", code: "personal_server" });
    }
    const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : undefined;
    if (!principalId) return json(res, 403, { error: "Sign in with Pulsatrix to delete your account.", code: "identity_perspicax" });
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const body = await readBody(req) as Record<string, unknown> | null;
    if (body?.confirm !== true) return json(res, 400, { error: "Confirm the deletion ({ confirm: true }): it cannot be undone.", code: "confirm" });
    if (!deps.perspicaxDeletion) {
      return json(res, 501, {
        error: "Your organization's Pulsatrix Perspicax does not offer account deletion from Sagax yet. Ask your administrator to delete your account.",
        code: "perspicax_deletion_unavailable",
      });
    }
    try {
      await deps.perspicaxDeletion(principalId);
    } catch (error) {
      const status = (error as { status?: unknown })?.status;
      return json(res, typeof status === "number" && status >= 400 && status < 500 ? status : 502, {
        error: "Perspicax did not delete the account; nothing was deleted here.", code: "perspicax_deletion_failed",
      });
    }
    const removed = await deps.deletePersonData(principalId);
    return json(res, 200, { deleted: true, ...removed });
  };
}
