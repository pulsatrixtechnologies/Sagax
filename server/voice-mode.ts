// Voice mode (the floating voice bar) on any server, solo or organization:
// xAI does the voice, the bot stays the brain.
//
//   GET  /api/bots/<id>/voice/status      can this person talk to this bot by voice, and who pays
//   GET  /api/bots/<id>/voice/voices      xAI's voices (labels only)
//   POST /api/bots/<id>/voice/prepare     {text} -> {utterances}
//   POST /api/bots/<id>/voice/speak       {text, voice?, speed?, language?, threadId?} -> audio/mpeg
//   POST /api/bots/<id>/voice/transcribe  raw audio/wav (?language=&threadId=) -> {text}
//
// The microphone and the speaker are the person's own (the desktop app or a
// browser); what they say goes to the bot as an ordinary message through the
// usual send route, so the turn is theirs and the private-thread rules apply
// exactly as for a typed message. These routes only turn speech into text
// and text into speech, with xAI, and the key never leaves the server:
// xAI's own guidance is to proxy speech to text through a backend rather
// than put a key in a client
// (https://docs.x.ai/developers/model-capabilities/audio/speech-to-text).
// Its ephemeral client secrets (POST /v1/realtime/client_secrets) open only
// the realtime speech-to-speech agent, where Grok itself would answer instead
// of the bot, its tools, approvals and memory, so voice mode does not use them.
//
// Who pays (the order of engine-credentials.ts, for the person who speaks):
//   organization server: the speaker's own xAI key in Perspicax, else the
//   organization's xAI key (Settings > Connections), else refused with an
//   access card shown only to that person; a disabled person is refused.
//   Solo server: the server's xAI key.
// Every request names a bot the person may use (the visibility gate already
// hides the others) and, when given, a thread they may post to. Each speak
// and transcribe is recorded in the usage ledger with `access` (the via).
import type { IncomingMessage } from "node:http";

import {
  VOICE_ID,
  VOICE_MODE_MAX_AUDIO_BYTES,
  VOICE_MODE_MAX_SPEED,
  VOICE_MODE_MAX_TEXT,
  VOICE_MODE_MIN_SPEED,
  isVoiceModeLanguage,
  sttLanguage,
  ttsLanguage,
  type VoiceModeRefusalCause,
  type VoiceModeStatus,
  type VoiceModeVia,
} from "../shared/voice-mode.ts";
import { accessCardVisibleTo } from "./engine-access.ts";
import type { ProviderKeyResult } from "./perspicax-link.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import type { Audio, Voice } from "./tts/elevenlabs.ts";

const ROUTE = /^\/api\/bots\/([\w-]+)\/voice\/(status|voices|prepare|speak|transcribe)$/;
const THREAD_ID = /^[\w-]{1,128}$/;
/** Requests per person per minute (speak, transcribe and voices together). */
export const VOICE_MODE_RATE = { max: 120, windowMs: 60_000 } as const;

export interface VoiceSpeaker {
  /** The person who speaks (principal id), "" for the solo operator's console. */
  principalId: string;
  /** Their Perspicax subject (organization server). */
  sub?: string;
  disabled?: boolean;
}

export interface VoiceTarget {
  botId: string;
  botName: string;
  threadId: string;
  /** The bot's owner (organization server), for the access card's audience. */
  ownerPrincipalId?: string;
}

export type VoiceKey =
  | { ok: true; key: string; via: VoiceModeVia; payerPrincipalId?: string }
  | { ok: false; cause: VoiceModeRefusalCause };

export interface VoiceUsage {
  target: VoiceTarget;
  speaker: VoiceSpeaker;
  via: VoiceModeVia;
  payerPrincipalId?: string;
  model: "grok-tts" | "grok-stt";
  /** characters spoken, or bytes of audio heard */
  input: number;
}

export interface VoiceModeDeps {
  organization: boolean;
  /** The person behind a request, or null for a caller who is not one (a local service). */
  speaker(auth: RequestAuth): VoiceSpeaker | null;
  /** The bot and thread the person talks to, or why not (404 hides a bot
   * they may not use, like every other bot route). */
  target(auth: RequestAuth, botId: string, threadId: string | undefined): VoiceTarget | { status: number; error: string };
  /** The organization's (or solo server's) xAI key: Settings > Connections. */
  serverKey(): string | undefined;
  /** The speaker's own keys listed in Perspicax (names only). */
  hasOwnKey(sub: string): boolean;
  resolveOwnKey(sub: string): Promise<ProviderKeyResult>;
  /** An organization admin: their access card also names the organization's key. */
  isAdmin?(auth: RequestAuth): boolean;
  /** Where a person adds their own key in Perspicax. */
  keysUrl?(): string | undefined;
  xai: {
    listVoices(key: string): Promise<Voice[]>;
    synthesize(text: string, voice: string | undefined, key: string, options: { speed?: number; language?: string }): Promise<Audio>;
    transcribe(audio: Uint8Array, mime: string, key: string, language?: string): Promise<{ text: string }>;
  };
  utterances(text: string): string[];
  recordUsage(usage: VoiceUsage): void;
  now?: () => number;
}

