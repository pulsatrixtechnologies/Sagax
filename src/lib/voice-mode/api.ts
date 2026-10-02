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

  constructor(message: string, cause: VoiceModeRefusalCause, keysUrl?: string) {
    super(message);
    this.cause = cause;
    this.keysUrl = keysUrl;
  }
}

const base = (botId: string) => `/api/bots/${encodeURIComponent(botId)}/voice`;

async function failure(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string; cause?: VoiceModeRefusalCause; card?: { keysUrl?: string } };
  if (res.status === 403 && body.code === "voice_no_access" && body.cause) {
    return new VoiceModeRefused(body.error ?? "Voice mode is not available.", body.cause, body.card?.keysUrl);
  }
  return new Error(body.error ?? `the voice service returned ${res.status}`);
}

export async function fetchVoiceModeStatus(botId: string, signal?: AbortSignal): Promise<VoiceModeStatus | null> {
  try {
    const res = await fetch(`${base(botId)}/status`, { signal });
    if (!res.ok) return null;
    const body = (await res.json()) as VoiceModeStatus;
    return body && body.provider === "xai" ? body : null;
  } catch {
    return null;
  }
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

const statusCache = new Map<string, { at: number; status: VoiceModeStatus | null }>();
const STATUS_TTL_MS = 60_000;

/** Whether this bot can be talked to through xAI voice mode, for the call
 * button. null while unknown, or when the server has no voice mode. */
export function useVoiceModeStatus(botId: string): VoiceModeStatus | null {
  const cachedNow = statusCache.get(botId);
  const [status, setStatus] = useState<VoiceModeStatus | null>(cachedNow?.status ?? null);
  useEffect(() => {
    const cached = statusCache.get(botId);
    if (cached && Date.now() - cached.at < STATUS_TTL_MS) {
      setStatus(cached.status);
      return;
    }
    if (typeof fetch !== "function") return;
    const controller = new AbortController();
    void fetchVoiceModeStatus(botId, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      statusCache.set(botId, { at: Date.now(), status: next });
      setStatus(next);
    });
    return () => controller.abort();
  }, [botId]);
  return status;
}

/** For tests and after a key change. */
export function forgetVoiceModeStatus(): void {
  statusCache.clear();
}
