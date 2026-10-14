import { memo, useCallback, useEffect, useRef, useState } from "react";

import { isHlsVideo, type WireVideoWidget } from "../../../shared/video-widget.ts";
import { t } from "@/lib/i18n";
import { MediaPlayerChrome } from "./MediaPlayerChrome";

export const VideoPlayerWidget = memo(function VideoPlayerWidget({
  video,
  showcase,
}: {
  video: WireVideoWidget;
  /** Static poster + chrome for screenshots (no media decode). */
  showcase?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(video.durationMs ? video.durationMs / 1000 : 0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isLive = video.kind === "live";
  const title = video.title ?? video.streamer ?? t("video.untitled");

  const loadMedia = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setLoading(true);
    setError(null);
    let hls: { destroy: () => void } | undefined;
    const src = video.playbackUrl;
    // Decided from the source before the media proxy hid its extension.
    const isHls = isHlsVideo({ format: video.format, playbackUrl: src });
    if (isHls && !el.canPlayType("application/vnd.apple.mpegurl")) {
      void import("hls.js").then(({ default: Hls }) => {
        if (!videoRef.current || !Hls.isSupported()) {
          setError(t("video.playbackError"));
          setLoading(false);
          return;
        }
        const instance = new Hls({ enableWorker: true });
        instance.loadSource(src);
        instance.attachMedia(videoRef.current);
        instance.on(Hls.Events.ERROR, () => {
          setError(t("video.playbackError"));
          setLoading(false);
        });
        hls = instance;
      }).catch(() => {
        setError(t("video.playbackError"));
        setLoading(false);
      });
    } else {
      el.src = src;
    }
    return () => hls?.destroy();
  }, [video.playbackUrl, video.format, isLive]);

  useEffect(() => {
    if (showcase) {
      setLoading(false);
      setError(null);
      setDuration(312);
      return;
    }
    return loadMedia();
  }, [loadMedia, showcase]);

  const togglePlay = useCallback(() => {
    if (showcase) {
      setPlaying((p) => !p);
      return;
    }
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setError(t("video.playbackError")));
    else el.pause();
  }, []);

  return (
    <MediaPlayerChrome
      header={{
        title,
        streamer: video.streamer,
        source: video.source,
        live: isLive,
        viewerCount: video.viewerCount,
      }}
      stageRef={shellRef}
      loading={loading}
      error={error}
      onRetry={loadMedia}
      playing={playing}
      onPlayToggle={togglePlay}
      native={{
        videoRef,
        isLive,
        duration: showcase ? 312 : duration,
        current: showcase ? 48 : current,
        setCurrent,
        playing,
        muted,
        volume,
        playbackUrl: video.playbackUrl,
      }}
    >
      {video.posterUrl && (
        <div
          className="vpc-backdrop"
          style={{ backgroundImage: `url(${video.posterUrl})` }}
          aria-hidden
        />
      )}
      {showcase ? (
        <img src={video.posterUrl} alt="" />
      ) : (
        <video
          ref={videoRef}
          poster={video.posterUrl}
          playsInline
          controls={false}
          onPlay={() => { setPlaying(true); setLoading(false); }}
          onPause={() => setPlaying(false)}
          onWaiting={() => setLoading(true)}
          onPlaying={() => { setLoading(false); setError(null); }}
          onLoadedData={() => setLoading(false)}
          onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
          onDurationChange={(e) => {
            if (!isLive && Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
          }}
          onVolumeChange={(e) => {
            setVolume(e.currentTarget.volume);
            setMuted(e.currentTarget.muted);
          }}
          onError={() => {
            setError(t("video.playbackError"));
            setLoading(false);
          }}
        />
      )}
    </MediaPlayerChrome>
  );
});
