// The voice bar's calls to the server (server/voice-mode.ts). Same origin,
// session cookie: the xAI key stays on the server and never reaches here.
import { useEffect, useState } from "react";

import type { VoiceModeRefusalCause, VoiceModeSettings, VoiceModeStatus } from "../../../shared/voice-mode";

export interface VoiceOption {
  id: string;
  label: string;
}

/** A refusal shown as an access card in the bar, to this person only. */
export class VoiceModeRefused extends Error {
  readonly cause: VoiceModeRefusalCause;
  readonly keysUrl?: string;
  /** an organization admin: the card also names the organization's key */
  readonly admin: boolean;

  constructor(message: string, cause: VoiceModeRefusalCause, keysUrl?: string, admin = false) {
    super(message);
    this.cause = cause;
    this.keysUrl = keysUrl;
    this.admin = admin;
  }
}

const base = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/voice`;

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; cause?: VoiceModeRefusalCause; card?: { keysUrl?: string; admin?: boolean } };
  if (res.status === 403 && body.code === "voice_no_access" && body.cause) {
    return new VoiceModeRefused(body.error ?? "Voice mode is not available.", body.cause, body.card?.keysUrl, body.card?.admin === true);
  }
  return new Error(body.error ?? `the voice service returned ${res.status}`);
}

/** What the server answered about voice mode for this bot and person. */
export type VoiceModeCheck =
  | { state: "loading" }
  | { state: "ready"; status: VoiceModeStatus }
  /** no answer: `missing` is a server without voice mode (404) */
  | { state: "error"; error: string; missing: boolean };

/** Ask the server (GET /api/bots/<id>/voice/status). The server decides;
 * the client never guesses availability on its own. */
export async function checkVoiceMode(botId: string, signal?: AbortSignal): Promise<VoiceModeCheck> {
  try {
    const res = await fetch(`${base(botId)}/status`, { signal, cache: "no-store" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { state: "error", error: body.error ?? `HTTP ${res.status}`, missing: res.status === 404 && !body.error };
    }
    const body = (await res.json()) as VoiceModeStatus;
    if (!body || body.provider !== "xai") return { state: "error", error: "unexpected answer", missing: false };
    return { state: "ready", status: body };
  } catch (error) {
    return { state: "error", error: error instanceof Error ? error.message : String(error), missing: false };
  }
}

/** Kept for callers that only need the answer. */
export async function fetchVoiceModeStatus(botId: string, signal?: AbortSignal): Promise<VoiceModeStatus | null> {
  const check = await checkVoiceMode(botId, signal);
  return check.state === "ready" ? check.status : null;
}

export async function fetchVoiceModeVoices(botId: string, signal?: AbortSignal): Promise<VoiceOption[]> {
  const res = await fetch(`${base(botId)}/voices`, { signal });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { voices?: VoiceOption[] };
  return Array.isArray(body.voices) ? body.voices.filter((voice) => typeof voice?.id === "string" && typeof voice?.label === "string") : [];
}

export async function prepareVoiceModeText(botId: string, text: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${base(botId)}/prepare`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { utterances?: string[] };
  return body.utterances ?? [];
}

export async function speakVoiceMode(
  botId: string,
  text: string,
  settings: VoiceModeSettings,
  threadId?: string,
  signal?: AbortSignal,
): Promise<Blob> {
  const res = await fetch(`${base(botId)}/speak`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice: settings.voice, speed: settings.speed, language: settings.language, ...(threadId ? { threadId } : {}) }),
    signal,
  });
  if (!res.ok) throw await failure(res);
  return res.blob();
}

/** One sentence of the bot's answer, spoken as xAI makes it
 * (POST /voice/stream): raw 16-bit PCM, its rate in `x-voice-sample-rate`.
 * null when there is nothing to say (204). */
