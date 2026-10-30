// ElevenLabs as a voice of voice mode (2026-10-29): the person's own voices
// (cloned ones included, GET /v1/voices) for a live call's answers (raw
// 24 kHz PCM, POST /v1/text-to-speech/<voice>/stream) and a reply read
// aloud (MP3). Runs on the server with the person's key; the page never
// sees it. server/tts/elevenlabs.ts stays the installation's engine for
// the older paths; this file speaks the voice-mode contract: messages
// sorted like xAI's (server/tts/grok.ts grokVoiceFailure), never
// ElevenLabs' body, and every request refuses redirects (a redirect would
// carry `xi-api-key` elsewhere).
import { createHash } from "node:crypto";

import { elevenLabsProviderApi } from "../included-services.ts";
import type { Audio, Voice } from "./elevenlabs.ts";
import type { SynthesizeOptions } from "./grok.ts";

export const ELEVENLABS_PCM_RATE = 24_000;
/** ElevenLabs takes a speed from 0.7 to 1.2 (voice_settings.speed). */
export const ELEVENLABS_MIN_SPEED = 0.7;
export const ELEVENLABS_MAX_SPEED = 1.2;
const BODY_MAX = 2_048;
const VOICES_TTL_MS = 10 * 60_000;

/** A voice of the person's account; `own` for one they made (cloned or designed). */
export interface OwnVoice extends Voice {
  own?: true;
}

export interface ElevenLabsVoiceOptions {
  api?: string;
  apiForKey?(key: string): string;
  model?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** ElevenLabs' reason, read only to sort the refusal. */
function detailStatus(body: string): string {
  try {
    const parsed = JSON.parse(body.slice(0, BODY_MAX)) as { detail?: { status?: unknown; code?: unknown } | string };
    const detail = parsed.detail;
    if (detail && typeof detail === "object") return String(detail.status ?? detail.code ?? "");
    return "";
  } catch {
    return "";
  }
}

export function elevenLabsRefusal(status: number, body = ""): string {
  const said = detailStatus(body);
  if (status === 402 || /quota|credit|payment|subscription/i.test(said)) return "The ElevenLabs account needs credits to generate speech.";
  if (/voice_not_found|voice_does_not_exist/i.test(said) || status === 404) return "ElevenLabs could not find that voice. Pick another voice in Settings > Voice.";
  if (status === 401 || status === 403 || /invalid_api_key|missing_permissions|unauthorized/i.test(said)) {
    return "ElevenLabs rejected the key or its permissions (Voices and Text to Speech). Check the ElevenLabs key in Settings > Voice.";
  }
  if (status === 429 || /too_many|rate|concurrent/i.test(said)) return "ElevenLabs is rate-limiting speech. Wait a moment and try again.";
  return `ElevenLabs voice failed (HTTP ${status}). Try again later.`;
}

export function elevenLabsSpeed(speed: number | undefined): number | undefined {
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed === 1) return undefined;
  return Math.min(ELEVENLABS_MAX_SPEED, Math.max(ELEVENLABS_MIN_SPEED, speed));
}

/** The ISO 639-1 language for a voice-mode TTS language ("fr", "pt-BR"), or undefined for auto. */
export function elevenLabsLanguage(language: string | undefined): string | undefined {
  if (!language || language === "auto") return undefined;
  const base = language.split("-")[0]!.toLowerCase();
  return /^[a-z]{2}$/.test(base) ? base : undefined;
}

