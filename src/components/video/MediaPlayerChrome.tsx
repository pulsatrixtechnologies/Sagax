import {
  memo,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ExternalLink,
  Maximize2,
  Minimize2,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import "./video-player.css";

export function formatMediaTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type MediaChromeHeader = {
  title: string;
  streamer?: string;
  source?: string;
  avatarUrl?: string;
  live?: boolean;
  viewerCount?: number;
};

export type NativeVideoControls = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  isLive: boolean;
  duration: number;
  current: number;
  setCurrent: (n: number) => void;
  playing: boolean;
  muted: boolean;
  volume: number;
  playbackUrl: string;
};

type ChromeProps = {
  header: MediaChromeHeader;
  stageRef: React.RefObject<HTMLDivElement | null>;
  labelId?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  /** Shown when paused (native video or delegated play). */
  onPlayToggle?: () => void;
  playing?: boolean;
  /** Native video controls; omit for embed-only chrome (e.g. YouTube). */
  native?: NativeVideoControls;
  /** Extra actions in the control bar (transcript, send to bot). */
  footerActions?: ReactNode;
  /** Below the stage: transcript drawer content. */
  drawer?: ReactNode;
  drawerOpen?: boolean;
  children: ReactNode;
};

const CONTROLS_IDLE_MS = 2800;

