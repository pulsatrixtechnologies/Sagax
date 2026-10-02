// xAI TTS runs on the harness and reuses the existing workspace xAI key.
import { z } from "zod";
import type { Audio, Voice } from "./elevenlabs.ts";

const API = (process.env.SAGAX_XAI_TTS_API || "https://api.x.ai/v1").replace(/\/+$/, "");
const voicesSchema = z.object({
  voices: z.array(z.object({
    voice_id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
  })),
});

const sttSchema = z.object({ text: z.string(), language: z.string().optional() });

function refusal(status: number): string {
  if (status === 401 || status === 403) return "xAI rejected the key or its TTS permissions. Check the xAI key in Settings.";
  if (status === 402) return "The xAI account needs credits to generate speech.";
  if (status === 429) return "xAI is rate-limiting speech. Wait a moment and try again.";
  if (status === 404) return "xAI could not find that voice. Refresh the voice list and select a voice again.";
  return `Grok voice failed (HTTP ${status}). Try again later.`;
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { ...init, redirect: "error" });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new Error("Grok voice timed out. Try again.");
    }
    throw new Error("Could not reach Grok voice. Check your connection.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    // Remote error bodies can echo credentials or request text.
    throw new Error(refusal(response.status));
  }
  return response;
}

export async function listVoices(key: string): Promise<Voice[]> {
  const response = await request("/tts/voices", {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  const parsed = voicesSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("Grok returned an invalid voice list. Try again later.");
  return parsed.data.voices.map((voice) => ({
    id: voice.voice_id, label: voice.name, description: voice.description,
  }));
}

/** Voice mode's choices for one utterance (shared/voice-mode.ts): xAI
 * takes `speed` from 0.7 to 1.5 and a BCP-47 `language` or "auto". */
export interface SynthesizeOptions {
  speed?: number;
  language?: string;
}

export async function synthesize(text: string, voiceId: string | undefined, key: string, options: SynthesizeOptions = {}): Promise<Audio> {
  const body: Record<string, unknown> = { text, language: options.language || "auto", output_format: { codec: "mp3" } };
  // no voice: xAI's default voice
  if (voiceId) body.voice_id = voiceId;
  if (typeof options.speed === "number" && options.speed !== 1) body.speed = options.speed;
  const response = await request("/tts", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime !== "audio/mpeg" && mime !== "audio/mp3") {
    await response.body?.cancel();
    throw new Error("Grok returned an unexpected audio format. Try again later.");
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new Error("Grok audio download was interrupted. Try again.");
  }
  if (!bytes.byteLength) throw new Error("Grok returned empty audio. Try again.");
  return { bytes, mime: "audio/mpeg" };
}

/** Speech to text (POST /v1/stt, multipart): one recorded turn. `language`
 * is a hint; without it xAI detects the language. */
export async function transcribe(audio: Uint8Array, mime: string, key: string, language?: string): Promise<{ text: string; language?: string }> {
  const form = new FormData();
  const name = mime === "audio/wav" ? "turn.wav" : mime === "audio/webm" ? "turn.webm" : "turn.ogg";
  form.append("file", new Blob([new Uint8Array(audio)], { type: mime }), name);
  if (language) form.append("language", language);
  const response = await request("/stt", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, accept: "application/json" },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const parsed = sttSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("Grok returned an invalid transcript. Try again later.");
  return { text: parsed.data.text, ...(parsed.data.language ? { language: parsed.data.language } : {}) };
}
