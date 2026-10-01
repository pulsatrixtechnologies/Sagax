// The served web UI's view of its own authentication. On the owner's machine
// the server trusts loopback and none of this is visible; on a remote host
// the browser must hold a session cookie from pairing (see /pair).

export interface EnvironmentDescriptor {
  environmentId: string;
  label: string;
  platform: string;
  version: string;
  capabilities: { remoteSessions: true; selfUpdate: "desktop-managed" | "operator"; emailSignIn?: boolean; sharedComputers?: true };
  /** An organization server: people sign in with Pulsatrix Perspicax at
   * `loginPath` (server/oidc-login.ts); email codes and invitations are off. */
  identity?: { kind: "perspicax"; protocol: "oidc"; issuer: string; loginPath: string };
}

/** The same-origin path that starts "Sign in with Pulsatrix", or null when
 * this server does not offer it. Only a local path is accepted. */
export function pulsatrixLoginPath(environment: EnvironmentDescriptor | null): string | null {
  const identity = environment?.identity;
  if (identity?.kind !== "perspicax" || typeof identity.loginPath !== "string") return null;
  return /^\/[A-Za-z0-9/_-]*$/.test(identity.loginPath) && !identity.loginPath.startsWith("//") ? identity.loginPath : null;
}

/** Why the last "Sign in with Pulsatrix" came back to /pair, read once from
 * `#signin_error=<code>` and removed from the address bar. */
