// Pure rules for full-duplex barge-in (issue #292). The call machine
// runs the effects; this file decides which ones. Flag off keeps today's
// steer-while-thinking path (talking while the bot works silently joins
// that turn). Flag on: barge-in of audible speech cancels that reply.
// Talking while it thinks does not interrupt at speech-start: the send
// decides (server admitDuplexSend). It replaces the thinking turn, stops it,
// or joins it while that turn's own tool runs. It never forks a task.

export type BargeInEffect = "none" | "cancel-and-interrupt" | "cancel-speech-only";

export interface BargeInState {
  duplex: boolean;
  botBusy: boolean;
  botAudible: boolean;
  /** in-flight tools or a sibling topic: barge-in drops speech, not the work */
  backgroundWork?: boolean;
}

/** What speech-start does to the bot's current reply. */
export function bargeInEffects(state: BargeInState): BargeInEffect {
  if (state.duplex && state.backgroundWork) return state.botAudible ? "cancel-speech-only" : "none";
  if (state.botAudible) return state.botBusy ? "cancel-and-interrupt" : "cancel-speech-only";
  // Thinking, not speaking: do not kill the turn before the words are
  // classified. The send forks a new topic, stops, or replaces a correction.
  return "none";
}

/** Soft tone while a slow answer is coming: shorter under duplex so the
 * line is not dead air. */
export function thinkingCueMs(duplex: boolean): number {
  return duplex ? 400 : 1200;
}
