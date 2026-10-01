// A person's preferences follow them on an organization server
// (shared/user-preferences.ts, server/routes/user-preferences.ts).
//
// The modules that own each preference keep reading and writing
// localStorage, unchanged. On a page served by an organization server (in a
// browser, or the desktop app in server mode) this module:
//   1. at start, before the app renders, reads the person's record from the
//      server and writes it into localStorage, so the server wins;
//   2. the first time (no record yet), saves what this person already had:
//      the preferences the desktop app brought from this computer's solo app
//      (handed over once by the launch screen, never asked), else what this
//      page already held. The local copy is never removed;
//   3. then watches those keys and saves a change back to the server.
// Anywhere else the server answers 404 and nothing here runs.
import { USER_PREFERENCE_KEYS, cleanUserPreferences, type UserPreferences } from "../../shared/user-preferences";

export const PREFERENCES_PATH = "/api/me/preferences";
const WATCH_MS = 1_500;

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;

export interface PreferenceSyncDeps {
  fetch: typeof fetch;
  storage: Storage;
  /** The solo app's preferences, handed over once by the desktop (org-join). */
  takeLocalPreferences?: () => Promise<unknown>;
  setInterval?: (fn: () => void, ms: number) => unknown;
  timeoutMs?: number;
}

/** The known keys as this page holds them now. */
export function readPreferences(storage: Storage): UserPreferences {
  const out: UserPreferences = {};
  for (const key of USER_PREFERENCE_KEYS) {
    try {
      const value = storage.getItem(key);
      if (value !== null) out[key] = value;
    } catch {
      /* storage refused: nothing to read */
    }
  }
  return out;
}

/** The server's record becomes this page's: set what it has, clear what it
 * does not (absent means the module's default, as on a fresh device). */
export function applyPreferences(storage: Storage, preferences: UserPreferences): void {
  for (const key of USER_PREFERENCE_KEYS) {
    try {
      const value = preferences[key];
      if (value === undefined) storage.removeItem(key);
      else storage.setItem(key, value);
    } catch {
      /* storage refused: the defaults show */
    }
  }
}

const same = (a: UserPreferences, b: UserPreferences) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

async function put(deps: PreferenceSyncDeps, preferences: UserPreferences, keepalive = false): Promise<boolean> {
  try {
    const response = await deps.fetch(PREFERENCES_PATH, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preferences }),
      credentials: "same-origin",
      keepalive,
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Runs steps 1 and 2 and returns the watcher for step 3 (null when this page
 * keeps its preferences to itself). Never throws; at worst the page keeps
 * what it had.
 */
export async function startPreferenceSync(deps: PreferenceSyncDeps): Promise<{ check: () => Promise<void>; flush: () => void } | null> {
  let record = null as { stored?: unknown; preferences?: unknown } | null;
  try {
    const response = await deps.fetch(PREFERENCES_PATH, { credentials: "same-origin", signal: AbortSignal.timeout(deps.timeoutMs ?? 2_000) });
    if (!response.ok) return null;
    record = (await response.json()) as typeof record;
  } catch {
    return null;
  }
  let pushed: UserPreferences;
  if (record?.stored === true) {
    pushed = cleanUserPreferences(record.preferences);
    applyPreferences(deps.storage, pushed);
  } else {
    let brought: UserPreferences = {};
    try {
      brought = cleanUserPreferences(await deps.takeLocalPreferences?.());
    } catch {
      brought = {};
    }
    const first = Object.keys(brought).length ? brought : readPreferences(deps.storage);
    pushed = {};
    if (Object.keys(first).length) {
      applyPreferences(deps.storage, first);
      // Not saved (offline): the next start offers them again.
      if (await put(deps, first)) pushed = first;
    }
  }
  let busy = false;
  const check = async () => {
    if (busy) return;
    const now = readPreferences(deps.storage);
    if (same(now, pushed)) return;
    busy = true;
    try {
      if (await put(deps, now)) pushed = now;
    } finally {
      busy = false;
    }
  };
  const flush = () => {
    const now = readPreferences(deps.storage);
    if (!same(now, pushed)) void put(deps, now, true);
  };
  (deps.setInterval ?? setInterval)(() => void check(), WATCH_MS);
  return { check, flush };
}

/** The page's own wiring: real fetch, localStorage, the desktop's hand-over. */
export async function syncUserPreferences(): Promise<void> {
  let storage: Storage;
  try {
    storage = window.localStorage;
  } catch {
    return;
  }
  const takeLocal = window.ogb?.orgJoin?.takePreferences;
  const sync = await startPreferenceSync({
    fetch: window.fetch.bind(window),
    storage,
    takeLocalPreferences: takeLocal ? () => takeLocal() : undefined,
  });
  if (sync) window.addEventListener("pagehide", sync.flush);
}
