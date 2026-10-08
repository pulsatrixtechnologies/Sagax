// Which conversation is on a call, window-wide.
//
// It lives in lib rather than inside the call UI because two very
// different places need it: the overlay that renders the call, and the SSE
// fold that decides whether a settled reply should be read aloud. Call
// mode does its own speaking, in order, around its own microphone — so
// auto-speak has to stand down for the bot that is on the line, and the
// two would deadlock over the speaker otherwise.
import { useSyncExternalStore } from "react";

import { speaker } from "./tts";

let current: string | null = null;
const watchers = new Set<() => void>();

function notify() {
  for (const fn of Array.from(watchers)) fn();
}

/** The bot or room on a call, or null. Safe to read outside React. */
export function currentCall(): string | null {
  return current;
}

export function startCall(targetId: string) {
  if (current === targetId) return;
  // Switching calls must silence both halves before ownership changes; the
  // old overlay may not unmount until React's next render. A server's page
  // in the desktop app (My Cloud) has no speech bridge (electron/preload.cjs
  // REMOTE_SAFE): nothing listens there, and its Live call goes on.
  speaker.stop();
  void window.ogb?.speechStop?.();
  current = targetId;
  notify();
}

/** End the current call. A targetId makes cleanup ownership-safe: an async
 * teardown from call A cannot hang up a newer call B. */
export function endCall(targetId?: string): boolean {
  if (targetId && current !== targetId) return false;
  if (current === null) return false;
  current = null;
  speaker.stop();
  void window.ogb?.speechStop?.();
  notify();
  return true;
}

/** React StrictMode probes effects with setup -> cleanup -> setup in
 * development. Defer ownership cleanup so that probe can remount first;
 * a genuine unmount remains inactive and releases the call. */
export function deferCallCleanup(targetId: string, isMounted: () => boolean): void {
  queueMicrotask(() => {
    if (!isMounted()) endCall(targetId);
  });
}

/** The voice mode call id of the bot on a live call (LiveCall), so every
 * send to it while the call lasts is marked as a call turn. */
const voiceCalls = new Map<string, string>();

export function setVoiceCallId(targetId: string, callId: string): void {
  voiceCalls.set(targetId, callId);
}

/** Ownership-safe: a call's teardown never clears a newer call's id. */
export function clearVoiceCallId(targetId: string, callId: string): void {
  if (voiceCalls.get(targetId) === callId) voiceCalls.delete(targetId);
}

export function voiceCallId(targetId: string): string | null {
  return current === targetId ? voiceCalls.get(targetId) ?? null : null;
}

export function useOnCall(): string | null {
  return useSyncExternalStore(
    (fn) => {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    () => current,
    () => current,
  );
}
