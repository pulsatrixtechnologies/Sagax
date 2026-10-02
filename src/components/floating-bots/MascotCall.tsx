// The desktop mascot on a voice call: the app's call pill (voice-mode/
// VoiceModeBar.tsx), scaled down and attached under the mascot's feet. The
// mascot itself is the pill's avatar (it bounces with the bot's voice and
// leans in while the person talks, FloatingBotView); the pill holds the
// dotted live waveform, Settings, Transcript, Mic and the red End. Settings
// or Transcript open a card where the balloon goes, like the app's card. It
// only draws what the brain sends (FloatingCall) and reports clicks
// ({ type: "call", action }); the call runs in the app.
import { useEffect, useRef, useState } from "react";
import { Hand, MessageSquareMore, Mic, MicOff, Pause, Play, Settings, X } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { formatCallTime, phaseLabel } from "@/lib/voice-mode/call-labels";
import { VoiceModeSettingsPanel, type VoiceModeList } from "../voice-mode/VoiceModeSettingsPanel";
import type { FloatingCall, FloatingCallAction, FloatingCallLevels, FloatingEvent } from "./protocol";

export type MascotCallCard = "settings" | "transcript" | null;
export type LevelSource = (listener: (levels: FloatingCallLevels) => void) => () => void;

const DOT = 4; // px between dot columns and rows, as in the app's pill
const ROWS = 5;

/** The newest levels at the right, scrolling left: one column per level report. Exported for tests. */
export function pushLevel(history: number[], level: number, columns: number): number[] {
  const next = history.length >= columns ? history.slice(history.length - columns + 1) : history.slice();
  next.push(Math.max(0, Math.min(1, level)));
  return next;
}

/** Both sides of the call as a row of dots (the bot's voice in the accent, the person's in ink). */
function Waveform({ levels, quiet }: { levels?: LevelSource; quiet: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext?.("2d");
    if (!element || !context) return;
    let bot: number[] = [];
    let mic: number[] = [];
    const draw = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (element.width !== Math.round(width * ratio) || element.height !== Math.round(height * ratio)) {
        element.width = Math.round(width * ratio);
        element.height = Math.round(height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const columns = Math.max(1, Math.floor(width / DOT));
      const style = getComputedStyle(element);
      const ink = style.color;
      const accent = style.getPropertyValue("--color-accent").trim() || ink;
      const offset = (width - (columns - 1) * DOT) / 2;
      for (let i = 0; i < columns; i++) {
        const theirs = quiet ? 0 : bot[bot.length - columns + i] ?? 0;
        const mine = quiet ? 0 : mic[mic.length - columns + i] ?? 0;
        const level = Math.max(theirs, mine);
        const reach = Math.round((level * (ROWS - 1)) / 2);
        context.fillStyle = theirs >= mine && level > 0.05 ? accent : ink;
        for (let row = -reach; row <= reach; row++) {
          context.globalAlpha = Math.min(1, 0.22 + level * 0.75 - Math.abs(row) * 0.08);
          context.beginPath();
          context.arc(offset + i * DOT, height / 2 + row * DOT, 1, 0, Math.PI * 2);
          context.fill();
        }
      }
      context.globalAlpha = 1;
    };
    draw();
    if (!levels) return;
    // drawn only when a level comes (a few times a second at most), never in a loop of its own
    return levels((next) => {
      const columns = Math.max(1, Math.floor(element.clientWidth / DOT));
      bot = pushLevel(bot, next.bot, columns);
      mic = pushLevel(mic, next.mic, columns);
      draw();
    });
  }, [levels, quiet]);
  return <canvas ref={canvas} className="block h-5 w-full text-ink" aria-hidden="true" />;
}

/** Ticks once a second from the call's start. */
function useElapsed(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return startedAt ? now - startedAt : 0;
}

const ROUND = "flex size-6 shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

export interface MascotCallProps {
  call: FloatingCall;
  name: string;
  card: MascotCallCard;
  onCard: (card: MascotCallCard) => void;
  onEvent: (event: FloatingEvent) => void;
  hover: (on: boolean) => void;
  levels?: LevelSource;
}

