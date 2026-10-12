import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { FileText } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { createYoutubePlayer, type YoutubePlayerHandle } from "@/lib/youtube-embed";
import type { MessageAttachmentContext } from "../AttachmentPreview";
import { MediaPlayerChrome } from "./MediaPlayerChrome";
import { TranscriptDrawer, type TranscriptCue } from "./TranscriptDrawer";

export const YouTubeMiniPlayer = memo(function YouTubeMiniPlayer({
  videoId,
  onSendToBot,
  initialTitle,
  initialChannel,
  initialCues,
  startDrawerOpen,
  highlightStartMs,
  posterOnly,
}: {
  videoId: string;
  message?: MessageAttachmentContext;
  onSendToBot?: (text: string) => void;
  /** Known title/channel (oEmbed fills these when omitted). */
  initialTitle?: string;
  initialChannel?: string;
  initialCues?: TranscriptCue[];
  startDrawerOpen?: boolean;
  highlightStartMs?: number;
  /** Gallery: poster and chrome only, no iframe. */
  posterOnly?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YoutubePlayerHandle | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(!!startDrawerOpen);
  const [metaTitle, setMetaTitle] = useState(initialTitle ?? "");
  const [channel, setChannel] = useState(initialChannel ?? "");
  const [loading, setLoading] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cues, setCues] = useState<TranscriptCue[]>(initialCues ?? []);
  const [filter, setFilter] = useState("");
  const [activeCueMs, setActiveCueMs] = useState<number | null>(null);
  const [embedGrace, setEmbedGrace] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const id = window.setTimeout(() => setEmbedGrace(true), 3500);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let cancel = false;
    const watch = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
    void fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`)
      .then((res) => (res.ok ? res.json() as Promise<{ title?: string; author_name?: string }> : null))
      .then((data) => {
        if (cancel || !data) return;
        if (data.title) setMetaTitle(data.title);
        if (data.author_name) setChannel(data.author_name);
      })
      .catch(() => undefined);
    return () => { cancel = true; };
  }, [videoId]);

  useEffect(() => {
    if (posterOnly) {
      setPlayerReady(true);
      return;
    }
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    setPlayerReady(false);
    void createYoutubePlayer(mount, videoId).then((handle) => {
      if (cancelled) {
        handle?.destroy();
        return;
      }
      playerRef.current = handle;
      setPlayerReady(!!handle);
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId, posterOnly]);

  useEffect(() => {
    if (!drawerOpen || !cues.length) return;
    const tick = () => {
      const ms = playerRef.current?.getCurrentTimeMs?.();
      if (ms == null) return;
      const idx = cues.findIndex((c, i) => {
        const next = cues[i + 1]?.startMs ?? Infinity;
        return ms >= c.startMs && ms < next;
      });
      if (idx >= 0) setActiveCueMs(cues[idx].startMs);
    };
    const id = window.setInterval(tick, 400);
    return () => window.clearInterval(id);
  }, [drawerOpen, cues]);

  const fetchTranscript = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ cues: TranscriptCue[] }>("/api/youtube/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      setCues(res.cues);
      setDrawerOpen(true);
    } catch (e) {
      const body = e as { message?: string };
      setError(body.message ?? t("youtube.transcriptError"));
      setDrawerOpen(true);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  const handToBot = useCallback(() => {
    if (!onSendToBot || !cues.length) return;
    const body = cues.map((c) => `[${formatCue(c.startMs)}] ${c.text}`).join("\n");
    onSendToBot(t("youtube.handoffPrompt", { videoId, transcript: body }));
  }, [cues, onSendToBot, videoId]);

  const togglePlay = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) p.pause();
    else p.play();
    setPlaying(!playing);
  }, [playing]);

  const footerActions = (
    <button
      type="button"
      onClick={() => (cues.length ? setDrawerOpen((v) => !v) : void fetchTranscript())}
      disabled={loading}
      className="vpc-chip"
    >
      <FileText size={14} />
      {loading ? t("youtube.transcriptLoading") : cues.length ? t("youtube.transcriptPanel") : t("youtube.fetchTranscript")}
    </button>
  );

  return (
    <MediaPlayerChrome
      header={{
        title: metaTitle || t("youtube.playerTitle"),
        streamer: channel || undefined,
        source: "YouTube",
      }}
      stageRef={shellRef}
      labelId={titleId}
      loading={!playerReady && !embedGrace}
      playing={playing}
      onPlayToggle={playerReady || embedGrace ? togglePlay : undefined}
      footerActions={footerActions}
      drawerOpen={drawerOpen}
      drawer={
        drawerOpen ? (
          <TranscriptDrawer
            cues={cues}
            filter={filter}
            onFilter={setFilter}
            activeStartMs={highlightStartMs ?? activeCueMs}
            onSeek={(ms) => playerRef.current?.seekTo(ms / 1000)}
            error={error}
            onSendToBot={cues.length && onSendToBot ? handToBot : undefined}
          />
        ) : null
      }
    >
      <img
        src={`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`}
        alt=""
        onError={(e) => {
          e.currentTarget.src = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        }}
      />
      {!posterOnly && (
        <div ref={mountRef} title={metaTitle || t("youtube.playerTitle")} />
      )}
    </MediaPlayerChrome>
  );
});

function formatCue(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
