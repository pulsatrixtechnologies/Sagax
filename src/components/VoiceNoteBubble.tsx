// One voice note in the transcript: a play button, a scrub bar, and the
// clip's length. Playback rides the Speaker's one-voice rule — pressing
// play claims the window's voice, so call-mode speech (or another note)
// takes over by pausing this element rather than talking over it. While
// this window is on a Live call a note cannot be played at all: the call's
// microphone would pick it up (starting the call already paused it).
//
// 2026-10-16 (Grok Bot parity): a speed button (1x, 1.5x, 2x) and, when the
// transcript carries word timings, the words as buttons that jump there.
// A voice note the person recorded (lib/voice-note.ts) reuses this player
// with its loaded clip (`src`), from AttachmentGallery.
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

import { attachmentAudioUrl } from "@/lib/composer-attachments";
import { t } from "@/lib/i18n";
import { isLiveCallRunning, useLiveMedia } from "@/lib/live-call-media";
import { speaker } from "@/lib/tts";
import { cn } from "@/lib/cn";
import { nextVoiceNoteSpeed, speedLabel, wordIndexAt, type VoiceNoteWord } from "@/lib/voice-note";

/** The wire's audio attachment shape (shared/wire.ts): a parked clip plus
 * the server's duration estimate, used until the element loads metadata. */
export interface VoiceNoteAttachment {
  kind: "audio";
  path: string;
  mime: string;
  durationMs?: number;
}

function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function VoiceNoteBubble({
  attachment,
  src,
  words,
  autoPlay = false,
  className,
}: {
  attachment: VoiceNoteAttachment;
  /** A clip already loaded by the caller (a blob URL); the parked mp3 route otherwise. */
  src?: string;
  /** The transcript's words with their times, when the speech to text gave them. */
  words?: readonly VoiceNoteWord[];
  /** Start once mounted (the person just pressed play on a lazy clip). */
  autoPlay?: boolean;
  className?: string;
}) {
  const url = src ?? attachmentAudioUrl(attachment.path);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  // metadata estimate first, real duration once the element loads it
  const [duration, setDuration] = useState<number | null>(
    typeof attachment.durationMs === "number" && attachment.durationMs > 0
      ? attachment.durationMs / 1000
      : null,
  );
  const [time, setTime] = useState(0);
  const onLiveCall = isLiveCallRunning(useLiveMedia().phase);

  // Release the claim on unmount: a gone bubble cannot be paused again, and
  // the singleton must not keep a callback into a dead element.
  useEffect(() => () => releaseRef.current?.(), []);

  // the element keeps its rate across a new src; set it again on each load
  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const autoPlayed = useRef(false);
  useEffect(() => {
    if (!autoPlay || autoPlayed.current || !url) return;
    autoPlayed.current = true;
    toggle();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [autoPlay]);

  if (!url) return null;

  const giveBackVoice = (release?: () => void) => {
    if (release && releaseRef.current !== release) return;
    releaseRef.current?.();
    releaseRef.current = null;
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    // the element's own paused state, not the playing flag: media play
    // events are queued, so a second click before onPlay fires must still
    // read as "playing" and pause instead of claiming and playing again
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (onLiveCall) return;
    // claim before play: the Speaker's stop() path silences call mode and
    // any other note first, then this element takes the voice
    releaseRef.current?.();
    const release = speaker.claimExternalVoice(() => audio.pause());
    releaseRef.current = release;
    // a refused play() never fires pause, so the claim comes back here —
    // but only if this attempt's claim is still the active one
    void audio.play().catch(() => giveBackVoice(release));
  };

  const seek = (next: number) => {
    const audio = audioRef.current;
    if (audio && Number.isFinite(next)) audio.currentTime = next;
    setTime(next);
  };

  /** A word of the transcript: jump there and play. */
  const jumpTo = (start: number) => {
    seek(start);
    if (audioRef.current?.paused) toggle();
  };
  const currentWord = words?.length ? wordIndexAt(words, time) : -1;

  return (
    <div className={cn("flex w-full flex-col gap-1.5 rounded-xl bg-inset/60 px-3 py-2", className)} data-test-voice-note="">
    <div className="flex w-full items-center gap-3">
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onLoadedMetadata={(event) => {
          event.currentTarget.playbackRate = speed;
          const loaded = event.currentTarget.duration;
          if (Number.isFinite(loaded) && loaded > 0) setDuration(loaded);
        }}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={(event) => {
          // a queued pause can land after playback already resumed; only
          // a pause that stuck gives the voice back
          if (!event.currentTarget.paused) return;
          setPlaying(false);
          giveBackVoice();
        }}
        onEnded={() => {
          setPlaying(false);
          giveBackVoice();
        }}
      />
      <button
        type="button"
        onClick={toggle}
        disabled={onLiveCall && !playing}
        aria-label={playing ? t("chat.voiceNote.pause") : onLiveCall ? t("chat.voiceNote.onLiveCall") : t("chat.voiceNote.play")}
        title={playing ? t("chat.voiceNote.pause") : onLiveCall ? t("chat.voiceNote.onLiveCall") : t("chat.voiceNote.play")}
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {playing ? <Pause size={13} className="fill-current" /> : <Play size={13} className="translate-x-px fill-current" />}
      </button>
      <input
        type="range"
        aria-label={t("chat.voiceNote.seek")}
        min={0}
        max={duration ?? 0}
        step={0.1}
        value={Math.min(time, duration ?? time)}
        onChange={(event) => seek(Number(event.currentTarget.value))}
        disabled={!duration}
        className="h-1 flex-1 accent-accent"
      />
      <span className="shrink-0 text-[11px] tabular-nums text-ink-secondary">
        {clock(time)} / {duration === null ? "--:--" : clock(duration)}
      </span>
      <button
        type="button"
        onClick={() => setSpeed((current) => nextVoiceNoteSpeed(current))}
        aria-label={t("chat.voiceNote.speed", { speed: speedLabel(speed) })}
        title={t("chat.voiceNote.speed", { speed: speedLabel(speed) })}
        data-voice-note-speed={speed}
        className="h-6 min-w-9 shrink-0 rounded-full bg-ink/[0.06] px-1.5 text-[11px] font-medium tabular-nums text-ink-secondary transition-colors hover:bg-ink/[0.1] hover:text-ink focus-visible:outline-2 focus-visible:outline-focus"
      >
        {speedLabel(speed)}
      </button>
    </div>
    {words && words.length > 0 && (
      <p className="text-[12.5px] leading-5 text-ink-secondary" data-voice-note-words="">
        {words.map((word, index) => (
          <button
            key={`${index}:${word.start}`}
            type="button"
            onClick={() => jumpTo(word.start)}
            aria-label={t("chat.voiceNote.jumpToWord", { word: word.text })}
            aria-current={index === currentWord ? "true" : undefined}
            className={cn(
              "me-1 rounded px-0.5 hover:bg-ink/[0.08] hover:text-ink focus-visible:outline-2 focus-visible:outline-focus",
              index === currentWord && "bg-accent/15 text-ink",
            )}
          >
            {word.text}
          </button>
        ))}
      </p>
    )}
    </div>
  );
}
