// The floating voice bar (voice mode): the bot's name on top, its avatar,
// a live waveform, then settings, transcript, mute and end. It sits above
// the composer while the call is on and leaves the thread readable.
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, Mic, MicOff, Settings2, X } from "lucide-react";

import type { Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { speaker } from "@/lib/tts";
import { fetchVoiceModeVoices, type VoiceOption } from "@/lib/voice-mode/api";
import type { XaiSpeechEngine } from "@/lib/voice-mode/engine";
import { useVoiceModeSettings, writeVoiceModeSettings } from "@/lib/voice-mode/settings";
import { BotAvatar } from "../Avatar";
import { VoiceModeSettingsPanel, type VoiceModeList } from "./VoiceModeSettingsPanel";

export type VoicePhase = "listening" | "sending" | "working" | "speaking";

export interface VoiceModeBarProps {
  bot: Bot;
  engine: XaiSpeechEngine;
  phase: VoicePhase;
  heard: string;
  caption?: string;
  note: string | null;
  error?: string;
  /** an access card: no xAI key serves this person */
  refusal: { message: string; keysUrl?: string } | null;
  transcript: Array<{ id: string; who: "you" | "bot"; text: string }>;
  onRetry(): void;
  onInterrupt(): void;
  onEnd(): void;
}

const BARS = 28;

/** Bars from the microphone while listening, a gentle motion while the bot speaks. */
function Waveform({ engine, phase, muted }: { engine: XaiSpeechEngine; phase: VoicePhase; muted: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!element || !context) return;
    let frame = 0;
    const data = new Uint8Array(512);
    const draw = (time: number) => {
      const { width, height } = element;
      context.clearRect(0, 0, width, height);
      context.fillStyle = getComputedStyle(element).color;
      const analyser = engine.levels;
      if (analyser && phase === "listening" && !muted) analyser.getByteTimeDomainData(data);
      const step = width / BARS;
      for (let i = 0; i < BARS; i++) {
        let level: number;
        if (muted) level = 0.04;
        else if (phase === "listening" && analyser) {
          const at = Math.floor((i / BARS) * data.length);
          level = Math.min(1, (Math.abs((data[at] ?? 128) - 128) / 128) * 4);
        } else if (phase === "speaking") {
          level = 0.25 + 0.55 * Math.abs(Math.sin(time / 180 + i * 0.6)) * Math.abs(Math.cos(time / 410 + i * 0.23));
        } else {
          level = 0.08 + 0.06 * Math.abs(Math.sin(time / 600 + i * 0.4));
        }
        const bar = Math.max(2, level * height);
        const x = i * step + step * 0.2;
        context.globalAlpha = 0.85;
        context.fillRect(x, (height - bar) / 2, step * 0.6, bar);
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [engine, phase, muted]);
  return <canvas ref={canvas} width={220} height={36} className="h-9 w-full min-w-0 flex-1 text-ink" aria-hidden="true" />;
}

export function VoiceModeBar(props: VoiceModeBarProps) {
  const { bot, engine, phase, heard, caption, note, error, refusal, transcript, onRetry, onInterrupt, onEnd } = props;
  const settings = useVoiceModeSettings();
  const [muted, setMuted] = useState(engine.muted);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [list, setList] = useState<VoiceModeList | null>(null);
  const [voices, setVoices] = useState<VoiceOption[] | null>(null);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<{ id: string; loading: boolean } | null>(null);

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

  const toggleMute = useCallback(() => {
    const next = !engine.muted;
    engine.setMuted(next);
    setMuted(next);
  }, [engine]);

  const preview = useCallback(
    (voiceId: string) => {
      if (previewing?.id === voiceId) {
        speaker.stop();
        setPreviewing(null);
        return;
      }
      onInterrupt();
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
    [bot.id, onInterrupt, previewing, settings, voices],
  );

  const status = muted
    ? t("voiceMode.muted")
    : phase === "listening"
      ? t("voiceMode.listening")
      : phase === "sending"
        ? t("voiceMode.oneMoment")
        : phase === "speaking"
          ? bot.name
          : t("voiceMode.working");
  const line = phase === "listening" ? heard : caption;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-28 z-30 flex justify-center px-4" data-voice-bar>
      <div className="pointer-events-auto flex w-full max-w-[520px] flex-col items-center gap-1.5">
        <div className="rounded-full bg-panel/95 px-3 py-0.5 text-[12.5px] font-medium text-ink shadow-md ring-1 ring-hairline/50">{bot.name}</div>
        <div className="w-full rounded-2xl bg-panel/95 p-2 shadow-2xl ring-1 ring-hairline/50 backdrop-blur">
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
            />
          )}
          {transcriptOpen && (
            <div className="mb-2 max-h-48 overflow-y-auto rounded-xl bg-raised/50 px-3 py-2 text-[13px] leading-relaxed" aria-label={t("voiceMode.transcript")}>
              {transcript.length === 0 ? (
                <div className="text-ink-tertiary">{t("voiceMode.transcriptEmpty")}</div>
              ) : (
                transcript.map((entry) => (
                  <div key={entry.id} className={cn("py-0.5", entry.who === "you" ? "text-ink-secondary" : "text-ink")}>
                    <span className="mr-1.5 font-medium">{entry.who === "you" ? t("voiceMode.you") : bot.name}</span>
                    {entry.text}
                  </div>
                ))
              )}
            </div>
          )}
          {refusal && (
            <div role="alert" className="mb-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] text-ink" data-voice-access-card>
              <div className="font-medium">{t("voiceMode.noAccessTitle")}</div>
              <div className="mt-0.5 text-ink-secondary">{refusal.message}</div>
              {refusal.keysUrl && (
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
          {(note || error) && !refusal && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-xl bg-warning/10 px-3 py-1.5 text-[12.5px] text-warning">
              <span>{note ?? error}</span>
              {note && (
                <button type="button" onClick={onRetry} className="shrink-0 rounded-full border border-warning/40 px-2.5 py-0.5 text-[12px] hover:bg-warning/10">
                  {t("voiceMode.retry")}
                </button>
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={phase === "speaking" ? onInterrupt : undefined} className="shrink-0 rounded-full" aria-label={phase === "speaking" ? t("voiceMode.interrupt") : bot.name}>
              <BotAvatar bot={bot} size={36} state={phase === "listening" ? "listening" : phase === "speaking" ? "sending" : phase === "sending" ? "thinking" : "working"} />
            </button>
            <div className="flex min-w-0 flex-1 flex-col">
              <Waveform engine={engine} phase={phase} muted={muted} />
              <div className="truncate px-1 text-[11.5px] text-ink-tertiary" aria-live="polite">
                {line ? <span className="text-ink-secondary">{line}</span> : status}
              </div>
            </div>
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
              aria-label={muted ? t("voiceMode.unmute") : t("voiceMode.mute")}
              aria-pressed={muted}
              data-voice-mute
              onClick={toggleMute}
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
              <X size={17} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
