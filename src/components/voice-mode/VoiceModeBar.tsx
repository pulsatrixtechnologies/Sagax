// The voice call bar (voice mode): a slim in-call banner docked at the top
// of the chat column, like a phone's: the bot's avatar, name and call timer,
// the call's state, a live waveform of both sides (the bot above the line,
// the person below), then settings, transcript, hold, mute and end. It is
// part of the layout (ChatView's banner stack), so it pushes the thread down
// instead of covering it; on a narrow column the waveform folds away and the
// controls stay reachable.
import { useCallback, useEffect, useRef, useState } from "react";
import { Hand, MessageSquare, Mic, MicOff, Pause, PhoneOff, Play, Settings2 } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { speaker } from "@/lib/tts";
import { fetchVoiceModeVoices, type VoiceOption } from "@/lib/voice-mode/api";
import type { VoiceCall } from "@/lib/voice-mode/call";
import type { CallPhase, CallState } from "@/lib/voice-mode/call-machine";
import { notifyCallSettings, useCallSettings, writeCallSettings } from "@/lib/voice-mode/call-settings";
import { useVoiceModeSettings, writeVoiceModeSettings } from "@/lib/voice-mode/settings";
import { forgetVoiceprint } from "@/lib/voice-mode/speaker-id";
import type { VoiceModeRefusalCause } from "../../../shared/voice-mode";
import { BotAvatar } from "../Avatar";
import { requestSettingsCard } from "../SettingsPrimitives";
import type { CallMetrics } from "./LiveCall";
import { VoiceModeSettingsPanel, type Enrollment, type VoiceModeList } from "./VoiceModeSettingsPanel";

/** The access card of a refused voice turn: shown in the speaker's own bar
 * only (the audience of every access card), never in the thread. */
export interface VoiceAccessCard {
  cause: VoiceModeRefusalCause;
  admin: boolean;
  keysUrl?: string;
}

/** What the card says, to the person it is about. Exported for tests. */
export function voiceAccessCardText(card: VoiceAccessCard): string[] {
  if (card.cause === "payer_disabled") return [t("voiceMode.noAccess.disabled")];
  if (card.cause === "perspicax_unreachable") return [t("voiceMode.noAccess.unreachable")];
  return [t("voiceMode.noAccess.mine"), ...(card.admin ? [t("access.noAccess.mine.admin")] : [])];
}

export interface VoiceModeBarProps {
  bot: Bot;
  call: VoiceCall;
  state: CallState;
  /** the words recognized so far in the person's turn */
  heard: string;
  /** the bot's sentence now audible */
  caption?: string;
  note: string | null;
  /** a passing notice ("another voice was ignored") */
  notice?: string | null;
  /** an access card: no xAI key serves this person */
  refusal: VoiceAccessCard | null;
  transcript: Array<{ id: string; who: "you" | "bot"; text: string; interrupted?: boolean }>;
  metrics?: CallMetrics;
  onRetry(): void;
  onEnd(): void;
}

const BARS = 28;

/** The call's running time, as a phone shows it: m:ss, then h:mm:ss.
 * Exported for tests. */
export function formatCallTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

/** Time since the bar opened (the call's start), ticking once a second. */
function useCallElapsed(): number {
  const [started] = useState(() => Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now - started;
}

/** What the bar says for each state of the call. Exported for tests. */
export function phaseLabel(phase: CallPhase, muted: boolean): string {
  if (phase === "held") return t("voiceMode.phase.held");
  if (muted) return t("voiceMode.muted");
  switch (phase) {
    case "connecting": return t("voiceMode.phase.connecting");
    case "listening": return t("voiceMode.listening");
    case "hearing": return t("voiceMode.phase.hearing");
    case "thinking": return t("voiceMode.phase.thinking");
    case "speaking": return t("voiceMode.phase.speaking");
    case "interrupted": return t("voiceMode.phase.interrupted");
    default: return "";
  }
}

function amplitude(analyser: AnalyserNode | null, data: Uint8Array<ArrayBuffer>, bars: number): number[] {
  if (!analyser) return Array.from({ length: bars }, () => 0);
  analyser.getByteTimeDomainData(data);
  const out: number[] = [];
  const span = Math.floor(data.length / bars);
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    for (let j = i * span; j < (i + 1) * span; j++) peak = Math.max(peak, Math.abs((data[j] ?? 128) - 128) / 128);
    out.push(Math.min(1, peak * 2.5));
  }
  return out;
}