export function takeSignInErrorFromLocation(loc: Pick<Location, "hash" | "pathname" | "search"> = location, history: Pick<History, "replaceState"> | null = globalThis.history ?? null): string | null {
  const match = /(?:^#|&)signin_error=([\w-]{1,40})(?:&|$)/.exec(loc.hash);
  if (!match) return null;
  history?.replaceState(null, "", `${loc.pathname}${loc.search}`);
  return match[1]!;
}

export type SessionState =
  // `service`: a shared server that does not treat this machine as its owner
  | { kind: "loopback"; trust?: "service" }
  | { kind: "session"; id: string; label: string; scopes: string[]; expiresAt: number }
  | { kind: "unauthenticated"; error: string }
  | { kind: "unreachable"; error: string };

/** Ask the server who we are. A 401/403 means "go pair"; a network failure
 * is reported separately so the pair page can say the server is down. */
export async function readSessionState(fetchImpl: typeof fetch = fetch): Promise<SessionState> {
  let res: Response;
  try {
    res = await fetchImpl("/api/auth/session", { credentials: "same-origin" });
  } catch (error) {
    return { kind: "unreachable", error: error instanceof Error ? error.message : String(error) };
  }
  const body: unknown = await res.json().catch(() => ({}));
  const record = Object(body) as Record<string, unknown>; // SAFETY: read with typeof checks below; never trusted as a shape
  if (res.status === 401 || res.status === 403) {
    return { kind: "unauthenticated", error: typeof record.error === "string" ? record.error : `${res.status}` };
  }
  if (!res.ok) return { kind: "unreachable", error: `${res.status} ${res.statusText}` };
  if (record.kind === "session" && typeof record.id === "string") {
    return {
      kind: "session",
      id: record.id,
      label: typeof record.label === "string" ? record.label : "",
      scopes: Array.isArray(record.scopes) ? record.scopes.filter((s): s is string => typeof s === "string") : [],
      expiresAt: typeof record.expiresAt === "number" ? record.expiresAt : 0,
    };
  }
  return record.trust === "service" ? { kind: "loopback", trust: "service" } : { kind: "loopback" };
}

/** Why the pair page shows on this machine: the server trusts local
 * requests only as a service (OMB_LOOPBACK_TRUST=service, or a hosted
 * workspace), so an SSH tunnel is not the owner and must sign in. */
export const SERVICE_TRUST_REASON = "This server does not treat this computer as its owner. Sign in or pair this browser to continue.";

/** A connection that can use the app: a session, or the owner on this machine. */
export function isConnected(state: SessionState | null): boolean {
  return state?.kind === "session" || (state?.kind === "loopback" && state.trust !== "service");
}

/** The owner on this machine or an admin session: who may manage the server. */
export function isOwnerOrAdmin(state: SessionState | null): boolean {
  if (!state) return false;
  return state.kind === "loopback" ? state.trust !== "service" : state.kind === "session" && state.scopes.includes("admin");
}

/** Pull `#code=…` off the URL and out of history, the way a pairing link is meant to be consumed. */
export function takePairingCodeFromLocation(): string | null {
  return takePairingFromLocation().code;
}

/** A pairing credential the desktop app received from "Sign in with
 * Pulsatrix" in the system browser: exactly `omb_pair_` and 43 base64url
 * characters. */
const SIGN_IN_CREDENTIAL = /^omb_pair_[A-Za-z0-9_-]{43}$/;

/** Read `#code=<c>` and, for a sign-in credential only, `&auto=1` (the
 * desktop app opens /pair#code=<c>&auto=1 after the system browser handed
 * the credential back). The code is kept verbatim: a credential must never
 * be normalized. */
export function parsePairingHash(hash: string): { code: string | null; auto: boolean } {
  const m = /[#&]code=([^&]+)/.exec(hash);
  if (!m) return { code: null, auto: false };
  let code: string;
  try {
    code = decodeURIComponent(m[1]!);
  } catch {
    return { code: null, auto: false };
  }
  const auto = /[#&]auto=1(?:&|$)/.test(hash) && SIGN_IN_CREDENTIAL.test(code);
  return { code, auto };
}

/** The pairing code in the address bar, dropped from it once read. */
export function takePairingFromLocation(loc: Pick<Location, "hash" | "pathname" | "search"> = location, historyApi: Pick<History, "replaceState"> | null = globalThis.history ?? null): { code: string | null; auto: boolean } {
  const parsed = parsePairingHash(loc.hash);
  if (parsed.code !== null || /[#&]code=/.test(loc.hash)) historyApi?.replaceState(null, "", loc.pathname + loc.search);
  return parsed;
}

/** The invited address carried on a pair link (`/pair?email=…`): prefilled
 * on the sign-in page and dropped from the address bar. Never trusted on
 * its own; the one-time code still goes to the address itself. */
export function takeInvitedEmailFromLocation(): string | null {
  const params = new URLSearchParams(location.search);
  const email = params.get("email")?.trim().toLowerCase() ?? "";
  if (!email) return null;
  params.delete("email");
  const search = params.toString();
  history.replaceState(null, "", location.pathname + (search ? `?${search}` : "") + location.hash);
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

/** A default device name, so the sessions list reads "Safari on iPhone" not "Unnamed device". */
export function defaultDeviceLabel(userAgent: string = navigator.userAgent): string {
  const browser = /Edg\//.test(userAgent) ? "Edge" : /OPR\//.test(userAgent) ? "Opera" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Browser";
  const os = /iPhone/.test(userAgent) ? "iPhone" : /iPad/.test(userAgent) ? "iPad" : /Android/.test(userAgent) ? "Android" : /Mac OS X/.test(userAgent) ? "Mac" : /Windows/.test(userAgent) ? "Windows" : /Linux/.test(userAgent) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** One random id per pairing attempt. Re-sending the same id after a lost
 * response returns the same session instead of "code already used"; nobody
 * who merely shares this device's address can guess it. */
export function newAttemptId(): string {
  return typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export async function pairWithCode(
  input: { code: string; label: string; attemptId?: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetchImpl("/api/auth/pair", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: input.code, label: input.label, cookie: true, attemptId: input.attemptId ?? newAttemptId() }),
    });
  } catch (error) {
    return { ok: false, error: `could not reach the server (${error instanceof Error ? error.message : String(error)})` };
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true };
  const error = Reflect.get(Object(body), "error");
  return { ok: false, error: typeof error === "string" ? error : `${res.status} ${res.statusText}` };
}

/** Server-side JSON exchanges that end in a session cookie. */
async function postAuth(path: string, body: Record<string, unknown>, fetchImpl: typeof fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await fetchImpl(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (error) {
    return { ok: false, error: `could not reach the server (${error instanceof Error ? error.message : String(error)})` };
  }
  const parsed: unknown = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true };
  const error = Reflect.get(Object(parsed), "error");
  return { ok: false, error: typeof error === "string" ? error : `${res.status} ${res.statusText}` };
}

/** Ask the server to email a sign-in code (the server checks its allow-list first). */
export function startEmailSignIn(email: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  return postAuth("/api/auth/email/start", { email }, fetchImpl);
}

/** Exchange the emailed code for a session cookie. */
export function verifyEmailSignIn(input: { email: string; code: string; label: string }, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  return postAuth("/api/auth/email/verify", { email: input.email, code: input.code, label: input.label }, fetchImpl);
}

/** The gate's ordinary "you have no session" wording is why the pair page is
 * shown at all; repeating it under an email form reads like an error. Only a
 * reason that says something else (a session that expired or was revoked)
 * is worth showing. */
export function reasonWorthShowing(reason: string | undefined): string | null {
  if (!reason) return null;
  if (/through a proxy|loopback host required|cross-origin request|^40[13]$/i.test(reason)) return null;
  return reason;
}