const act = (onEvent: MascotCallProps["onEvent"], action: FloatingCallAction, extra: { voice?: string; patch?: Record<string, string | number | boolean> } = {}) =>
  onEvent({ type: "call", action, ...extra });

/** The compact pill under the mascot. */
export function MascotCallPill({ call, name, card, onCard, onEvent, hover, levels }: MascotCallProps) {
  const held = call.phase === "held";
  const status = phaseLabel(call.phase, call.muted);
  const time = formatCallTime(useElapsed(call.startedAt));
  const toggle = (next: Exclude<MascotCallCard, null>) => {
    if (next === "settings" && card !== "settings") act(onEvent, "voices");
    onCard(card === next ? null : next);
  };
  return (
    <section
      className="fb-call-pill pointer-events-auto flex h-9 items-center gap-1 rounded-full border border-hairline-weak bg-elevated pl-2.5 pr-1 text-ink shadow-[0_6px_20px_rgba(0,0,0,0.28)]"
      aria-label={t("voiceMode.callWith", { name })}
      title={`${name} · ${time} · ${status}`}
      data-voice-pill
      data-voice-phase={call.phase}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
    >
      <span className="sr-only" aria-live="polite" data-voice-status>{call.line || status}</span>
      <div className="min-w-0 flex-1" data-voice-waveform>
        <Waveform levels={levels} quiet={held || call.phase === "connecting"} />
      </div>
      {call.push && (
        <button
          type="button"
          aria-label={t("voiceMode.pushToTalk")}
          title={t("voiceMode.pushHint")}
          data-voice-ptt
          disabled={call.muted || held}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            act(onEvent, "talk");
          }}
          onPointerUp={() => act(onEvent, "release")}
          onPointerCancel={() => act(onEvent, "release")}
          className={cn(ROUND, "disabled:opacity-40", call.phase === "hearing" && "bg-accent text-accent-ink")}
        >
          <Hand size={12} />
        </button>
      )}
      <button type="button" aria-label={t("voiceMode.settings")} title={t("voiceMode.settings")} aria-expanded={card === "settings"} data-voice-gear onClick={() => toggle("settings")} className={cn(ROUND, card === "settings" && "text-ink ring-2 ring-ink/40")}>
        <Settings size={12} />
      </button>
      <button type="button" aria-label={t("voiceMode.transcript")} title={t("voiceMode.transcript")} aria-expanded={card === "transcript"} data-voice-transcript-toggle onClick={() => toggle("transcript")} className={cn(ROUND, card === "transcript" && "bg-ink text-panel hover:text-panel")}>
        <MessageSquareMore size={12} />
      </button>
      <button
        type="button"
        aria-label={call.muted ? t("voiceMode.unmute") : t("voiceMode.mute")}
        title={call.muted ? t("voiceMode.unmute") : t("voiceMode.mute")}
        aria-pressed={call.muted}
        data-voice-mute
        onClick={() => act(onEvent, call.muted ? "unmute" : "mute")}
        className={cn(ROUND, call.muted && "text-danger hover:text-danger")}
      >
        {call.muted ? <MicOff size={12} /> : <Mic size={12} />}
      </button>
      <button
        type="button"
        aria-label={t("voiceMode.end")}
        title={t("voiceMode.end")}
        data-voice-end
        onClick={() => act(onEvent, "end")}
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-danger text-white hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X size={13} strokeWidth={2.5} />
      </button>
    </section>
  );
}