/** Both sides of the call: the bot above the line (accent), the person below. */
function Waveform({ call, state }: { call: VoiceCall; state: CallState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const quiet = state.phase === "held" || state.phase === "connecting";
  const muted = state.muted;
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    let frame = 0;
    const data = new Uint8Array(1024);
    const draw = (time: number) => {
      const { width, height } = element;
      const style = getComputedStyle(element);
      context.clearRect(0, 0, width, height);
      const { mic, bot } = call.analysers;
      const theirs = quiet ? [] : amplitude(bot, data, BARS);
      const mine = quiet || muted ? [] : amplitude(mic, data, BARS);
      const step = width / BARS;
      const middle = height / 2;
      for (let i = 0; i < BARS; i++) {
        const idle = 0.04 + (quiet ? 0 : 0.03 * Math.abs(Math.sin(time / 700 + i * 0.5)));
        const up = Math.max(idle, theirs[i] ?? 0) * middle;
        const down = Math.max(idle, mine[i] ?? 0) * middle;
        const x = i * step + step * 0.2;
        context.globalAlpha = 0.9;
        context.fillStyle = style.getPropertyValue("--color-accent") || style.color;
        context.fillRect(x, middle - up, step * 0.6, Math.max(1, up));
        context.fillStyle = style.color;
        context.globalAlpha = muted ? 0.25 : 0.7;
        context.fillRect(x, middle, step * 0.6, Math.max(1, down));
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [call, quiet, muted]);
  return <canvas ref={canvas} width={220} height={36} className="h-9 w-full min-w-0 flex-1 text-ink" aria-hidden="true" />;
}

export function VoiceModeBar(props: VoiceModeBarProps) {
  const { bot, call, state, heard, caption, note, notice, refusal, transcript, metrics, onRetry, onEnd } = props;
  const { dispatch } = useStore();
  const settings = useVoiceModeSettings();
  const callSettings = useCallSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [list, setList] = useState<VoiceModeList | null>(null);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<{ id: string; loading: boolean } | null>(null);
  const elapsed = useCallElapsed();
  const [enrollment, setEnrollment] = useState<Enrollment>(call.enrolled ? { state: "enrolled" } : { state: "none" });

  useEffect(() => {
    if (!settingsOpen || voices !== null) return;
    const controller = new AbortController();
    fetchVoiceModeVoices(bot.id, controller.signal).then(
      (list) => setVoices(list),
      (error: unknown) => {
        if (!controller.signal.aborted) setVoicesError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => controller.abort();
  }, [bot.id, settingsOpen, voices]);

  const preview = useCallback(
    (voiceId: string) => {
      if (previewing?.id === voiceId) {
        speaker.stop();
        setPreviewing(null);
        return;
      }
      call.interrupt();
      setPreviewing({ id: voiceId, loading: true });
      const label = voices?.find((voice) => voice.id === voiceId)?.label ?? voiceId;
      const unsubscribe = speaker.subscribe((snapshot) => {
        if (snapshot.status === "speaking") setPreviewing((current) => (current?.id === voiceId ? { id: voiceId, loading: false } : current));
      });
      void speaker
        .speak(t("voiceMode.previewLine", { voice: label }), { botId: bot.id, voiceMode: { settings: { ...settings, voice: voiceId } } })
        .finally(() => {
          unsubscribe();
          setPreviewing((current) => (current?.id === voiceId ? null : current));
        });
    },
    [bot.id, call, previewing, settings, voices],
  );

  const enroll = useCallback(() => {
    setEnrollment({ state: "recording", share: 0 });
    void call.enroll((share) => setEnrollment({ state: "recording", share })).then((ok) => {
      setEnrollment(ok ? { state: "enrolled" } : { state: "failed" });
      if (ok) writeCallSettings({ onlyMyVoice: true });
      notifyCallSettings();
    });
  }, [call]);

  const forget = useCallback(() => {
    forgetVoiceprint();
    call.forgetVoice();
    setEnrollment({ state: "none" });
    notifyCallSettings();
  }, [call]);

  const muted = state.muted;
  const held = state.phase === "held";
  const status = phaseLabel(state.phase, muted);
  const line = state.phase === "hearing" || state.phase === "interrupted" ? heard : state.phase === "speaking" ? caption : "";
  const push = callSettings.input === "push";

  return (
    <section
      className="@container/callbar mx-3 mb-2 overflow-hidden rounded-2xl border border-hairline/50 bg-panel shadow-sm md:mx-5"
      aria-label={t("voiceMode.callWith", { name: bot.name })}
      data-voice-bar
      data-voice-phase={state.phase}
      data-voice-first-audio-ms={metrics?.firstAudioMs}
      data-voice-sent-ms={metrics?.sentMs}
      data-voice-duck-ms={metrics?.duckMs}
      data-voice-bargein-ms={metrics?.bargeInMs}
      data-voice-endpoint-ms={call.endpointMs}
      data-voice-models={call.modelsReady ? "on-device" : "level"}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1.5" data-voice-callbar-row>
        <button
          type="button"
          onClick={state.botAudible ? () => call.interrupt() : undefined}
          className="shrink-0 rounded-full"
          aria-label={state.botAudible ? t("voiceMode.interrupt") : bot.name}
        >
          <BotAvatar
            bot={bot}
            size={32}
            state={state.phase === "listening" || state.phase === "hearing" ? "listening" : state.phase === "speaking" ? "sending" : state.phase === "thinking" || state.phase === "interrupted" ? "thinking" : "working"}
          />
        </button>
        <div className="flex min-w-[7rem] flex-1 basis-0 flex-col leading-tight" data-voice-callbar-info>
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[13px] font-medium text-ink">{bot.name}</span>
            <span className="shrink-0 text-[11.5px] tabular-nums text-ink-tertiary" data-voice-timer>{formatCallTime(elapsed)}</span>
          </div>
          <div className="truncate text-[11.5px] text-ink-tertiary" aria-live="polite" data-voice-status>
            {line ? <span className="text-ink-secondary">{line}</span> : status}
          </div>
        </div>
        <div className="hidden min-w-0 max-w-[260px] flex-1 @[34rem]/callbar:flex" data-voice-waveform>
          <Waveform call={call} state={state} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-0.5 @[28rem]/callbar:gap-1" data-voice-controls>
          {push && (
            <button
              type="button"
              aria-label={t("voiceMode.pushToTalk")}
              title={t("voiceMode.pushHint")}
              data-voice-ptt
              disabled={muted || held}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                call.pushToTalk(true);
              }}
              onPointerUp={() => call.pushToTalk(false)}
              onPointerCancel={() => call.pushToTalk(false)}
              className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-40", state.phase === "hearing" && "bg-accent text-accent-ink")}
            >
              <Hand size={17} />
            </button>
          )}
          <button
            type="button"
            aria-label={t("voiceMode.settings")}
            aria-expanded={settingsOpen}
            data-voice-gear
            onClick={() => {
              setSettingsOpen((open) => !open);
              setList(null);
            }}
            className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink", settingsOpen && "bg-raised text-ink")}
          >
            <Settings2 size={17} />
          </button>
          <button
            type="button"
            aria-label={t("voiceMode.transcript")}
            aria-expanded={transcriptOpen}
            onClick={() => setTranscriptOpen((open) => !open)}
            className={cn("flex size-9 shrink-0 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink", transcriptOpen && "bg-raised text-ink")}
          >
            <MessageSquare size={17} />
          </button>
          <button
            type="button"
            aria-label={held ? t("voiceMode.resume") : t("voiceMode.hold")}
            aria-pressed={held}
            data-voice-hold
            onClick={() => (held ? call.resume() : call.hold())}
            className={cn("flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-raised", held ? "bg-raised text-warning" : "text-ink-secondary hover:text-ink")}
          >
            {held ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            type="button"
            aria-label={muted ? t("voiceMode.unmute") : t("voiceMode.mute")}
            aria-pressed={muted}
            data-voice-mute
            onClick={() => call.setMuted(!muted)}
            className={cn("flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-raised", muted ? "bg-raised text-danger" : "text-ink-secondary hover:text-ink")}
          >
            {muted ? <MicOff size={17} /> : <Mic size={17} />}
          </button>
          <button
            type="button"
            aria-label={t("voiceMode.end")}
            data-voice-end
            onClick={onEnd}
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger text-white hover:brightness-110"
          >
            <PhoneOff size={16} />
          </button>
        </div>
      </div>
      {(settingsOpen || transcriptOpen || refusal || note || notice) && (
        <div className="max-h-[45vh] overflow-y-auto px-2 pb-2" data-voice-callbar-panels>
          {settingsOpen && (
            <VoiceModeSettingsPanel
              settings={settings}
              voices={voices}
              voicesError={voicesError}
              open={list}
              previewing={previewing}
              onOpen={setList}
              onChange={(patch) => writeVoiceModeSettings(patch)}
              onPreview={preview}
              call={callSettings}
              enrollment={enrollment}
              onCallChange={(patch) => writeCallSettings(patch)}
              onEnroll={enroll}
              onForget={forget}
            />
          )}
          {transcriptOpen && (
            <div className="mb-2 max-h-48 overflow-y-auto rounded-xl bg-raised/50 px-3 py-2 text-[13px] leading-relaxed" aria-label={t("voiceMode.transcript")}>
              {transcript.length === 0 ? (
                <div className="text-ink-tertiary">{t("voiceMode.transcriptEmpty")}</div>
              ) : (
                transcript.map((entry) => (
                  <div key={entry.id} className={cn("py-0.5", entry.who === "you" ? "text-ink-secondary" : "text-ink")} data-voice-interrupted={entry.interrupted ? "" : undefined}>
                    <span className="mr-1.5 font-medium">{entry.who === "you" ? t("voiceMode.you") : bot.name}</span>
                    {entry.text}
                    {entry.interrupted && <span className="ml-1.5 rounded bg-raised px-1 text-[11px] text-ink-tertiary">{t("voiceMode.interruptedMark")}</span>}
                  </div>
                ))
              )}
            </div>
          )}
          {refusal && (
            <div role="alert" className="mb-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-ink" data-voice-access-card>
              {voiceAccessCardText(refusal).map((line, index) => (
                <div key={index} className={index === 0 ? "font-medium" : "mt-0.5 text-ink-secondary"}>{line}</div>
              ))}
              {refusal.admin && refusal.cause === "no_credentials" && (
                <button
                  type="button"
                  data-voice-action="open-connections"
                  onClick={() => {
                    requestSettingsCard("connections.providers");
                    dispatch({ type: "toggleAppSettings", open: true, section: "connections" });
                  }}
                  className="mr-1.5 mt-1.5 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:brightness-110"
                >
                  {t("voiceMode.openConnections")}
                </button>
              )}
              {refusal.keysUrl && refusal.cause === "no_credentials" && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.ogb?.openExternal) void window.ogb.openExternal(refusal.keysUrl!);
                    else window.open(refusal.keysUrl, "_blank", "noopener");
                  }}
                  className="mt-1.5 rounded-lg bg-accent px-2.5 py-1 text-[12px] font-medium text-accent-ink hover:brightness-110"
                >
                  {t("voiceMode.addOwnKey")}
                </button>
              )}
            </div>
          )}
          {(note || notice) && !refusal && (
            <div className={cn("mb-2 flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-[12.5px]", note ? "bg-warning/10 text-warning" : "bg-raised/60 text-ink-secondary")} role={note ? "alert" : "status"}>
              <span>{note ?? notice}</span>
              {note && (
                <button type="button" onClick={onRetry} className="shrink-0 rounded-full border border-warning/40 px-2.5 py-0.5 text-[12px] hover:bg-warning/10">
                  {t("voiceMode.retry")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
