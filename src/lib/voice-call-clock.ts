// How long a voice call lasted. The engine notes the live clock; after hang-up
// the same id keeps startedAt and endedAt for the thread card. A reload has
// neither, and the card falls back to the first and last spoken lines.
import { useSyncExternalStore } from "react";

export interface VoiceCallClock {
  botId: string;
  callId: string;
  startedAt: number;
  endedAt: number | null;
}

let active: VoiceCallClock | null = null;
const settled = new Map<string, VoiceCallClock>();
const watchers = new Set<() => void>();

function emit(): void {
  for (const watcher of Array.from(watchers)) watcher();
}

export function noteVoiceCallRunning(clock: { botId: string; callId: string; startedAt: number }): void {
  if (
    active &&
    active.callId === clock.callId &&
    active.botId === clock.botId &&
    active.startedAt === clock.startedAt &&
    active.endedAt === null
  ) return;
  active = { ...clock, endedAt: null };
  emit();
}

export function noteVoiceCallEnded(callId: string, endedAt = Date.now()): void {
  const source = active?.callId === callId ? active : settled.get(callId);
  if (!source) return;
  settled.set(callId, { ...source, endedAt });
  if (active?.callId === callId) active = null;
  emit();
}

export function voiceCallClock(callId: string): VoiceCallClock | null {
  if (active?.callId === callId) return active;
  return settled.get(callId) ?? null;
}

function subscribe(watcher: () => void): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

export function useVoiceCallClock(callId: string): VoiceCallClock | null {
  return useSyncExternalStore(subscribe, () => voiceCallClock(callId), () => voiceCallClock(callId));
}
