// The voice call stage: a full column while the call is up (avatar, name,
// running time, Voice / Speed / Language, then Mic, Settings and End).
// The chevron folds it back to a short row in the banner stack so the
// conversation is visible. The gear opens the rest of the call settings
// (microphone, end of turn, only my voice, hold) under the three rows.
// Escape closes an open list, then those extra settings, then the call.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Hand, Mic, MicOff, Pause, Play, Settings, X } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { speaker } from "@/lib/tts";
import { fetchVoiceModeVoices, type VoiceOption } from "@/lib/voice-mode/api";
import type { VoiceCall } from "@/lib/voice-mode/call";
import type { CallState } from "@/lib/voice-mode/call-machine";
import { notifyCallSettings, useCallSettings, writeCallSettings } from "@/lib/voice-mode/call-settings";
import { useVoiceModeSettings, writeVoiceModeSettings } from "@/lib/voice-mode/settings";
import { forgetVoiceprint } from "@/lib/voice-mode/speaker-id";
import type { VoiceModeRefusalCause } from "../../../shared/voice-mode";
import { BotAvatar } from "../Avatar";
import { requestSettingsCard } from "../SettingsPrimitives";
import type { CallMetrics } from "./LiveCall";
import { formatCallTime, phaseLabel } from "@/lib/voice-mode/call-labels";

export { formatCallTime, phaseLabel };
import { VoiceModeSettingsPanel, type Enrollment, type VoiceModeList } from "./VoiceModeSettingsPanel";

/** The access card of a refused voice turn: shown in the speaker's own bar
 * only (the audience of every access card), never in the thread. */
export interface VoiceAccessCard {
  cause: VoiceModeRefusalCause;
  admin: boolean;
  keysUrl?: string;
}

/** What the card says, to the person it is about. Exported for tests. */
/** The call's debug switch (localStorage "omb.voiceCall.debug"): the
 * settings card then shows the last answer's latency stages. */
function callDebug(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("omb.voiceCall.debug") === "1";
  } catch {
    return false;
  }
}

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
  transcript: Array<{ id: string; who: "you" | "bot"; text: string; interrupted?: boolean; unheard?: string }>;
  metrics?: CallMetrics;
  onRetry(): void;
  onEnd(): void;
  /** when the call started (Date.now()); the bar's opening when absent */
  startedAt?: number;
  /** the card open at first (tests draw each state with it). "settings" opens the extra call settings. */
  defaultPanel?: "settings" | "transcript";
  /** folded back to the short row. The parent owns this when it passes the prop. */
  collapsed?: boolean;
  onCollapse?: () => void;
  onExpand?: () => void;
}

/** Time since the call started (or the bar opened), ticking once a second. */
function useCallElapsed(startedAt?: number): number {
  const [started] = useState(() => startedAt ?? Date.now());
  const [now, setNow] = useState(started);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now - started;
}