/** The pill's card: the call's settings or its transcript, where the balloon goes. */
export function MascotCallCardView({ call, name, card, onEvent, hover, style }: Omit<MascotCallProps, "onCard" | "levels"> & { style?: React.CSSProperties }) {
  const [list, setList] = useState<VoiceModeList | null>(null);
  const time = formatCallTime(useElapsed(call.startedAt));
  const status = phaseLabel(call.phase, call.muted);
  const held = call.phase === "held";
  const scroller = useRef<HTMLDivElement>(null);
  const last = call.transcript[call.transcript.length - 1];
  useEffect(() => {
    const element = scroller.current;
    if (card === "transcript" && element) element.scrollTop = element.scrollHeight;
  }, [card, call.transcript.length, last?.text, call.line]);
  // Escape folds an open list first; the next one closes the card (FloatingBotView)
  useEffect(() => {
    if (!list) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setList(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [list]);
  const alert = call.note || call.notice;
  if (!card && !alert) return null;
  return (
    <div
      className="fb-call-card pointer-events-auto overflow-hidden rounded-[18px] border border-hairline-weak bg-elevated text-ink shadow-[0_8px_28px_rgba(0,0,0,0.28)]"
      role="dialog"
      aria-label={card === "settings" ? t("voiceMode.settings") : t("voiceMode.transcript")}
      data-voice-card
      data-voice-panel={card ?? "alert"}
      style={style}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
    >
      <div ref={scroller} className="max-h-[min(55vh,320px)] overflow-y-auto px-3 py-2.5">
        {card === "settings" && (
          <>
            <VoiceModeSettingsPanel
              settings={call.settings}
              voices={call.voices}
              voicesError={call.voicesError}
              open={list}
              previewing={call.previewing}
              onOpen={setList}
              onChange={(patch) => act(onEvent, "settings", { patch: patch as Record<string, string | number> })}
              onPreview={(voice) => act(onEvent, "preview", { voice })}
              call={call.callSettings}
              enrollment={call.enrollment}
              onCallChange={(patch) => act(onEvent, "call-settings", { patch: patch as Record<string, string | boolean> })}
              onEnroll={() => act(onEvent, "enroll")}
              onForget={() => act(onEvent, "forget")}
            />
            <button
              type="button"
              aria-pressed={held}
              data-voice-hold
              onClick={() => act(onEvent, held ? "resume" : "hold")}
              className={cn("mb-1 flex w-full items-center justify-center gap-2 rounded-lg bg-raised px-3 py-1.5 text-[13px] hover:brightness-110", held ? "text-warning" : "text-ink")}
            >
              {held ? <Play size={14} /> : <Pause size={14} />}
              {held ? t("voiceMode.resume") : t("voiceMode.hold")}
            </button>
          </>
        )}
        {card === "transcript" && (
          <div aria-label={t("voiceMode.transcript")} data-voice-transcript>
            <div className="mb-2 flex items-baseline justify-between gap-2 text-[11.5px] text-ink-tertiary">
              <span className="truncate">{name}</span>
              <span className="shrink-0 tabular-nums" data-voice-timer>{time} · {status}</span>
            </div>
            {call.transcript.length === 0 && !call.line ? (
              <div className="py-1 text-[13px] text-ink-tertiary">{t("voiceMode.transcriptEmpty")}</div>
            ) : (
              <div className="flex flex-col gap-1.5 text-[13px] leading-snug">
                {call.transcript.map((entry) => (
                  <div
                    key={entry.id}
                    className={cn("max-w-[85%] rounded-2xl px-3 py-1.5", entry.who === "you" ? "self-end rounded-br-md bg-raised" : "self-start rounded-bl-md bg-inset")}
                    data-voice-line={entry.who}
                  >
                    {entry.text}
                    {entry.interrupted && <span className="ml-1.5 rounded bg-panel/60 px-1 text-[11px] text-ink-tertiary">{t("voiceMode.interruptedMark")}</span>}
                  </div>
                ))}
                {call.line && (
                  <div className={cn("max-w-[85%] rounded-2xl px-3 py-1.5 opacity-70", call.phase === "speaking" ? "self-start rounded-bl-md bg-inset" : "self-end rounded-br-md bg-raised")} data-voice-line="live">
                    {call.line}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {alert && (
          <div className={cn("my-1 flex items-center justify-between gap-2 rounded-xl px-3 py-1.5 text-[12.5px]", call.note ? "bg-warning/10 text-warning" : "bg-raised/60 text-ink-secondary")} role={call.note ? "alert" : "status"}>
            <span>{call.note ?? call.notice}</span>
            {call.note && (
              <button type="button" onClick={() => act(onEvent, "retry")} className="shrink-0 rounded-full border border-warning/40 px-2.5 py-0.5 text-[12px] hover:bg-warning/10">
                {t("voiceMode.retry")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
