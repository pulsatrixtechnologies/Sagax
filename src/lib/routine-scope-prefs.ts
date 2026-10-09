// The Automations page's scope and filters (2026-10-09), remembered per
// person: Mine, My teams or Everyone, and the team, bot, owner and status
// chosen. One of USER_PREFERENCE_KEYS, so on an organization server it
// follows the person from device to device; the value keys each person by
// their principal id, so two people on one device keep their own choice.
// Storage may refuse reads and writes (private mode): the page then keeps
// the choice for this session only.
import { isRoutineScope, isRoutineScopeStatus, type RoutineScope, type RoutineScopeStatus } from "../../shared/routine-scope";

export const ROUTINE_SCOPE_PREF_KEY = "sagax.routineScope.v1";
const MAX_PEOPLE = 20;
const ID = /^[\w.:@-]{1,128}$/;

export interface RoutineScopePrefs {
  scope: RoutineScope;
  teamId?: string;
  botId?: string;
  ownerId?: string;
  status?: RoutineScopeStatus;
}

export const DEFAULT_ROUTINE_SCOPE_PREFS: RoutineScopePrefs = { scope: "mine" };

const sessionChoices = new Map<string, RoutineScopePrefs>();

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function personKey(principalId: string | null | undefined): string {
  return principalId?.trim().toLowerCase() || "local";
}

/** Keep what this build understands; anything else falls back to Mine. */
export function cleanRoutineScopePrefs(input: unknown): RoutineScopePrefs {
  if (!input || typeof input !== "object") return { ...DEFAULT_ROUTINE_SCOPE_PREFS };
  const raw = input as Record<string, unknown>;
  const prefs: RoutineScopePrefs = { scope: isRoutineScope(raw.scope) ? raw.scope : "mine" };
  for (const key of ["teamId", "botId", "ownerId"] as const) {
    const value = raw[key];
    if (typeof value === "string" && ID.test(value)) prefs[key] = value;
  }
  if (isRoutineScopeStatus(raw.status)) prefs.status = raw.status;
  return prefs;
}

function readAll(): Record<string, unknown> {
  try {
    const text = storage()?.getItem(ROUTINE_SCOPE_PREF_KEY);
    const parsed: unknown = text ? JSON.parse(text) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function readRoutineScopePrefs(principalId: string | null | undefined): RoutineScopePrefs {
  const key = personKey(principalId);
  const session = sessionChoices.get(key);
  if (session) return { ...session };
  return cleanRoutineScopePrefs(readAll()[key]);
}

export function writeRoutineScopePrefs(principalId: string | null | undefined, prefs: RoutineScopePrefs): void {
  const key = personKey(principalId);
  const clean = cleanRoutineScopePrefs(prefs);
  sessionChoices.set(key, clean);
  try {
    const all = readAll();
    delete all[key];
    // The newest choice last; the oldest people fall off past MAX_PEOPLE.
    const entries = [...Object.entries(all), [key, clean] as const].slice(-MAX_PEOPLE);
    storage()?.setItem(ROUTINE_SCOPE_PREF_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* storage refused: this session keeps the choice */
  }
}

/** Tests only: forget the session's choices. */
export function resetRoutineScopePrefsForTests(): void {
  sessionChoices.clear();
}
