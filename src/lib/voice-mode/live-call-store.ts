// The live voice call, window-wide: one engine runs it (LiveCallEngine, mounted
// once by CallEngineHost for the bot on a call), and every surface that shows
// it reads it here: the app's pill (VoiceCallDock) and the desktop mascot's
// (the floating bots' brain sends it to the mascot's window). So a call
// started from the mascot and one started in the app are the same call, and
// there is never a second microphone or a second voice.
import { useSyncExternalStore } from "react";

import type { VoiceCall } from "./call";
import type { CallState } from "./call-machine";

export interface LiveCallTranscriptLine {
  id: string;
  who: "you" | "bot";
  text: string;
  interrupted?: boolean;
  /** the words of a cut answer the person never heard */
  unheard?: string;
}

export interface LiveCallMetrics {
  firstAudioMs?: number;
  sentMs?: number;
  duckMs?: number;
  bargeInMs?: number;
}

export interface LiveCallData {
  botId: string;
  call: VoiceCall;
  state: CallState;
  /** when the call started (Date.now()) */
  startedAt: number;
  heard: string;
  caption: string;
  note: string | null;
  notice: string | null;
  transcript: LiveCallTranscriptLine[];
  metrics: LiveCallMetrics;
  retry(): void;
}

let current: LiveCallData | null = null;
const watchers = new Set<() => void>();

/** The engine publishes what it has; null once its call is over. */
export function publishLiveCall(data: LiveCallData | null): void {
  if (data === current) return;
  current = data;
  for (const watcher of Array.from(watchers)) watcher();
}

/** Ownership-safe: an engine going away never clears a newer engine's call. */
export function retractLiveCall(call: VoiceCall): void {
  if (current?.call === call) publishLiveCall(null);
}

export function liveCallNow(): LiveCallData | null {
  return current;
}

export function subscribeLiveCall(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

export function useLiveCall(): LiveCallData | null {
  return useSyncExternalStore(subscribeLiveCall, liveCallNow, liveCallNow);
}
