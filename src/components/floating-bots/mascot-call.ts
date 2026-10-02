// A voice call with the desktop mascot, on the brain's side. The call itself
// is the app's (voice mode: src/lib/voice-mode, run once by CallEngineHost for
// the bot on the line, published in live-call-store.ts): the mascot's call
// button starts that same call for its bot, through the same thread, and its
// pill only shows it and drives it. So there is one call at a time across the
// app and every mascot: starting one ends the other (lib/call.ts), and a call
// started in the app shows on that bot's mascot too.
import type { LiveCallData } from "@/lib/voice-mode/live-call-store";
import type { CallSettings } from "@/lib/voice-mode/call-settings";
import type { VoiceModeSettings } from "../../../shared/voice-mode";
import type { FloatingCall, FloatingCallAction, FloatingCallLevels } from "./protocol";

/** What the mascot's settings card shows besides the settings themselves (the brain keeps it). */
export interface MascotCallPanel {
  voices: { id: string; label: string }[] | null;
  voicesError: string | null;
  enrollment: FloatingCall["enrollment"];
  previewing: { id: string; loading: boolean } | null;
}

export const NO_PANEL: MascotCallPanel = { voices: null, voicesError: null, enrollment: { state: "none" }, previewing: null };

/** The call as the mascot's window draws it: plain values only. */
export function mascotCallSnapshot(live: LiveCallData, panel: MascotCallPanel, settings: VoiceModeSettings, callSettings: CallSettings): FloatingCall {
  const { state } = live;
  const line = state.phase === "hearing" || state.phase === "interrupted" ? live.heard : state.phase === "speaking" ? live.caption : "";
  return {
    phase: state.phase,
    muted: state.muted,
    botAudible: state.botAudible,
    push: callSettings.input === "push",
    startedAt: live.startedAt,
    line,
    transcript: live.transcript.map((entry) => ({ id: entry.id, who: entry.who, text: entry.text, ...(entry.interrupted ? { interrupted: true } : {}) })),
    note: live.note,
    notice: live.notice,
    settings,
    callSettings,
    voices: panel.voices,
    voicesError: panel.voicesError,
    enrollment: panel.enrollment.state === "none" && live.call.enrolled ? { state: "enrolled" } : panel.enrollment,
    previewing: panel.previewing,
  };
}

/** How loud an analyser is now, 0..1 (the same scale as the app's waveform). */
export function analyserLevel(analyser: Pick<AnalyserNode, "getByteTimeDomainData"> | null | undefined, data: Uint8Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(data);
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs((data[i] ?? 128) - 128) / 128);
  return Math.min(1, peak * 2.5);
}

/** The levels sent to the window, a little rounded so a quiet line sends nothing new. */
export function callLevels(live: LiveCallData | null, data: Uint8Array<ArrayBuffer>): FloatingCallLevels {
  if (!live || live.state.phase === "held" || live.state.phase === "connecting") return { bot: 0, mic: 0 };
  const round = (value: number) => Math.round(value * 50) / 50;
  return { bot: round(analyserLevel(live.call.analysers.bot, data)), mic: live.state.muted ? 0 : round(analyserLevel(live.call.analysers.mic, data)) };
}

export interface MascotCallDeps {
  /** voice mode serves this bot (the call button shows only then) */
  available: boolean;
  /** the call the app runs now, whoever started it */
  live: LiveCallData | null;
  /** lib/call.ts */
  current(): string | null;
  start(botId: string): void;
  end(botId: string): boolean;
  /** the balloon closes when a call starts: the pill takes over */
  closeBalloon(): void;
  voices(): void;
  preview(voiceId: string): void;
  enroll(): void;
  forget(): void;
  writeSettings(patch: Partial<VoiceModeSettings>): void;
  writeCallSettings(patch: Partial<CallSettings>): void;
}

/**
 * A click on the mascot's call controls. "start" starts the app's call with
 * this bot (ending any other); every other action reaches only a call with
 * this very bot, so a stale window can never drive another bot's call.
 */
export function runMascotCallEvent(botId: string, action: FloatingCallAction, extra: { voice?: string; patch?: Record<string, unknown> }, deps: MascotCallDeps): void {
  if (action === "start") {
    if (!deps.available || deps.current() === botId) return;
    deps.closeBalloon();
    deps.start(botId);
    return;
  }
  if (action === "end") {
    deps.end(botId);
    return;
  }
  const live = deps.live?.botId === botId && deps.current() === botId ? deps.live : null;
  if (!live) return;
  const call = live.call;
  switch (action) {
    case "mute":
    case "unmute":
      call.setMuted(action === "mute");
      break;
    case "hold":
      call.hold();
      break;
    case "resume":
      call.resume();
      break;
    case "interrupt":
      call.interrupt();
      break;
    case "retry":
      live.retry();
      break;
    case "talk":
    case "release":
      call.pushToTalk(action === "talk");
      break;
    case "voices":
      deps.voices();
      break;
    case "preview":
      if (extra.voice !== undefined) deps.preview(extra.voice);
      break;
    case "enroll":
      deps.enroll();
      break;
    case "forget":
      deps.forget();
      break;
    case "settings":
      if (extra.patch) deps.writeSettings(extra.patch as Partial<VoiceModeSettings>);
      break;
    case "call-settings":
      if (extra.patch) deps.writeCallSettings(extra.patch as Partial<CallSettings>);
      break;
    default:
      break;
  }
}