/** The order above, for one person. Never returns a key to anyone but the caller of xAI. */
export async function resolveVoiceKey(deps: Pick<VoiceModeDeps, "organization" | "serverKey" | "hasOwnKey" | "resolveOwnKey">, speaker: VoiceSpeaker): Promise<VoiceKey> {
  const serverKey = deps.serverKey()?.trim();
  if (!deps.organization) return serverKey ? { ok: true, key: serverKey, via: "server" } : { ok: false, cause: "no_credentials" };
  if (speaker.disabled) return { ok: false, cause: "payer_disabled" };
  if (speaker.sub && deps.hasOwnKey(speaker.sub)) {
    const own = await deps.resolveOwnKey(speaker.sub);
    if (own.ok) return { ok: true, key: own.key, via: "speaker-key", payerPrincipalId: speaker.principalId };
    if (own.error === "user_inactive") return { ok: false, cause: "payer_disabled" };
    if (own.error !== "no_key") return { ok: false, cause: "perspicax_unreachable" };
  }
  return serverKey ? { ok: true, key: serverKey, via: "org-key" } : { ok: false, cause: "no_credentials" };
}

const REFUSAL_TEXT: Record<VoiceModeRefusalCause, string> = {
  no_credentials: "Voice mode needs an xAI key: add your own in Perspicax, or ask an administrator to add the organization's xAI key in Settings > Connections.",
  payer_disabled: "Your access is turned off in your organization.",
  perspicax_unreachable: "Perspicax could not be reached to read your xAI key. Try again in a moment.",
};

/** A refusal: an access card, never a key or a part of one. The card follows
 * the audience rule of every access card (engine-access.ts
 * accessCardAudience): it is about the person whose credentials the voice
 * needed, the speaker, and reaches only them. It is answered to their own
 * request, never stored in a thread nor sent as a live frame. */
function refusalBody(cause: VoiceModeRefusalCause, keysUrl: string | undefined, target: VoiceTarget, speaker: VoiceSpeaker, admin: boolean) {
  const access = { reason: "no_access", ownerPrincipalId: target.ownerPrincipalId ?? "", payerPrincipalId: speaker.principalId };
  const forThem = !speaker.principalId || accessCardVisibleTo({ kind: "access", access }, speaker.principalId);
  return {
    code: "voice_no_access",
    cause,
    error: REFUSAL_TEXT[cause],
    ...(forThem
      ? { card: { kind: "access" as const, cause, ...(speaker.principalId ? { payerPrincipalId: speaker.principalId } : {}), ...(admin ? { admin: true } : {}), ...(keysUrl ? { keysUrl } : {}) } }
      : {}),
  };
}

async function readRaw(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const declared = Number(req.headers["content-length"] ?? "");
  if (Number.isFinite(declared) && declared > limit) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > limit) return null;
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

