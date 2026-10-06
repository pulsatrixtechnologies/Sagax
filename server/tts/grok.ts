// xAI TTS runs on the harness with the Grok voice key, not the bot xAI key.
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

/** The sample rate of the raw PCM voice mode's live calls play
 * (16-bit little-endian mono). */
export const VOICE_STREAM_RATE = 24_000;

/** Text to speech as it is generated: POST /v1/tts with a raw PCM
 * `output_format` answers the audio bytes as xAI produces them, so the first
 * chunk plays before the sentence is fully synthesized
 * (https://docs.x.ai/developers/model-capabilities/audio/text-to-speech).
 * The connection to api.x.ai is pooled by fetch (keep-alive), so the next
 * sentence of the same answer reuses a warm connection. */
export async function synthesizeStream(
  text: string,
  voiceId: string | undefined,
  key: string,
  options: SynthesizeOptions = {},
  signal?: AbortSignal,
): Promise<{ body: ReadableStream<Uint8Array>; sampleRate: number }> {
  const body: Record<string, unknown> = {
    text,
    language: options.language || "auto",
    output_format: { codec: "pcm", sample_rate: VOICE_STREAM_RATE },
  };
  if (voiceId) body.voice_id = voiceId;
  if (typeof options.speed === "number" && options.speed !== 1) body.speed = options.speed;
  const timeout = AbortSignal.timeout(60_000);
  const response = await request("/tts", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/octet-stream" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  const mime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (mime === "application/json" || mime.startsWith("text/") || !response.body) {
    await response.body?.cancel();
    throw new Error("Grok returned an unexpected audio format. Try again later.");
  }
  return { body: response.body, sampleRate: VOICE_STREAM_RATE };
}

/** One event of xAI's streaming speech to text (wss://api.x.ai/v1/stt). */
export interface TranscriptEvent {
  text: string;
  /** a chunk xAI will not revise */
  final: boolean;
  /** the speaker stopped (endpointing or Smart Turn) */
  speechFinal: boolean;
  /** xAI's confidence in a chunk (0..1), when it reports one: the frame's
   * own, else the lowest of its words' */
  confidence?: number;
}

function transcriptConfidence(frame: Record<string, unknown>): number | undefined {
  const own = frame.confidence;
  if (typeof own === "number" && Number.isFinite(own)) return Math.min(1, Math.max(0, own));
  if (!Array.isArray(frame.words)) return undefined;
  const scores = frame.words
    .map((word) => (word && typeof word === "object" ? (word as Record<string, unknown>).confidence : undefined))
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  return scores.length ? Math.min(1, Math.max(0, Math.min(...scores))) : undefined;
}

export interface TranscriptionStream {
  /** resolves once xAI says `transcript.created` (ready for audio) */
  ready: Promise<void>;
  /** 16-bit little-endian PCM at 16 kHz, mono */
  send(pcm: Uint8Array): void;
  /** end the current utterance now (`{"type":"finalize"}`) */
  finalize(): void;
  close(): void;
}

export interface TranscriptionHandlers {
  onTranscript(event: TranscriptEvent): void;
  onError(message: string): void;
  onClose(): void;
}

/** A WebSocket constructor that can send an Authorization header (Node's
 * global WebSocket, undici, takes `{ headers }`). Injected in tests. */
export type HeaderWebSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket;

/** Streaming speech to text for a live call: one connection per call,
 * audio frames in, partial and final transcripts out. The session goes on
 * after a finalize, so every turn of the call reuses it.
 * https://docs.x.ai/developers/model-capabilities/audio/speech-to-text */
export function openTranscriptionStream(
  key: string,
  options: { language?: string; endpointingMs?: number },
  handlers: TranscriptionHandlers,
  Socket: HeaderWebSocket = WebSocket as unknown as HeaderWebSocket,
): TranscriptionStream {
  const query = new URLSearchParams({
    model: "grok-voice-transcribe-2.0",
    encoding: "pcm",
    sample_rate: "16000",
    interim_results: "true",
    endpointing: String(Math.max(0, Math.min(5000, Math.round(options.endpointingMs ?? 700)))),
  });
  if (options.language) query.set("language", options.language);
  const url = `${API.replace(/^http/, "ws")}/stt?${query}`;
  let socket: WebSocket;
  let closed = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  ready.catch(() => {});
  const fail = (message: string) => {
    if (closed) return;
    closed = true;
    rejectReady(new Error(message));
    handlers.onError(message);
    try { socket?.close(); } catch { /* already closed */ }
    handlers.onClose();
  };
  try {
    socket = new Socket(url, { headers: { authorization: `Bearer ${key}` } });
  } catch {
    queueMicrotask(() => fail("Could not reach Grok voice. Check your connection."));
    return { ready, send() {}, finalize() {}, close() {} };
  }
  socket.binaryType = "arraybuffer";
  socket.addEventListener("message", (event: MessageEvent) => {
    if (typeof event.data !== "string") return;
    let frame: Record<string, unknown>;
    try { frame = JSON.parse(event.data) as Record<string, unknown>; } catch { return; }
    if (frame.type === "transcript.created") resolveReady();
    else if (frame.type === "transcript.partial" || frame.type === "transcript.done") {
      const confidence = transcriptConfidence(frame);
      handlers.onTranscript({
        text: typeof frame.text === "string" ? frame.text : "",
        final: frame.type === "transcript.done" || frame.is_final === true,
        speechFinal: frame.type === "transcript.done" || frame.speech_final === true,
        ...(confidence !== undefined ? { confidence } : {}),
      });
    } else if (frame.type === "error") {
      // xAI's message may echo request details; never pass it on verbatim
      fail("Grok speech to text reported an error. Try again.");
    }
  });
  socket.addEventListener("error", () => fail("Could not reach Grok voice. Check your connection."));
  socket.addEventListener("close", () => {
    if (closed) return;
    closed = true;
    rejectReady(new Error("closed"));
    handlers.onClose();
  });
  return {
    ready,
    send(pcm) {
      if (!closed && socket.readyState === 1) socket.send(pcm);
    },
    finalize() {
      if (!closed && socket.readyState === 1) socket.send(JSON.stringify({ type: "finalize" }));
    },
    close() {
      if (closed) return;
      closed = true;
      try {
        if (socket.readyState === 1) socket.send(JSON.stringify({ type: "audio.done" }));
        socket.close();
      } catch { /* already closed */ }
      handlers.onClose();
    },
  };
}
