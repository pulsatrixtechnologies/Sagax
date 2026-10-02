// Routine delegation on an organization server (slice 6): the person allows
// the routines that run as them to act in their name while they are away.
// The consent happens at Perspicax; the server starts it
// (POST /api/org/routine-delegation) and the callback lands back on the app
// with `#routine-delegation=ok` or `#routine-delegation-error=<code>`.
//
// Since 2026-10-01 the delegation is allowed by default: there is no switch
// in Sagax. Perspicax has no silent authorization (every authorize request
// shows its sign-in page, there is no prompt=none nor single sign-on
// session), so the consent cannot ride along unseen at sign-in. Instead it
// starts once on its own, right after the person creates their first
// routine (`ensureRoutineDelegation`), and is revoked in the Perspicax
// console (the person's Sagax tab, `manageUrl`).
import { t } from "@/lib/i18n";
import { api } from "@/state/store";

export type RoutineDelegationReturn = { ok: true } | { ok: false; code: string };

export interface RoutineDelegationStatus {
  state: "active" | "none";
  consentedAt?: number;
  renewedAt?: number;
  expiresAt?: number;
  suspended: number;
  /** The person's Sagax tab in the Perspicax console, where it is revoked. */
  manageUrl?: string;
}

/** The outcome a hash carries, or null when it carries none. */
export function parseRoutineDelegationHash(hash: string): RoutineDelegationReturn | null {
  const text = hash.startsWith("#") ? hash.slice(1) : hash;
  if (text === "routine-delegation=ok") return { ok: true };
  const match = /^routine-delegation-error=([\w-]{1,64})$/.exec(text);
  return match ? { ok: false, code: match[1]! } : null;
}

let pending: RoutineDelegationReturn | null = null;

/** Read the outcome from the address once, clear it from the address, and
 * keep it for the settings card. */
export function takeRoutineDelegationReturn(): RoutineDelegationReturn | null {
  if (typeof window === "undefined") return null;
  const found = parseRoutineDelegationHash(window.location.hash);
  if (!found) return null;
  const url = new URL(window.location.href);
  url.hash = "";
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  pending = found;
  return found;
}

/** The outcome the settings card shows once. */
export function consumePendingRoutineDelegationReturn(): RoutineDelegationReturn | null {
  const found = pending;
  pending = null;
  return found;
}

/** The sentence for an outcome. */
export function routineDelegationReturnText(result: RoutineDelegationReturn): string {
  if (result.ok) return t("org.routineDelegation.done");
  if (result.code === "routines_subject") return t("org.routineDelegation.error.routines_subject");
  if (result.code === "routines_scope") return t("org.routineDelegation.error.routines_scope");
  if (result.code === "routines_session") return t("org.routineDelegation.error.routines_session");
  if (result.code === "rate_limited") return t("org.routineDelegation.error.rate_limited");
  return t("org.routineDelegation.error.generic", { code: result.code });
}

/** Start the consent at Perspicax: the server answers the authorization URL
 * and sets the flow binding cookie; the browser goes there. */
export async function startRoutineDelegation(go: (url: string) => void = (url) => window.location.assign(url)): Promise<void> {
  const { authorizationUrl } = await api<{ authorizationUrl: string }>("/api/org/routine-delegation", { method: "POST", body: "{}" });
  go(authorizationUrl);
}

export function loadRoutineDelegation(): Promise<RoutineDelegationStatus> {
  return api<RoutineDelegationStatus>("/api/org/routine-delegation");
}

export function revokeRoutineDelegation(): Promise<{ revoked: boolean }> {
  return api<{ revoked: boolean }>("/api/org/routine-delegation", { method: "DELETE" });
}

/** Where "the consent already started once on its own" is remembered, per
 * person (their console address carries their Perspicax id). */
export const AUTO_CONSENT_KEY = "sagax.routineDelegation.autoConsent.v1";

export interface EnsureDelegationDeps {
  load?: () => Promise<RoutineDelegationStatus>;
  start?: () => Promise<void>;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

function defaultStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** After a routine is created: on an organization server, a person whose
 * routines may not act in their name yet is sent to the Perspicax consent,
 * once (a later routine never sends them again; the routines page and the
 * paused routine card still offer it). A solo server answers 403 here:
 * nothing happens. */
export async function ensureRoutineDelegation(deps: EnsureDelegationDeps = {}): Promise<"active" | "started" | "skipped" | "unavailable"> {
  const load = deps.load ?? loadRoutineDelegation;
  const start = deps.start ?? (() => startRoutineDelegation());
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage;
  let status: RoutineDelegationStatus;
  try {
    status = await load();
  } catch {
    return "unavailable";
  }
  if (status.state === "active") return "active";
  const key = `${AUTO_CONSENT_KEY}:${status.manageUrl ?? "self"}`;
  try {
    if (storage?.getItem(key)) return "skipped";
    storage?.setItem(key, String(Date.now()));
  } catch {
    /* no storage: still start it this time */
  }
  try {
    await start();
    return "started";
  } catch {
    return "unavailable";
  }
}
