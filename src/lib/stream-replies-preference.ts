// Settings > Appearance > Conversation > "Show replies as they are written":
// a bot's answer grows in its bubble as the engine streams it (LiveReply),
// the way Claude and ChatGPT show it. On by default; off keeps the reply
// hidden until it is finished, the whole bubble appearing at once. A
// preference of the person, for all their bots: kept like the other
// appearance choices (localStorage, and per person on an organization server
// through shared/user-preferences.ts), changed by a bot through the settings
// tool (shared/settings-actions.ts, appearance.streamReplies), applied live.
// The phone reads the same key (ios PersonPreferences.swift, StreamReplies).
import { localChoice } from "./local-choice";

export const STREAM_REPLIES_KEY = "sagax.streamReplies.v1";
export const STREAM_REPLIES_CHOICES = ["on", "off"] as const;
export type StreamRepliesChoice = (typeof STREAM_REPLIES_CHOICES)[number];

export const streamRepliesChoice = localChoice<StreamRepliesChoice>(STREAM_REPLIES_KEY, STREAM_REPLIES_CHOICES, "on");

/** True when replies show as they are written (the default). */
export function streamRepliesEnabled(): boolean {
  return streamRepliesChoice.get() === "on";
}

export function setStreamReplies(next: boolean): void {
  streamRepliesChoice.set(next ? "on" : "off");
}

/** The choice, followed live (this window, another window, a bot, another device). */
export function useStreamReplies(): boolean {
  return streamRepliesChoice.use() === "on";
}
