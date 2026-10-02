// A person's preferences on an organization server (shared/user-preferences.ts):
// kept per person (principal id), so the appearance, language, notifications
// and mascot settings a person chose follow them to every device they sign
// in on. One small JSON file in the data directory, written atomically.
//
// Routes (server/index.ts): GET and PUT /api/me/preferences, a signed-in
// person's own record only (the session's principal), on an organization
// server only. Nobody reads or writes another person's preferences, an
// admin included.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { cleanUserPreferences, type UserPreferences } from "../shared/user-preferences.ts";
import { writeFileAtomic } from "./atomic.ts";

const PRINCIPAL_ID = /^pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** More people than an organization server serves; a bound, not a quota. */
export const MAX_PEOPLE = 10_000;

const fileSchema = z.object({
  version: z.literal(1),
  people: z.record(z.string(), z.object({ preferences: z.record(z.string(), z.string()), updatedAt: z.number() })),
});

export interface PersonPreferences {
  /** False until this person saved anything: the desktop then offers the
   * preferences it had on this computer, once. */
  stored: boolean;
  preferences: UserPreferences;
  updatedAt: number | null;
}

export interface UserPreferenceStore {
  get(principalId: string): PersonPreferences;
  /** Replace this person's preferences with the known keys of `input`. */
  put(principalId: string, input: unknown): PersonPreferences;
  /** Forget this person's preferences (account deletion). */
  remove(principalId: string): void;
}

export function createUserPreferenceStore(dataDir: string, now: () => number = Date.now): UserPreferenceStore {
  const file = join(dataDir, "user-preferences.json");
  let people: Record<string, { preferences: UserPreferences; updatedAt: number }> | null = null;

  const load = () => {
    if (people) return people;
    people = {};
    if (!existsSync(file)) return people;
    try {
      const parsed = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      for (const [id, entry] of Object.entries(parsed.people)) {
        if (PRINCIPAL_ID.test(id)) people[id] = { preferences: cleanUserPreferences(entry.preferences), updatedAt: entry.updatedAt };
      }
    } catch (error) {
      // A damaged file costs people their synced choices, never the server.
      console.warn(`user preferences: ${file} could not be read (${error instanceof Error ? error.message : String(error)}); starting empty`);
    }
    return people;
  };

  const requirePerson = (principalId: string) => {
    if (!PRINCIPAL_ID.test(principalId)) throw Object.assign(new Error("not a person"), { status: 403 });
  };

  return {
    get(principalId) {
      requirePerson(principalId);
      const entry = load()[principalId];
      return entry ? { stored: true, preferences: { ...entry.preferences }, updatedAt: entry.updatedAt } : { stored: false, preferences: {}, updatedAt: null };
    },
    put(principalId, input) {
      requirePerson(principalId);
      const all = load();
      if (!all[principalId] && Object.keys(all).length >= MAX_PEOPLE) throw Object.assign(new Error("too many people"), { status: 507 });
      const entry = { preferences: cleanUserPreferences(input), updatedAt: now() };
      all[principalId] = entry;
      writeFileAtomic(file, `${JSON.stringify({ version: 1, people: all }, null, 2)}\n`, { mode: 0o600 });
      return { stored: true, preferences: { ...entry.preferences }, updatedAt: entry.updatedAt };
    },
    remove(principalId) {
      const all = load();
      if (!all[principalId]) return;
      delete all[principalId];
      writeFileAtomic(file, `${JSON.stringify({ version: 1, people: all }, null, 2)}\n`, { mode: 0o600 });
    },
  };
}