/** A RIFF/WAVE header, or an Ogg/WebM container: the formats the bar sends. */
export function audioMime(bytes: Uint8Array, declared: string): string | null {
  const type = declared.split(";")[0]!.trim().toLowerCase();
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.byteLength >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "audio/wav";
  if (bytes.byteLength >= 4 && ascii(0, 4) === "OggS" && (type === "audio/ogg" || type === "")) return "audio/ogg";
  if (bytes.byteLength >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "audio/webm";
  return null;
}

/** A provider error, without any secret the request may have carried. */
function scrub(message: string, key: string): string {
  const out = key ? message.split(key).join("[redacted]") : message;
  return out.length > 300 ? `${out.slice(0, 300)}...` : out;
}

export function createVoiceModeRoutes(deps: VoiceModeDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const limited = (who: string): boolean => {
    const at = now();
    const recent = (hits.get(who) ?? []).filter((t) => at - t < VOICE_MODE_RATE.windowMs);
    if (recent.length >= VOICE_MODE_RATE.max) {
      hits.set(who, recent);
      return true;
    }
    recent.push(at);
    if (hits.size >= 10_000) hits.clear();
    hits.set(who, recent);
    return false;
  };

  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    const [, botId, action] = match as unknown as [string, string, "status" | "voices" | "prepare" | "speak" | "transcribe"];
    res.setHeader("cache-control", "no-store");
    const expected = action === "status" || action === "voices" ? "GET" : "POST";
    if (method !== expected) return json(res, 405, { error: "method not allowed" });

    const speaker = deps.speaker(auth);
    if (!speaker || (deps.organization && !speaker.principalId)) return json(res, 403, { error: "sign in as a person first", code: "sign_in" });

    const body = action === "prepare" || action === "speak" ? await readBody(req).catch(() => null) : null;
    if ((action === "prepare" || action === "speak") && (!body || typeof body !== "object")) return json(res, 400, { error: "a JSON body is required" });
    const rawThread = action === "transcribe" ? url.searchParams.get("threadId") ?? undefined : (body as Record<string, unknown> | null)?.threadId;
    if (rawThread !== undefined && rawThread !== null && (typeof rawThread !== "string" || !THREAD_ID.test(rawThread))) return json(res, 400, { error: "threadId must be a task id" });
    const target = deps.target(auth, botId, typeof rawThread === "string" ? rawThread : undefined);
    if ("status" in target) return json(res, target.status, { error: target.error });

    const keysUrl = deps.keysUrl?.();
    const admin = deps.isAdmin?.(auth) === true;
    const resolved = await resolveVoiceKey(deps, speaker);
    if (action === "status") {
      const org = deps.organization ? { organization: true } : {};
      const status: VoiceModeStatus = resolved.ok
        ? { provider: "xai", available: true, ...org, via: resolved.via }
        : { provider: "xai", available: false, ...org, refusal: { cause: resolved.cause, ...(admin ? { admin: true } : {}), ...(keysUrl ? { keysUrl } : {}) } };
      return json(res, 200, status);
    }
    if (!resolved.ok) return json(res, 403, refusalBody(resolved.cause, keysUrl, target, speaker, admin));
    const who = speaker.principalId || "operator";

    if (action === "prepare") {
      const text = String((body as Record<string, unknown>).text ?? "");
      return json(res, 200, { ready: true, utterances: deps.utterances(text) });
    }
    if (limited(who)) return json(res, 429, { error: "Too many voice requests. Wait a moment." });

    if (action === "voices") {
      try {
        return json(res, 200, { voices: await deps.xai.listVoices(resolved.key) });
      } catch (error) {
        return json(res, 502, { voices: [], error: scrub(error instanceof Error ? error.message : String(error), resolved.key) });
      }
    }

    const usage = (model: VoiceUsage["model"], input: number) => deps.recordUsage({
      target, speaker, via: resolved.via, model, input,
      ...(resolved.payerPrincipalId ? { payerPrincipalId: resolved.payerPrincipalId } : {}),
    });

    if (action === "speak") {
      const record = body as Record<string, unknown>;
      const text = String(record.text ?? "").trim();
      if (!text) return json(res, 400, { error: "text required" });
      if (text.length > VOICE_MODE_MAX_TEXT) return json(res, 413, { error: `voice utterances are limited to ${VOICE_MODE_MAX_TEXT} characters` });
      const voice = record.voice === undefined || record.voice === "" ? undefined : record.voice;
      if (voice !== undefined && (typeof voice !== "string" || !VOICE_ID.test(voice))) return json(res, 400, { error: "voice must be an xAI voice id" });
      const speed = record.speed === undefined ? 1 : record.speed;
      if (typeof speed !== "number" || !Number.isFinite(speed) || speed < VOICE_MODE_MIN_SPEED || speed > VOICE_MODE_MAX_SPEED) {
        return json(res, 400, { error: `speed must be between ${VOICE_MODE_MIN_SPEED} and ${VOICE_MODE_MAX_SPEED}` });
      }
      const language = record.language === undefined ? "auto" : record.language;
      if (!isVoiceModeLanguage(language)) return json(res, 400, { error: "unknown language" });
      try {
        const audio = await deps.xai.synthesize(text, voice, resolved.key, { speed, language: ttsLanguage(language) });
        usage("grok-tts", text.length);
        res.writeHead(200, { "content-type": audio.mime, "content-length": String(audio.bytes.byteLength), "cache-control": "no-store" });
        res.end(Buffer.from(audio.bytes));
        return;
      } catch (error) {
        return json(res, 502, { error: scrub(error instanceof Error ? error.message : String(error), resolved.key) });
      }
    }

    // transcribe
    const language = url.searchParams.get("language") ?? "auto";
    if (!isVoiceModeLanguage(language)) return json(res, 400, { error: "unknown language" });
    const audio = await readRaw(req, VOICE_MODE_MAX_AUDIO_BYTES);
    if (!audio) return json(res, 413, { error: "the recording is too long" });
    if (!audio.byteLength) return json(res, 400, { error: "audio required" });
    const mime = audioMime(audio, String(req.headers["content-type"] ?? ""));
    if (!mime) return json(res, 415, { error: "send WAV, Ogg or WebM audio" });
    try {
      const heard = await deps.xai.transcribe(new Uint8Array(audio), mime, resolved.key, sttLanguage(language));
      usage("grok-stt", audio.byteLength);
      return json(res, 200, { text: heard.text.trim() });
    } catch (error) {
      return json(res, 502, { error: scrub(error instanceof Error ? error.message : String(error), resolved.key) });
    }
  };
}
