import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  Volume2,
  VolumeX,
} from "lucide-react";

import type { WireVideoWidget } from "../../../shared/video-widget.ts";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { BlockFrame, BlockHeader } from "../rich-ui";

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const VideoPlayerWidget = memo(function VideoPlayerWidget({ video }: { video: WireVideoWidget }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(video.durationMs ? video.durationMs / 1000 : 0);
  const [fs, setFs] = useState(false);
  const labelId = useId();
  const isLive = video.kind === "live";
  const title = video.title ?? video.streamer ?? t("video.untitled");

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    let hls: { destroy: () => void } | undefined;
    const src = video.playbackUrl;
    const isHls = /\.m3u8(\?|$)/i.test(src) || isLive;
    if (isHls && !el.canPlayType("application/vnd.apple.mpegurl")) {
      void import("hls.js").then(({ default: Hls }) => {
        if (!videoRef.current || !Hls.isSupported()) return;
        const instance = new Hls({ enableWorker: true });
        instance.loadSource(src);
        instance.attachMedia(videoRef.current);
        hls = instance;
      });
    } else {
      el.src = src;
    }
    return () => hls?.destroy();
  }, [video.playbackUrl, isLive]);

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  const onFsChange = useCallback(() => {
    setFs(document.fullscreenElement === shellRef.current);
  }, []);

  useEffect(() => {
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [onFsChange]);

  const toggleFs = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement === shell) void document.exitFullscreen();
    else void shell.requestFullscreen();
  }, []);

  const togglePiP = useCallback(async () => {
    const el = videoRef.current;
    if (!el || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement === el) await document.exitPictureInPicture();
    else await el.requestPictureInPicture();
  }, []);

  const seek = useCallback((value: number) => {
    const el = videoRef.current;
    if (!el || isLive) return;
    el.currentTime = value;
    setCurrent(value);
  }, [isLive]);

  return (
    <BlockFrame className="max-w-[min(42rem,78%)]">
      <BlockHeader title={title}>
        <span className="text-[11px] text-ink-secondary">
          {[
            isLive ? t("video.live") : null,
            video.streamer,
            video.source,
            video.durationMs && !isLive ? formatDuration(video.durationMs) : null,
          ].filter(Boolean).join(" · ")}
        </span>
      </BlockHeader>
      <div ref={shellRef} className="relative overflow-hidden rounded-b-xl bg-black" aria-labelledby={labelId}>
        <span id={labelId} className="sr-only">{title}</span>
        <video
          ref={videoRef}
          className="aspect-video w-full bg-black"
          poster={video.posterUrl}
          playsInline
          controls={false}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onDurationChange={(e) => {
            if (!isLive && Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
          }}
          onVolumeChange={(e) => {
            setVolume(e.currentTarget.volume);
            setMuted(e.currentTarget.muted);
          }}
        />
        {isLive && (
          <span className="absolute left-3 top-3 rounded-full bg-danger px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-white">
            {t("video.live")}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-hairline/30 bg-panel px-3 py-2">
          <button
            type="button"
            onClick={togglePlay}
            className="rounded p-1.5 text-ink hover:bg-raised"
            aria-label={playing ? t("video.pause") : t("video.play")}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          {!isLive && (
            <input
              type="range"
              min={0}
              max={duration || 1}
              step={0.1}
              value={current}
              onChange={(e) => seek(Number(e.target.value))}
              className="min-w-[6rem] flex-1 accent-accent"
              aria-label={t("video.seek")}
            />
          )}
          <span className="tabular-nums text-[11px] text-ink-secondary">
            {isLive ? t("video.live") : `${formatDuration(current * 1000)} / ${formatDuration((duration || 0) * 1000)}`}
          </span>
          <button
            type="button"
            onClick={() => {
              const el = videoRef.current;
              if (!el) return;
              el.muted = !el.muted;
            }}
            className="rounded p-1.5 text-ink hover:bg-raised"
            aria-label={muted ? t("video.unmute") : t("video.mute")}
          >
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const el = videoRef.current;
              if (!el) return;
              const v = Number(e.target.value);
              el.volume = v;
              el.muted = v === 0;
            }}
            className="w-20 accent-accent"
            aria-label={t("video.volume")}
          />
          <button
            type="button"
            onClick={() => void togglePiP()}
            className="rounded p-1.5 text-ink hover:bg-raised"
            aria-label={t("video.pip")}
          >
            <PictureInPicture2 size={18} />
          </button>
          <button
            type="button"
            onClick={toggleFs}
            className={cn("rounded p-1.5 text-ink hover:bg-raised", fs && "bg-raised")}
            aria-label={fs ? t("video.exitFullscreen") : t("video.fullscreen")}
          >
            {fs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>
        </div>
      </div>
    </BlockFrame>
  );
});
