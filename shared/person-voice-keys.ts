// A person's own voice keys on an organization server (#1098, 2026-10-28):
// ElevenLabs, Fish Audio and xAI (Grok voice). The person saves them with
// no admin right (GET/PUT/DELETE /api/me/voice-keys,
// server/routes/person-voice-keys.ts); the server uses them for that
// person's own speech and voice notes, in place of the organization's key
// for the same engine. The organization's shared keys stay engines.manage.
// The voice engine itself stays the installation's choice.

export const PERSONAL_VOICE_KEY_PROVIDERS = ["elevenlabs", "fish", "xai"] as const;
export type PersonalVoiceKeyProvider = (typeof PERSONAL_VOICE_KEY_PROVIDERS)[number];

export function isPersonalVoiceKeyProvider(value: unknown): value is PersonalVoiceKeyProvider {
  return typeof value === "string" && (PERSONAL_VOICE_KEY_PROVIDERS as readonly string[]).includes(value);
}

/** One row of what GET /api/me/voice-keys answers: never the key. */
export interface PersonalVoiceKeyView {
  configured: boolean;
  /** The last four characters of a key of 12 or more, else null. */
  last4: string | null;
}

export type PersonalVoiceKeysView = Record<PersonalVoiceKeyProvider, PersonalVoiceKeyView>;

export const PERSONAL_VOICE_KEY_LABELS: Record<PersonalVoiceKeyProvider, string> = {
  elevenlabs: "ElevenLabs",
  fish: "Fish Audio",
  xai: "xAI (Grok voice)",
};