export const MediaPlayerChrome = memo(function MediaPlayerChrome({
  header,
  stageRef,
  labelId: labelIdProp,
  loading,
  error,
  onRetry,
  onPlayToggle,
  playing = false,
  native,
  footerActions,
  drawer,
  drawerOpen,
  children,
}: ChromeProps) {
  const autoId = useId();
  const labelId = labelIdProp ?? autoId;
  const [controlsVisible, setControlsVisible] = useState(true);
  const [fs, setFs] = useState(false);
  const [scrubHover, setScrubHover] = useState<{ ratio: number; left: number } | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrubRef = useRef<HTMLDivElement>(null);

  const bumpControls = useCallback(() => {
    setControlsVisible(true);
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setControlsVisible(false), CONTROLS_IDLE_MS);
  }, []);

  useEffect(() => {
    bumpControls();
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    };
  }, [bumpControls]);

  const onFsChange = useCallback(() => {
    setFs(document.fullscreenElement === stageRef.current);
  }, [stageRef]);

  useEffect(() => {
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, [onFsChange]);

  const toggleFs = useCallback(() => {
    const shell = stageRef.current;
    if (!shell) return;
    if (document.fullscreenElement === shell) void document.exitFullscreen();
    else void shell.requestFullscreen();
  }, [stageRef]);

  const togglePiP = useCallback(async () => {
    const el = native?.videoRef.current;
    if (!el || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement === el) await document.exitPictureInPicture();
    else await el.requestPictureInPicture();
  }, [native]);

  const popOut = useCallback(() => {
    if (!native?.playbackUrl) return;
    const url = new URL(native.playbackUrl, window.location.origin).href;
    window.open(url, "_blank", "noopener,noreferrer");
  }, [native]);

  const seekFromClientX = useCallback((clientX: number) => {
    if (!native || native.isLive) return;
    const bar = scrubRef.current;
    if (!bar || !native.duration) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const t = ratio * native.duration;
    native.videoRef.current!.currentTime = t;
    native.setCurrent(t);
  }, [native]);

  const showCenterPlay = !loading && !error && !playing && onPlayToggle;

  return (
    <div
      className={cn(
        "video-player-card my-3 max-w-[min(42rem,78%)] overflow-hidden rounded-2xl border border-hairline/45 bg-card",
        drawerOpen && "ring-1 ring-accent/25",
      )}
      role="group"
      aria-labelledby={labelId}
    >
      <div
        ref={stageRef}
        className="video-player-stage group/stage relative aspect-video overflow-hidden bg-black"
        onMouseMove={bumpControls}
        onMouseLeave={() => setControlsVisible(false)}
        onFocus={bumpControls}
      >
        <span id={labelId} className="sr-only">{header.title}</span>
        <div className="absolute inset-0 z-0">{children}</div>

        {/* Top metadata */}
        <div
          className={cn(
            "pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/90 via-black/55 to-transparent px-3 pb-10 pt-3 transition-opacity duration-300",
            controlsVisible || !playing ? "opacity-100" : "opacity-0",
          )}
        >
          <div className="relative flex items-start gap-2.5 pr-2">
            {header.avatarUrl ? (
              <img
                src={header.avatarUrl}
                alt=""
                className="size-9 shrink-0 rounded-full border border-white/20 object-cover shadow-sm"
              />
            ) : header.streamer ? (
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-[13px] font-semibold text-white backdrop-blur-md"
                aria-hidden
              >
                {header.streamer.slice(0, 1).toUpperCase()}
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-tight text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.85)]">
                {header.title}
              </p>
              {(header.streamer || header.source) && (
                <p className="truncate text-[12px] text-white/75">
                  {[header.streamer, header.source].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
          </div>
          {header.live && (
            <span
              className={cn(
                "pointer-events-none absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full bg-danger/95 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white shadow-sm",
                controlsVisible || !playing ? "opacity-100" : "opacity-0",
                "transition-opacity duration-300",
              )}
            >
              <span className="video-live-pulse size-1.5 rounded-full bg-white" aria-hidden />
              {t("video.live")}
              {header.viewerCount != null && header.viewerCount > 0 && (
                <span className="font-medium normal-case tabular-nums opacity-90">
                  · {t("video.viewers", { count: String(header.viewerCount) })}
                </span>
              )}
            </span>
          )}
        </div>

        {loading && (
          <div className="video-player-shimmer pointer-events-none absolute inset-0 z-30" aria-hidden />
        )}

        {error && (
          <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center backdrop-blur-sm">
            <p className="text-[14px] leading-snug text-white/90">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-[13px] font-medium text-white backdrop-blur-md transition hover:bg-white/25"
              >
                <RotateCcw size={16} />
                {t("video.retry")}
              </button>
            )}
          </div>
        )}

        {showCenterPlay && (
          <button
            type="button"
            onClick={onPlayToggle}
            className="absolute left-1/2 top-1/2 z-30 flex size-[4.25rem] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white shadow-lg backdrop-blur-xl transition hover:scale-105 hover:bg-white/22 active:scale-95"
            aria-label={t("video.play")}
          >
            <Play size={32} className="ml-0.5" fill="currentColor" />
          </button>
        )}

        {/* Bottom controls */}
        <div
          className={cn(
            "absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-3 pb-2.5 pt-10 transition-opacity duration-300",
            controlsVisible || !playing ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          {native && !native.isLive && (
            <div
              ref={scrubRef}
              className="relative mb-2 h-1 cursor-pointer rounded-full bg-white/20"
              role="slider"
              aria-label={t("video.seek")}
              aria-valuemin={0}
              aria-valuemax={native.duration || 0}
              aria-valuenow={native.current}
              onMouseMove={(e) => {
                const bar = scrubRef.current;
                if (!bar || !native.duration) return;
                const rect = bar.getBoundingClientRect();
                const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
                setScrubHover({ ratio, left: e.clientX - rect.left });
              }}
              onMouseLeave={() => setScrubHover(null)}
              onClick={(e) => seekFromClientX(e.clientX)}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-accent"
                style={{ width: `${native.duration ? (native.current / native.duration) * 100 : 0}%` }}
              />
              {scrubHover && native.duration > 0 && (
                <span
                  className="pointer-events-none absolute -top-7 -translate-x-1/2 rounded-md bg-black/90 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
                  style={{ left: scrubHover.left }}
                >
                  {formatMediaTime(scrubHover.ratio * native.duration * 1000)}
                </span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1.5">
            {onPlayToggle && (
              <ChromeIconButton
                label={playing ? t("video.pause") : t("video.play")}
                onClick={onPlayToggle}
              >
                {playing ? <Pause size={18} /> : <Play size={18} />}
              </ChromeIconButton>
            )}
            {native && (
              <>
                <span className="min-w-[4.5rem] tabular-nums text-[11px] text-white/80">
                  {native.isLive
                    ? t("video.live")
                    : `${formatMediaTime(native.current * 1000)} / ${formatMediaTime((native.duration || 0) * 1000)}`}
                </span>
                <ChromeIconButton
                  label={native.muted ? t("video.unmute") : t("video.mute")}
                  onClick={() => {
                    const el = native.videoRef.current;
                    if (!el) return;
                    el.muted = !el.muted;
                  }}
                >
                  {native.muted || native.volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                </ChromeIconButton>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={native.muted ? 0 : native.volume}
                  onChange={(e) => {
                    const el = native.videoRef.current;
                    if (!el) return;
                    const v = Number(e.target.value);
                    el.volume = v;
                    el.muted = v === 0;
                  }}
                  className="h-1 w-16 accent-accent"
                  aria-label={t("video.volume")}
                />
                {typeof document !== "undefined" && document.pictureInPictureEnabled && (
                  <ChromeIconButton label={t("video.pip")} onClick={() => void togglePiP()}>
                    <PictureInPicture2 size={18} />
                  </ChromeIconButton>
                )}
                <ChromeIconButton label={t("video.popOut")} onClick={popOut}>
                  <ExternalLink size={18} />
                </ChromeIconButton>
              </>
            )}
            <ChromeIconButton
              label={fs ? t("video.exitFullscreen") : t("video.fullscreen")}
              onClick={toggleFs}
              className={fs ? "bg-white/20" : undefined}
            >
              {fs ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </ChromeIconButton>
            {footerActions && (
              <div className="ml-auto flex flex-wrap items-center gap-1.5">{footerActions}</div>
            )}
          </div>
        </div>
      </div>

      {drawer && (
        <div
          className={cn(
            "grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out",
            drawerOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
          )}
        >
          <div className="min-h-0 overflow-hidden border-t border-hairline/40 bg-inset">
            {drawer}
          </div>
        </div>
      )}
    </div>
  );
});

function ChromeIconButton({
  children,
  label,
  onClick,
  className,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "rounded-full p-2 text-white/95 transition hover:bg-white/15 active:bg-white/20",
        className,
      )}
    >
      {children}
    </button>
  );
}