function keyId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function createElevenLabsVoice(options: ElevenLabsVoiceOptions = {}) {
  const api = (key: string) => (options.api ?? options.apiForKey?.(key) ?? elevenLabsProviderApi()).replace(/\/+$/, "");
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const model = () => options.model ?? (process.env.SAGAX_ELEVENLABS_VOICE_MODEL?.trim() || "eleven_flash_v2_5");
  /** each key's voices, a while: the default voice and the settings' list */
  const voices = new Map<string, { at: number; list: OwnVoice[] }>();

  async function request(path: string, init: RequestInit, key: string): Promise<Response> {
    let response: Response;
    try {
      response = await doFetch(`${api(key)}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), "xi-api-key": key }, redirect: "error" });
    } catch (error) {
      const reason = (init.signal as AbortSignal | undefined)?.reason as { name?: string } | undefined;
      if (error instanceof Error && (error.name === "TimeoutError" || (error.name === "AbortError" && reason?.name === "TimeoutError"))) {
        throw new Error("ElevenLabs voice timed out. Try again.");
      }
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new Error("Could not reach ElevenLabs voice. Check your connection.");
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(elevenLabsRefusal(response.status, body));
    }
    return response;
  }

  async function listVoices(key: string): Promise<OwnVoice[]> {
    const id = keyId(key);
    const cached = voices.get(id);
    if (cached && now() - cached.at < VOICES_TTL_MS) return cached.list;
    const response = await request("/voices", { signal: AbortSignal.timeout(20_000) }, key);
    const body = (await response.json().catch(() => null)) as { voices?: Array<Record<string, any>> } | null;
    if (!body || !Array.isArray(body.voices)) throw new Error("ElevenLabs returned an invalid voice list. Try again later.");
    const list: OwnVoice[] = body.voices
      .map((voice): OwnVoice => {
        const category = typeof voice.category === "string" ? voice.category : "";
        const description = [voice.labels?.accent, voice.labels?.description].filter((part) => typeof part === "string" && part).join(" · ");
        const own = category === "cloned" || category === "professional" || category === "generated";
        return { id: String(voice.voice_id ?? ""), label: String(voice.name ?? "Voice"), ...(description ? { description } : {}), ...(own ? { own: true } : {}) };
      })
      .filter((voice) => /^[\w.-]{1,64}$/.test(voice.id));
    // the person's own voices (cloned, designed) first
    list.sort((a, b) => Number(Boolean(b.own)) - Number(Boolean(a.own)));
    if (voices.size >= 1_000) voices.clear();
    voices.set(id, { at: now(), list });
    return list;
  }

  /** The voice when none was picked: the first of the person's own. */
  async function voiceOrDefault(voice: string | undefined, key: string): Promise<string> {
    if (voice) return voice;
    const first = (await listVoices(key))[0]?.id;
    if (!first) throw new Error("ElevenLabs could not find that voice. Pick another voice in Settings > Voice.");
    return first;
  }

  function body(text: string, opts: SynthesizeOptions): string {
    const speed = elevenLabsSpeed(opts.speed);
    const language = elevenLabsLanguage(opts.language);
    return JSON.stringify({
      text,
      model_id: model(),
      ...(language ? { language_code: language } : {}),
      ...(speed !== undefined ? { voice_settings: { speed } } : {}),
    });
  }

  return {
    listVoices,
    /** The key lists voices: a live call's voice says ready only then. */
    async verify(key: string): Promise<void> {
      await listVoices(key);
    },
    async synthesize(text: string, voice: string | undefined, key: string, opts: SynthesizeOptions = {}): Promise<Audio> {
      const id = await voiceOrDefault(voice, key);
      const response = await request(`/text-to-speech/${encodeURIComponent(id)}/stream?output_format=mp3_44100_64`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "audio/mpeg" },
        body: body(text, opts),
        signal: AbortSignal.timeout(60_000),
      }, key);
      const bytes = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (!bytes.byteLength) throw new Error("ElevenLabs returned empty audio. Try again.");
      return { bytes, mime: "audio/mpeg" };
    },
    async synthesizeStream(text: string, voice: string | undefined, key: string, opts: SynthesizeOptions = {}, signal?: AbortSignal): Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number }> {
      const id = await voiceOrDefault(voice, key);
      const timeout = AbortSignal.timeout(60_000);
      const response = await request(`/text-to-speech/${encodeURIComponent(id)}/stream?output_format=pcm_${ELEVENLABS_PCM_RATE}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/octet-stream" },
        body: body(text, opts),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      }, key);
      const mime = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
      if (!response.body || mime === "application/json" || mime.startsWith("text/")) {
        await response.body?.cancel().catch(() => {});
        throw new Error("ElevenLabs returned an unexpected audio format. Try again later.");
      }
      return { body: response.body, sampleRate: ELEVENLABS_PCM_RATE };
    },
  };
}

export type ElevenLabsVoice = ReturnType<typeof createElevenLabsVoice>;
