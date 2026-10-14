// When a live call should leave the ear after the server says it ended.
//
// The person hanging up on this device is immediate (the button). A frame
// (`voice.call.ended`) is the other devices, and the bot hanging up: mute
// at once, let a goodbye that is already spoken finish, then hang up.
// Pure, so the wait is a test and not a timer.

export const VOICE_CALL_ENDED_EVENT = "sagax-voice-call-ended";

export interface VoiceCallEndedDetail {
  threadId: string;
  callId: string;
  by: "person" | "bot";
}

/** Quiet, with no goodbye started yet: wait this long for it to be enqueued. */
export const BOT_HANGUP_SETTLE_MS = 2_500;
/** A goodbye that never goes quiet still ends the call. */
export const BOT_HANGUP_CAP_MS = 20_000;

export function decideBotHangup(input: {
  speaking: boolean;
  /** Latched: true once any speech was audible or queued during the wait. */
  heardSpeech: boolean;
  elapsedMs: number;
}): "wait" | "hangup" {
  if (input.elapsedMs >= BOT_HANGUP_CAP_MS) return "hangup";
  if (input.speaking) return "wait";
  if (input.heardSpeech) return "hangup";
  if (input.elapsedMs < BOT_HANGUP_SETTLE_MS) return "wait";
  return "hangup";
}