export async function streamVoiceModeSpeech(
  botId: string,
  text: string,
  settings: VoiceModeSettings,
  threadId?: string,
  signal?: AbortSignal,
): Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number } | null> {
  const res = await fetch(`${base(botId)}/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, voice: settings.voice, speed: settings.speed, language: settings.language, ...(threadId ? { threadId } : {}) }),
    signal,
  });
  if (res.status === 204) return null;
  if (!res.ok) throw await failure(res);
  if (!res.body) throw new Error("the voice service returned no audio");
  return { body: res.body, sampleRate: Number(res.headers.get("x-voice-sample-rate")) || 24_000 };
}

/** Tell the server the thread is on a call (POST /voice/call): every send
 * to it while the call lasts is a call turn, whatever path it takes. Best
 * effort: an old server without the route still gets each turn's mark. */
export async function voiceCallSession(
  botId: string,
  state: "start" | "alive" | "end",
  call: { callId: string; threadId?: string; language?: string },
): Promise<boolean> {
  try {
    const res = await fetch(`${base(botId)}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ state, callId: call.callId, ...(call.threadId ? { threadId: call.threadId } : {}), ...(call.language ? { language: call.language } : {}) }),
      keepalive: state === "end",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The live call's streaming speech to text socket (GET /voice/listen). */
export function voiceModeListenUrl(botId: string, language: string, threadId?: string, origin = typeof location === "undefined" ? "http://localhost" : location.origin): string {
  const query = new URLSearchParams({ language, ...(threadId ? { threadId } : {}) });
  return `${origin.replace(/^http/, "ws")}${base(botId)}/listen?${query}`;
}

export async function transcribeVoiceMode(
  botId: string,
  audio: Blob,
  language: string,
  threadId?: string,
  signal?: AbortSignal,
): Promise<string> {
  const query = new URLSearchParams({ language, ...(threadId ? { threadId } : {}) });
  const res = await fetch(`${base(botId)}/transcribe?${query}`, {
    method: "POST",
    headers: { "content-type": audio.type || "audio/wav" },
    body: audio,
    signal,
  });
  if (!res.ok) throw await failure(res);
  const body = (await res.json()) as { text?: string };
  return typeof body.text === "string" ? body.text : "";
}

// One answer per bot, shared by the call button and the call itself. A
// "ready" answer is kept a minute; a refusal or an error is asked again at
// the next click (refreshVoiceMode), so a key added meanwhile works at once.
const checks = new Map<string, { at: number; check: VoiceModeCheck; pending?: Promise<VoiceModeCheck> }>();
const checkWatchers = new Set<() => void>();
const READY_TTL_MS = 60_000;

function notifyChecks() {
  for (const fn of Array.from(checkWatchers)) fn();
}

/** Ask the server again for this bot (a click on an unavailable call button). */
export function refreshVoiceMode(botId: string, run: typeof checkVoiceMode = checkVoiceMode): Promise<VoiceModeCheck> {
  const current = checks.get(botId);
  if (current?.pending) return current.pending;
  const pending = run(botId).then((check) => {
    checks.set(botId, { at: Date.now(), check });
    notifyChecks();
    return check;
  });
  checks.set(botId, { at: current?.at ?? 0, check: current?.check ?? { state: "loading" }, pending });
  if (!current) notifyChecks();
  return pending;
}

export function voiceModeCheckNow(botId: string): VoiceModeCheck {
  return checks.get(botId)?.check ?? { state: "loading" };
}

/** The server's answer for this bot, asked when first needed. */
export function useVoiceModeCheck(botId: string): VoiceModeCheck {
  const [, setTick] = useState(0);
  useEffect(() => {
    const watcher = () => setTick((tick) => tick + 1);
    checkWatchers.add(watcher);
    const entry = checks.get(botId);
    const stale = !entry || (!entry.pending && (entry.check.state !== "ready" || Date.now() - entry.at > READY_TTL_MS));
    if (stale && botId && typeof fetch === "function") void refreshVoiceMode(botId);
    return () => {
      checkWatchers.delete(watcher);
    };
  }, [botId]);
  return voiceModeCheckNow(botId);
}

/** The status alone (null while unknown or unanswered). */
export function useVoiceModeStatus(botId: string): VoiceModeStatus | null {
  const check = useVoiceModeCheck(botId);
  return check.state === "ready" ? check.status : null;
}

/** For tests and after a key change. */
export function forgetVoiceModeStatus(): void {
  checks.clear();
  notifyChecks();
}
