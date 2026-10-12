// A short first sentence the server spoke ahead of the bot's own reply
// (`voice.opener`). It counts only for the utterance that is still waiting,
// and only before that reply has started. A changed partial gets a new
// utterance id, so the old clip is dropped.

export const VOICE_OPENER_EVENT = "sagax-voice-opener";

export interface VoiceOpenerFrame {
  threadId: string;
  callId: string;
  utteranceId: string;
  text: string;
}

export interface VoiceOpenerOwner {
  threadId: string;
  callId: string;
  utteranceId: string;
  replyStarted: boolean;
}

export function acceptVoiceOpener(
  owner: VoiceOpenerOwner | null,
  frame: Partial<VoiceOpenerFrame> | null | undefined,
): string | null {
  if (!owner || owner.replyStarted || !frame) return null;
  if (frame.threadId !== owner.threadId || frame.callId !== owner.callId || frame.utteranceId !== owner.utteranceId) return null;
  const text = typeof frame.text === "string" ? frame.text.replace(/\s+/g, " ").trim() : "";
  return text || null;
}
