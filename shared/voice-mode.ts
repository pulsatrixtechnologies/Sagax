// Voice mode (the floating voice bar): what a person picks for the voice
// that reads a bot's answers and the language they speak, shared by the
// renderer (src/lib/voice-mode/) and the server (server/voice-mode.ts).
//
// xAI does the voice: speech to text (POST /v1/stt) and text to speech
// (POST /v1/tts). The bot stays the brain: what the person says is sent to
// the bot as an ordinary message, and the bot's answer is read back.
// Sources: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
// and https://docs.x.ai/developers/model-capabilities/audio/text-to-speech
import { z } from "zod";

/** localStorage key; travels with the person on an organization server
 * (shared/user-preferences.ts). */
export const VOICE_MODE_STORAGE_KEY = "omb.voiceMode.v1";

/** xAI accepts a speed multiplier from 0.7 to 1.5 (TTS `speed`). */
export const VOICE_MODE_SPEEDS = [0.75, 1, 1.25, 1.5] as const;
export const VOICE_MODE_MIN_SPEED = 0.7;
export const VOICE_MODE_MAX_SPEED = 1.5;

/** The longest text one speak request takes (the client sends utterances). */
export const VOICE_MODE_MAX_TEXT = 500;
/** The largest recorded turn (16 kHz mono 16-bit WAV: about 60 s). */
export const VOICE_MODE_MAX_AUDIO_BYTES = 2 * 1024 * 1024;

export interface VoiceModeLanguage {
  /** BCP-47 code as xAI takes it, or "auto". */
  code: string;
  label: string;
}

/** The languages the panel offers, in the order of the reference design. */
export const VOICE_MODE_LANGUAGES: readonly VoiceModeLanguage[] = [
  { code: "auto", label: "Auto-detect" },
  { code: "en", label: "English" },
  { code: "ar-EG", label: "Arabic (Egypt)" },
  { code: "ar-SA", label: "Arabic (Saudi Arabia)" },
  { code: "ar-AE", label: "Arabic (UAE)" },
  { code: "bn", label: "Bengali" },
  { code: "ca", label: "Catalan" },
  { code: "zh", label: "Chinese (Simplified)" },
  { code: "cs", label: "Czech" },
  { code: "da", label: "Danish" },
  { code: "nl", label: "Dutch" },
  { code: "fil", label: "Filipino" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "hi", label: "Hindi" },
  { code: "id", label: "Indonesian" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "ms", label: "Malay" },
  { code: "fa", label: "Persian" },
  { code: "pl", label: "Polish" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "pt-PT", label: "Portuguese (Portugal)" },
  { code: "ro", label: "Romanian" },
  { code: "ru", label: "Russian" },
  { code: "es-MX", label: "Spanish (Mexico)" },
  { code: "es-ES", label: "Spanish (Spain)" },
  { code: "sv", label: "Swedish" },
  { code: "th", label: "Thai" },
  { code: "tr", label: "Turkish" },
  { code: "vi", label: "Vietnamese" },
];

const LANGUAGE_CODES: ReadonlySet<string> = new Set(VOICE_MODE_LANGUAGES.map((language) => language.code));

/** Languages xAI text to speech takes as `language` (else "auto"). */
const TTS_LANGUAGES: ReadonlySet<string> = new Set([
  "en", "ar-EG", "ar-SA", "ar-AE", "bn", "zh", "fr", "de", "hi", "id", "it", "ja", "ko",
  "pt-BR", "pt-PT", "ru", "es-MX", "es-ES", "tr", "vi",
]);

/** Languages xAI speech to text takes as `language` (else detected). */
const STT_LANGUAGES: ReadonlySet<string> = new Set([
  "ar", "cs", "da", "nl", "en", "fil", "fr", "de", "hi", "id", "it", "ja", "ko", "mk", "ms",
  "fa", "pl", "pt", "ro", "ru", "es", "sv", "th", "tr", "vi",
]);

export function isVoiceModeLanguage(code: unknown): code is string {
  return typeof code === "string" && LANGUAGE_CODES.has(code);
}

/** The TTS `language` for a picked language: itself when xAI speaks it, else "auto". */
export function ttsLanguage(code: string): string {
  return TTS_LANGUAGES.has(code) ? code : "auto";
}

/** The STT `language` hint for a picked language, or undefined (detect). */
export function sttLanguage(code: string): string | undefined {
  if (code === "auto") return undefined;
  const base = code.split("-")[0]!.toLowerCase();
  return STT_LANGUAGES.has(base) ? base : undefined;
}

export interface VoiceModeSettings {
  /** An xAI voice id; "" is Not set (xAI's default voice). */
  voice: string;
  speed: number;
  language: string;
}

export const DEFAULT_VOICE_MODE_SETTINGS: VoiceModeSettings = { voice: "", speed: 1, language: "auto" };

/** A voice id as xAI lists them (GET /v1/tts/voices): short and plain. */
export const VOICE_ID = /^[\w.-]{1,64}$/;

export const voiceModeSettingsSchema = z.object({
  voice: z.string().regex(VOICE_ID).or(z.literal("")),
  speed: z.number().min(VOICE_MODE_MIN_SPEED).max(VOICE_MODE_MAX_SPEED),
  language: z.string().refine(isVoiceModeLanguage),
});

/** Keep what is valid, default the rest. Never throws. */
export function cleanVoiceModeSettings(input: unknown): VoiceModeSettings {
  const record = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const voice = typeof record.voice === "string" && (record.voice === "" || VOICE_ID.test(record.voice)) ? record.voice : DEFAULT_VOICE_MODE_SETTINGS.voice;
  const speed = typeof record.speed === "number" && Number.isFinite(record.speed) && record.speed >= VOICE_MODE_MIN_SPEED && record.speed <= VOICE_MODE_MAX_SPEED
    ? record.speed
    : DEFAULT_VOICE_MODE_SETTINGS.speed;
  const language = isVoiceModeLanguage(record.language) ? record.language : DEFAULT_VOICE_MODE_SETTINGS.language;
  return { voice, speed, language };
}

/** Why voice mode cannot run for this person: no xAI key serves them, or
 * their own access is turned off. */
export type VoiceModeRefusalCause = "no_credentials" | "payer_disabled" | "perspicax_unreachable";

/** Who pays for the voice: the person's own xAI key (in Perspicax), the
 * organization's key (Settings > Connections), or, on a solo server, the
 * server's key. */
export type VoiceModeVia = "speaker-key" | "org-key" | "server";

export interface VoiceModeStatus {
  provider: "xai";
  available: boolean;
  /** An organization server: voice mode is the only call there (no
   * dictation helper, no "This computer"), so the client never falls back
   * on the legacy call gate. */
  organization?: boolean;
  via?: VoiceModeVia;
  /** For the speaker only (the access card's audience); `admin` adds the
   * organization's key hint, as on every access card. */
  refusal?: { cause: VoiceModeRefusalCause; admin?: true; keysUrl?: string };
}
