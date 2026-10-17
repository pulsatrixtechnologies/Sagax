// A call marks its turns as call turns (Message.voiceCall), whichever view
// carries it: the live call (LiveCall) and the older macOS dictation call
// (CallView). Two halves, both needed:
//
// - the page: every send to the bot while the call lasts carries the call
//   id (setVoiceCallId, read by the store's send), so the server adds the
//   hidden "Phone call" section and the turn mark (voice output rules);
// - the server: the thread is on a call (POST /voice/call start, a heartbeat,
//   end), so end_call is offered and the engine stays warm between turns.
//
// Ownership-safe: a call's teardown never clears a newer call's id.

import { useEffect, useRef } from "react";

import { clearVoiceCallId, setVoiceCallId } from "@/lib/call";
import { keepCallAlive } from "./call-alive";
import { voiceCallSession } from "./api";
import { readVoiceModeSettings } from "./settings";

export interface VoiceCallMarkDeps {
  setId: (botId: string, callId: string) => void;
  clearId: (botId: string, callId: string) => void;
  session: (botId: string, state: "start" | "alive" | "end", call: { callId: string; threadId?: string; language?: string }) => void;
  keepAlive: (alive: () => void) => () => void;
  language: () => string | undefined;
}

const defaultDeps: VoiceCallMarkDeps = {
  setId: setVoiceCallId,
  clearId: clearVoiceCallId,
  session: (botId, state, call) => void voiceCallSession(botId, state, call),
  keepAlive: (alive) => keepCallAlive(alive),
  language: () => readVoiceModeSettings().language,
};

/** Mark a call on the page and on the server. Returns the teardown. */
export function markVoiceCall(
  call: { botId: string; threadId?: string; callId: string },
  deps: VoiceCallMarkDeps = defaultDeps,
): () => void {
  const { botId, callId, threadId } = call;
  deps.setId(botId, callId);
  const language = deps.language();
  const session = { callId, ...(threadId ? { threadId } : {}), ...(language && language !== "auto" ? { language } : {}) };
  deps.session(botId, "start", session);
  // every 5 minutes, and at once after a sleep or a network change (the
  // server forgets a call after 20 minutes without one)
  const stop = deps.keepAlive(() => deps.session(botId, "alive", session));
  return () => {
    stop();
    deps.session(botId, "end", session);
    deps.clearId(botId, callId);
  };
}

/** This call's id, marked for as long as the component lives on this bot
 * and thread. */
export function useVoiceCallMark(botId: string, threadId: string | undefined): string {
  const callId = useRef(crypto.randomUUID()).current;
  useEffect(() => markVoiceCall({ botId, threadId, callId }), [botId, threadId, callId]);
  return callId;
}
