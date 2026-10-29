// Voice timings for the thread's Events lens (runtime.notice): where the
// seconds between the end of a person's speech and the bot's answer went.
// Numbers only, never the words, never a key.
//
//   speech to text (upload): the whole recording sent once it stopped
//   speech to text (stream): xAI's final words after the page's finalize
//   call turn: the page's stages (end of speech, words ready, sent) beside
//   the server's (received, dispatched, engine, first text)

/** Client stages of one call turn, as the page measured them (ms). */
export interface VoiceClientTiming {
  /** end of speech -> the turn detector ended the turn */
  endpointMs?: number;
  /** -> the words were ready */
  sttMs?: number;
  /** -> sent to the bot */
  dispatchMs?: number;
}

const MAX_STAGE_MS = 10 * 60_000;

/** The page's timing on a send (voiceCall.timing), kept only when every
 * field is a sane number of milliseconds. */
export function parseVoiceClientTiming(value: unknown): VoiceClientTiming | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const out: VoiceClientTiming = {};
  for (const key of ["endpointMs", "sttMs", "dispatchMs"] as const) {
    const ms = record[key];
    if (typeof ms === "number" && Number.isFinite(ms) && ms >= 0 && ms <= MAX_STAGE_MS) out[key] = Math.round(ms);
  }
  return Object.keys(out).length ? out : undefined;
}

function seconds(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** 16 kHz 16-bit mono WAV: its length in seconds (other formats: unknown). */
function wavSeconds(bytes: number, mime: string): number | undefined {
  if (mime !== "audio/wav" || bytes <= 44) return undefined;
  return (bytes - 44) / (16_000 * 2);
}

export function uploadedTranscriptNotice(input: { bytes: number; mime: string; ms: number }): string {
  const audio = wavSeconds(input.bytes, input.mime);
  const length = audio !== undefined ? `${audio.toFixed(1)} s of audio` : `${Math.round(input.bytes / 1024)} KB of audio`;
  return `Voice: speech to text (whole recording) took ${seconds(input.ms)} for ${length}`;
}

export function streamedTranscriptNotice(ms: number): string {
  return `Voice: speech to text (streaming) gave the final words ${seconds(ms)} after the end of speech`;
}

/** One call turn, page and server side by side. */
export function callTurnNotice(input: {
  client?: VoiceClientTiming;
  dispatchMs?: number;
  engineMs?: number;
  warm?: boolean;
  firstTokenMs?: number;
}): string {
  const parts: string[] = [];
  const { client } = input;
  if (client?.endpointMs !== undefined) parts.push(`end of speech ${seconds(client.endpointMs)}`);
  if (client?.sttMs !== undefined) parts.push(`speech to text ${seconds(client.sttMs)}`);
  if (client?.dispatchMs !== undefined) parts.push(`send ${seconds(client.dispatchMs)}`);
  if (input.dispatchMs !== undefined) parts.push(`turn setup ${seconds(input.dispatchMs)}`);
  if (input.engineMs !== undefined) parts.push(`engine ${seconds(input.engineMs)}${input.warm === undefined ? "" : input.warm ? " (warm)" : " (cold start)"}`);
  if (input.firstTokenMs !== undefined) parts.push(`first words ${seconds(input.firstTokenMs)}`);
  const total = [client?.endpointMs, client?.sttMs, client?.dispatchMs, input.dispatchMs, input.engineMs, input.firstTokenMs]
    .reduce<number>((sum, ms) => sum + (ms ?? 0), 0);
  return `Voice turn: ${parts.join(", ")}; ${seconds(total)} from the end of speech to the first words`;
}