/** A round control of the pill. */
const ROUND = "flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function VoiceModeBar(props: VoiceModeBarProps) {
  const { bot, call, state, heard, caption, note, notice, refusal, metrics, onRetry, onEnd, defaultPanel, startedAt, collapsed, onCollapse, onExpand } = props;
  const { dispatch } = useStore();
  const settings = useVoiceModeSettings();
  const callSettings = useCallSettings();
  const [extras, setExtras] = useState(defaultPanel === "settings");
  const [foldedLocal, setFoldedLocal] = useState(false);
  const folded = collapsed ?? foldedLocal;
  const [list, setList] = useState<VoiceModeList | null>(null);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<{ id: string; loading: boolean } | null>(null);
  const elapsed = useCallElapsed(startedAt);
  const [enrollment, setEnrollment] = useState<Enrollment>(call.enrolled ? { state: "enrolled" } : { state: "none" });
  const stage = useRef<HTMLElement>(null);
  const cardId = useId();

  useEffect(() => {
    if (folded || voices !== null) return;
    const controller = new AbortController();
    fetchVoiceModeVoices(bot.id, controller.signal).then(
      (list) => setVoices(list),
      (error: unknown) => {
        if (!controller.signal.aborted) setVoicesError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => controller.abort();
  }, [bot.id, folded, voices]);

  // Escape closes an open list, then the extra call settings. It does not
  // fold the stage: the next Escape ends the call (LiveCall).
  useEffect(() => {
    if (!list && !extras) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      if (list) setList(null);
      else setExtras(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [list, extras]);

  const muted = state.muted;
  const held = state.phase === "held";
  const status = phaseLabel(state.phase, muted);
  const line = state.phase === "hearing" || state.phase === "interrupted" ? heard : state.phase === "speaking" ? caption : "";
  const push = callSettings.input === "push";
  const time = formatCallTime(elapsed);
  const face = state.phase === "listening" || state.phase === "hearing" ? "listening" : state.phase === "speaking" ? "sending" : state.phase === "thinking" || state.phase === "interrupted" ? "thinking" : "working";
  const fold = () => {
    if (onCollapse) onCollapse();
    else setFoldedLocal(true);
  };
  const unfold = () => {
    if (onExpand) onExpand();
    else setFoldedLocal(false);
  };

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

  const alert = Boolean(refusal || note || notice);
  const control = "flex size-14 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";
  const metricsAttrs = {
    "data-voice-phase": state.phase,
    "data-voice-first-audio-ms": metrics?.firstAudioMs,
    "data-voice-sent-ms": metrics?.sentMs,
    "data-voice-duck-ms": metrics?.duckMs,
    "data-voice-bargein-ms": metrics?.bargeInMs,
    "data-voice-utterance": metrics?.utteranceId,
    "data-voice-endpoint-ms": call.endpointMs,
    "data-voice-models": call.modelsReady ? "on-device" : "level",
  };

  const muteButton = (large: boolean) => (
    <button
      type="button"
      aria-label={muted ? t("voiceMode.unmute") : t("voiceMode.mute")}
      title={muted ? t("voiceMode.unmute") : t("voiceMode.mute")}
      aria-pressed={muted}
      data-voice-mute
      onClick={() => call.setMuted(!muted)}
      className={cn(large ? control : ROUND, "bg-raised", muted && "text-danger hover:text-danger")}
    >
      {muted ? <MicOff size={large ? 22 : 15} /> : <Mic size={large ? 22 : 15} />}
    </button>
  );

  const endButton = (large: boolean) => (
    <button
      type="button"
      aria-label={t("voiceMode.end")}
      title={t("voiceMode.end")}
      data-voice-end
      onClick={onEnd}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-danger text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
        large ? "size-14" : "size-8",
      )}
    >
      <X size={large ? 22 : 16} strokeWidth={2.5} />
    </button>
  );

  if (folded) {
    return (
      <section
        className="mx-auto flex h-11 w-full max-w-[420px] items-center gap-2 rounded-full border border-hairline-weak bg-elevated px-1.5 text-ink"
        aria-label={t("voiceMode.callWith", { name: bot.name })}
        data-voice-bar
        data-voice-collapsed
        {...metricsAttrs}
      >
        <button type="button" onClick={unfold} className="shrink-0 rounded-full" aria-label={t("voiceMode.expand")} data-voice-avatar>
          <BotAvatar bot={bot} size={28} state={face} />
        </button>
        <span className="min-w-0 truncate text-[13px]">{bot.name}</span>
        <span className="shrink-0 tabular-nums text-[13px] text-ink-secondary" data-voice-timer>{time}</span>
        <span className="sr-only" data-voice-status>{line || status}</span>
        <button type="button" onClick={unfold} aria-label={t("voiceMode.expand")} data-voice-expand className={cn(ROUND, "ml-auto")}>
          <ChevronDown size={16} />
        </button>
        {muteButton(false)}
        {endButton(false)}
      </section>
    );
  }

  return (
    <section
      ref={stage}
      className="pointer-events-auto flex h-full min-h-0 w-full flex-col bg-app text-ink"
      aria-label={t("voiceMode.callWith", { name: bot.name })}
      data-voice-bar
      data-voice-pill
      data-voice-stage
      data-voice-panel={extras ? "settings" : alert ? "alert" : "none"}
      {...metricsAttrs}
    >
      <div className="flex items-center px-4 pt-4">
        <button
          type="button"
          onClick={fold}
          aria-label={t("voiceMode.collapse")}
          title={t("voiceMode.collapse")}
          data-voice-collapse
          className="flex size-11 items-center justify-center rounded-full bg-white/10 text-ink hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ChevronUp size={20} strokeWidth={2.25} />
        </button>
      </div>
      <div className="flex flex-col items-center px-6 pt-2">
        <button
          type="button"
          onClick={state.botAudible ? () => call.interrupt() : undefined}
          className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={state.botAudible ? t("voiceMode.interrupt") : bot.name}
          data-voice-avatar
        >
          <BotAvatar bot={bot} size={88} state={face} />
        </button>
        <div className="mt-4 text-[22px] font-semibold leading-7">{bot.name}</div>
        <div className="mt-1 tabular-nums text-[15px] text-ink-secondary" data-voice-timer>{time}</div>
        <span className="sr-only" aria-live="polite" data-voice-status>{line || status}</span>
      </div>
      <div className="mx-auto mt-8 w-full max-w-[440px] px-5">
        <VoiceModeSettingsPanel
          settings={settings}
          voices={voices}
          voicesError={voicesError}
          open={list}
          previewing={previewing}
          onOpen={setList}
          onChange={(patch) => writeVoiceModeSettings(patch)}
          onPreview={preview}
          call={extras ? callSettings : undefined}
          enrollment={extras ? enrollment : undefined}
          onCallChange={extras ? (patch) => writeCallSettings(patch) : undefined}
          onEnroll={extras ? enroll : undefined}
          onForget={extras ? forget : undefined}
          latency={extras && callDebug() ? metrics?.stages ?? null : null}
        />
        {extras && (
          <button
            type="button"
            aria-pressed={held}
            data-voice-hold
            onClick={() => (held ? call.resume() : call.hold())}
            className={cn("mt-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-inset px-3 py-3 text-[15px] hover:brightness-110", held ? "text-warning" : "text-ink")}
          >
            {held ? <Play size={16} /> : <Pause size={16} />}
            {held ? t("voiceMode.resume") : t("voiceMode.hold")}
          </button>
        )}
        {refusal && (
          <div role="alert" className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-ink" data-voice-access-card>
            {voiceAccessCardText(refusal).map((entry, index) => (
              <div key={index} className={index === 0 ? "font-medium" : "mt-0.5 text-ink-secondary"}>{entry}</div>
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
          <div className={cn("mt-3 flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-[12.5px]", note ? "bg-warning/10 text-warning" : "bg-raised/60 text-ink-secondary")} role={note ? "alert" : "status"}>
            <span>{note ?? notice}</span>
            {note && (
              <button type="button" onClick={onRetry} className="shrink-0 rounded-full border border-warning/40 px-2.5 py-0.5 text-[12px] hover:bg-warning/10">
                {t("voiceMode.retry")}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="min-h-8 flex-1" />
      <div className="flex items-center justify-between px-7 pb-8" data-voice-controls>
        <div className="flex items-center gap-4">
          {muteButton(true)}
          <button
            type="button"
            aria-label={t("voiceMode.settings")}
            title={t("voiceMode.settings")}
            aria-expanded={extras}
            aria-controls={extras ? cardId : undefined}
            data-voice-gear
            onClick={() => {
              setExtras((open) => !open);
              setList(null);
            }}
            className={cn(control, "bg-white text-black hover:brightness-95")}
          >
            <Settings size={22} />
          </button>
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
              className={cn(control, "bg-raised disabled:opacity-40", state.phase === "hearing" && "bg-accent text-accent-ink")}
            >
              <Hand size={22} />
            </button>
          )}
        </div>
        {endButton(true)}
      </div>
      {extras && <span id={cardId} className="sr-only" data-voice-card />}
    </section>
  );
}
