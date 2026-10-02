// The live call's states, as on a phone: connecting, listening, the person
// talking (hearing), the bot thinking, the bot speaking, interrupted, on
// hold. Pure: `step(state, event)` returns the next state and the effects
// to run (call.ts runs them), so the unit tests cover every transition,
// barge-in and cancellation included.

export type CallPhase = "connecting" | "listening" | "hearing" | "thinking" | "speaking" | "interrupted" | "held" | "ended";

export interface CallState {
  phase: CallPhase;
  muted: boolean;
  /** the bot's turn is still running on the server */
  botBusy: boolean;
  /** the bot's voice is queued or audible */
  botAudible: boolean;
  /** the person is talking over the bot and the bot is ducked */
  ducked: boolean;
}

export type CallEvent =
  | { type: "connected" }
  | { type: "failed" }
  /** voiced frames began (turns.ts candidate) */
  | { type: "speech-candidate" }
  /** it is speech (turns.ts start) */
  | { type: "speech-start" }
  /** the candidate was a noise */
  | { type: "speech-cancel" }
  /** the person stopped (turns.ts end): transcribing */
  | { type: "speech-end" }
  /** the utterance's words, accepted (speaker verified when on) */
  | { type: "utterance"; text: string }
  /** nothing usable: empty, or another voice ("Only my voice") */
  | { type: "utterance-rejected"; reason: "empty" | "other-voice" | "failed" }
  | { type: "bot-busy"; busy: boolean }
  | { type: "bot-audio-start" }
  /** every queued sentence has been heard */
  | { type: "bot-audio-end" }
  | { type: "mute"; muted: boolean }
  | { type: "hold" }
  | { type: "resume" }
  /** the person pressed interrupt (or Space) */
  | { type: "interrupt" }
  | { type: "end" };

export type CallEffect =
  | { type: "duck" }
  | { type: "unduck" }
  /** fade the bot's voice out and drop every queued sentence */
  | { type: "cancel-speech" }
  /** stop the bot's running turn on the server */
  | { type: "interrupt-bot" }
  | { type: "send"; text: string }
  | { type: "finalize-stt" }
  | { type: "cancel-stt" }
  | { type: "earcon"; sound: "connected" | "interrupted" | "rejected" | "hold" | "resume" | "ended" }
  | { type: "mic"; open: boolean }
  | { type: "release" };

export const INITIAL_CALL: CallState = { phase: "connecting", muted: false, botBusy: false, botAudible: false, ducked: false };

/** The phase to rest in when nobody is talking. */
function idle(state: CallState): CallPhase {
  if (state.botAudible) return "speaking";
  if (state.botBusy) return "thinking";
  return "listening";
}

export function step(state: CallState, event: CallEvent): { state: CallState; effects: CallEffect[] } {
  const effects: CallEffect[] = [];
  const next = (patch: Partial<CallState>) => ({ state: { ...state, ...patch }, effects });
  if (state.phase === "ended") return { state, effects };

  switch (event.type) {
    case "connected":
      if (state.phase !== "connecting") return { state, effects };
      effects.push({ type: "earcon", sound: "connected" });
      return next({ phase: idle(state) });
    case "failed":
      return next({ phase: "listening" });
    case "end":
      effects.push({ type: "cancel-speech" }, { type: "cancel-stt" }, { type: "earcon", sound: "ended" }, { type: "release" });
      return next({ phase: "ended", botAudible: false, ducked: false });
    case "hold":
      if (state.phase === "held") return { state, effects };
      // a hold is silence both ways: nothing heard, nothing said
      effects.push({ type: "cancel-speech" }, { type: "cancel-stt" }, { type: "mic", open: false }, { type: "earcon", sound: "hold" });
      return next({ phase: "held", botAudible: false, ducked: false });
    case "resume":
      if (state.phase !== "held") return { state, effects };
      effects.push({ type: "earcon", sound: "resume" });
      if (!state.muted) effects.push({ type: "mic", open: true });
      return next({ phase: idle({ ...state, botAudible: false }) });
    case "mute": {
      if (state.muted === event.muted) return { state, effects };
      if (state.phase === "held") return next({ muted: event.muted });
      if (event.muted) {
        effects.push({ type: "cancel-stt" }, { type: "mic", open: false });
        if (state.ducked) effects.push({ type: "unduck" });
        return next({ muted: true, ducked: false, phase: state.phase === "hearing" ? idle(state) : state.phase });
      }
      effects.push({ type: "mic", open: true });
      return next({ muted: false });
    }
    case "speech-candidate":
      if (state.muted || state.phase === "held" || state.phase === "connecting") return { state, effects };
      // the person may be talking over the bot: lower it at once
      if (state.botAudible && !state.ducked) {
        effects.push({ type: "duck" });
        return next({ ducked: true });
      }
      return { state, effects };
    case "speech-cancel":
      if (state.ducked) effects.push({ type: "unduck" });
      effects.push({ type: "cancel-stt" });
      return next({ ducked: false, phase: state.phase === "hearing" || state.phase === "interrupted" ? idle(state) : state.phase });
    case "speech-start":
      if (state.muted || state.phase === "held" || state.phase === "connecting") return { state, effects };
      if (state.botAudible) {
        // barge-in: the bot stops talking, what it had left to say is dropped
        effects.push({ type: "cancel-speech" }, { type: "earcon", sound: "interrupted" });
        if (state.botBusy) effects.push({ type: "interrupt-bot" });
        return next({ phase: "interrupted", botAudible: false, ducked: false });
      }
      if (state.botBusy) {
        // talking while the bot works: the new words replace its running turn
        effects.push({ type: "interrupt-bot" });
        return next({ phase: "interrupted" });
      }
      return next({ phase: "hearing" });
    case "speech-end":
      if (state.phase !== "hearing" && state.phase !== "interrupted") return { state, effects };
      effects.push({ type: "finalize-stt" });
      return next({ phase: "thinking" });
    case "utterance": {
      const text = event.text.trim();
      if (!text) return step(state, { type: "utterance-rejected", reason: "empty" });
      effects.push({ type: "send", text });
      return next({ phase: "thinking", botBusy: true });
    }
    case "utterance-rejected":
      if (event.reason === "other-voice") effects.push({ type: "earcon", sound: "rejected" });
      if (state.ducked) effects.push({ type: "unduck" });
      return next({ ducked: false, phase: state.phase === "held" ? "held" : idle(state) });
    case "bot-busy": {
      const patched = { ...state, botBusy: event.busy };
      if (state.phase === "thinking" || state.phase === "listening" || state.phase === "speaking") return next({ botBusy: event.busy, phase: idle(patched) });
      return next({ botBusy: event.busy });
    }
    case "bot-audio-start":
      if (state.phase === "held") return { state, effects };
      if (state.phase === "hearing" || state.phase === "interrupted") return next({ botAudible: true });
      return next({ botAudible: true, phase: "speaking" });
    case "bot-audio-end": {
      const patched = { ...state, botAudible: false, ducked: false };
      if (state.phase === "speaking") return next({ botAudible: false, ducked: false, phase: idle(patched) });
      return next({ botAudible: false, ducked: false });
    }
    case "interrupt":
      if (!state.botAudible) return { state, effects };
      effects.push({ type: "cancel-speech" });
      return next({ botAudible: false, ducked: false, phase: state.botBusy ? "thinking" : "listening" });
  }
}
