// Voice mode (the floating voice bar): what a person picks for the voice
// that reads a bot's answers and the language they speak, shared by the
// renderer (src/lib/voice-mode/) and the server (server/voice-mode.ts).
//
// xAI does the voice: speech to text (POST /v1/stt) and text to speech
// (POST /v1/tts). The bot stays the brain: what the person says is sent to
// the bot as an ordinary message, and the bot's answer is read back.
// Sources: https://docs.x.ai/developers/model-capabilities/audio/speech-to-text
// and https://docs.x.ai/developers/model-capabilities/audio/text-to-speech

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

/** The TTS `language` for a picked language: itself when xAI speaks it.
 * A French region (`fr-CA`) speaks as `fr`. Anything else is "auto". */
export function ttsLanguage(code: string): string {
  if (TTS_LANGUAGES.has(code)) return code;
  const base = code.split("-")[0]!.toLowerCase();
  if (base === "fr") return "fr";
  return "auto";
}

/** The STT `language` hint for a picked language, or undefined (detect). */
export function sttLanguage(code: string): string | undefined {
  if (code === "auto") return undefined;
  const base = code.split("-")[0]!.toLowerCase();
  return STT_LANGUAGES.has(base) ? base : undefined;
}

/** Languages xAI formats (`format`, inverse text normalization: "deux
 * cents" as 200). It needs a language. */
const FORMAT_LANGUAGES: ReadonlySet<string> = new Set(["en", "fr"]);

/** A BCP-47 tag as a browser reports it (`navigator.language`), or undefined.
 * The page sends it beside the language so the server can read "auto" on a
 * French computer as French; the server keeps only a well formed one. */
export function cleanVoiceLocale(input: unknown): string | undefined {
  if (typeof input !== "string" || input.length > 35) return undefined;
  return /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/.test(input) ? input : undefined;
}

/** What the server asks xAI speech to text for: a language and
 * formatting. "auto" on a French locale (fr-CA, fr-FR...) is French with
 * formatting, so a Québec speaker gets the French turn waits and "deux
 * cents" written 200; an explicit language gets formatting where xAI
 * offers it; anything else stays pure detection. */
export function sttRequest(code: string, locale?: string): { language?: string; format: boolean } {
  const language = sttLanguage(code);
  if (language) return { language, format: FORMAT_LANGUAGES.has(language) };
  if (code === "auto" && cleanVoiceLocale(locale)?.split("-")[0]!.toLowerCase() === "fr") return { language: "fr", format: true };
  return { format: false };
}

/** Hesitation sounds xAI writes when asked to keep them (`filler_words`). */
const FILLER_WORDS = ["euh", "euhm", "heu", "hum", "uh", "uhm", "um", "umm", "erm", "er", "hmm", "hm", "mm", "mmm"];
const FILLER = new RegExp(`(^|[\\s,;.!?\u2026])(?:${FILLER_WORDS.join("|")})(?:[.\u2026]+|,)?(?=$|[\\s,;.!?\u2026])`, "giu");

/** The words without hesitation sounds: what a bot reads of a turn. The
 * turn detector still sees them (a trailing "euh" is a person thinking). */
export function stripFillers(text: string): string {
  const trimmed = text.trim();
  let out = trimmed;
  // twice: "euh euh" overlaps the separator the first match took
  for (let i = 0; i < 2; i++) out = out.replace(FILLER, "$1");
  out = out.replace(/\s+([,;.!?\u2026])/g, "$1").replace(/(^|\s)[,;]+(?=\s|$)/g, "$1").replace(/\s{2,}/g, " ").replace(/^[\s,;.\u2026]+/, "").trim();
  // a line that started with a capital keeps one
  if (out && /^\p{Lu}/u.test(trimmed) && !/^\p{Lu}/u.test(out)) out = out[0]!.toUpperCase() + out.slice(1);
  return out;
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
