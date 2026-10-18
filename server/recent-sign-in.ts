// "A sign-in younger than 15 minutes" (2026-10-18). Some actions accept a
// recent sign-in in place of a security key: the first key, and exporting
// the credential vault in clear for a person without a key. Recent means
// the person proved themselves interactively a short while ago, never that
// a session is new: a bot that can create a pairing code (manage_pairing,
// or act on POST /api/auth/pairing) can redeem it into a brand new session
// in a second. So the clock is the session's `authAt`
// (server/sessions.ts), which only an interactive sign-in stamps: "Sign in
// with Pulsatrix" (OpenID Connect, in the browser or handed to the desktop
// or a phone) and an email code the person typed. A pairing code, an invite
// link, a renewal, a bot-act copy and an act-as session stamp nothing.
import type { RequestAuth } from "./request-auth.ts";
import type { SessionRecord } from "./sessions.ts";

export const RECENT_SIGN_IN_MS = 15 * 60_000;

/** Whether this session carries an interactive sign-in of its person made
 * within the window. A bot-act or act-as copy never does. */
export function recentInteractiveSignIn(session: Pick<SessionRecord, "authAt" | "ephemeral">, now = Date.now()): boolean {
  if (session.ephemeral) return false;
  const at = session.authAt;
  return typeof at === "number" && Number.isFinite(at) && at <= now && now - at <= RECENT_SIGN_IN_MS;
}

/** The person is present right now: a session with a recent interactive
 * sign-in, or the desktop app's own person (its loopback, owner trust).
 * A headless server's loopback never counts: a bot's shell is a loopback
 * caller there. */
export function recentPersonSignIn(auth: RequestAuth, options: { desktopManaged: boolean; now?: number }): boolean {
  if (auth.kind === "loopback") return options.desktopManaged && auth.trust !== "service";
  return recentInteractiveSignIn(auth.session, options.now ?? Date.now());
}
