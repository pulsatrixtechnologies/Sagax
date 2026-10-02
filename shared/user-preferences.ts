// A person's preferences on an organization server (server mode): the
// appearance, language, notifications, mascot settings and sidebar layout
// that follow the PERSON from device to device. The renderer keeps them in
// localStorage under these exact keys (the modules that own them read them
// there), and on an organization server they are also kept per person on
// the server (server/user-preferences.ts, GET/PUT /api/me/preferences).
//
// Only these keys travel. Everything about one device or one window stays
// on that device: drafts, window and panel sizes, which bots float and where
// (always on top included), the mascot's mood and balloon, the Hibou 98
// assistant's position (omb.retro98.prefs), this device's voices
// (openmausbot.remote-voice.v1), the settings cards left open, caches and
// credentials.
import { z } from "zod";

export const USER_PREFERENCE_KEYS = [
  // appearance (the Hibou 98 switch goes with the skin it swaps)
  "omb-skin",
  "omb-font",
  "omb-show-threads",
  "omb.retro98.on",
  "omb.retro98.unlocked",
  "omb.retro98.previousSkin",
  // language (empty or absent: follow the system, then the server's default)
  "omb-language",
  // notifications
  "omb-notification-sounds",
  // the desktop mascot's behavior (fly away during tasks, activity level)
  "omb.floatingBots.prefs.v1",
  // sidebar layout
  "openmausbot.sidebarDensity",
  "openmausbot.sidebarExpandedDensity.v1",
  "openmausbot.sidebarCollapsedSections.v1",
  "openmausbot.sidebarSectionOrder.v1",
  "openmausbot.sidebarAttentionPinned.v1",
  // what the person hid from their sidebar (src/lib/sidebar-hidden.ts)
  "sagax.sidebarHidden.v1",
  // privacy
  "omb-analytics-opt-out",
  // where bots work for this person (organization server: their computer
  // through the desktop app, or their server environment; shared/bot-workplace.ts)
  "sagax.botWorkplace.v1",
  // voice mode: the xAI voice, speed and language (shared/voice-mode.ts)
  "omb.voiceMode.v1",
  // what a message sent to a busy conversation does (shared/parallel-tasks.ts)
  "sagax.busySend.v1",
] as const;

export type UserPreferenceKey = (typeof USER_PREFERENCE_KEYS)[number];
export type UserPreferences = Partial<Record<UserPreferenceKey, string>>;

/** One value: the string a module stored, bounded. */
export const MAX_PREFERENCE_VALUE = 8 * 1024;

const keySet: ReadonlySet<string> = new Set(USER_PREFERENCE_KEYS);

export function isUserPreferenceKey(key: unknown): key is UserPreferenceKey {
  return typeof key === "string" && keySet.has(key);
}

export const userPreferencesSchema = z
  .record(z.string(), z.string().max(MAX_PREFERENCE_VALUE))
  .refine((value) => Object.keys(value).every(isUserPreferenceKey), { message: "unknown preference" });

/** Keep the known keys with string values, drop everything else. */
export function cleanUserPreferences(input: unknown): UserPreferences {
  const out: UserPreferences = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (isUserPreferenceKey(key) && typeof value === "string" && value.length <= MAX_PREFERENCE_VALUE) out[key] = value;
  }
  return out;
}
