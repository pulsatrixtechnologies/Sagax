import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, Send } from "lucide-react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { createYoutubePlayer, type YoutubePlayerHandle } from "@/lib/youtube-embed";
import { BlockFrame, BlockHeader } from "../rich-ui";
import type { MessageAttachmentContext } from "../AttachmentPreview";

type Cue = { startMs: number; text: string };

function formatCueTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export const YouTubeMiniPlayer = memo(function YouTubeMiniPlayer({
  videoId,
  onSendToBot,
}: {
  videoId: string;
  message?: MessageAttachmentContext;
  onSendToBot?: (text: string) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YoutubePlayerHandle | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [filter, setFilter] = useState("");
  const panelId = useId();

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    void createYoutubePlayer(mount, videoId).then((handle) => {
      if (!cancelled) playerRef.current = handle;
    });
    return () => {
      cancelled = true;
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  const fetchTranscript = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<{ cues: Cue[] }>("/api/youtube/transcript", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      setCues(res.cues);
      setOpen(true);
    } catch (e) {
      const body = e as { message?: string };
      setError(body.message ?? t("youtube.transcriptError"));
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, [videoId]);

  const filtered = filter.trim()
    ? cues.filter((c) => c.text.toLowerCase().includes(filter.trim().toLowerCase()))
    : cues;

  const handToBot = useCallback(() => {
    if (!onSendToBot || !cues.length) return;
    const body = cues.map((c) => `[${formatCueTime(c.startMs)}] ${c.text}`).join("\n");
    onSendToBot(t("youtube.handoffPrompt", { videoId, transcript: body }));
  }, [cues, onSendToBot, videoId]);

  return (
    <BlockFrame className="my-3 max-w-[min(42rem,100%)]">
      <BlockHeader title={t("youtube.playerTitle")}>
        <span className="text-[11px] text-ink-secondary">{videoId}</span>
      </BlockHeader>
      <div className="overflow-hidden rounded-b-xl border-t border-hairline/30">
        <div
          ref={mountRef}
          className="aspect-video w-full bg-black"
          title={t("youtube.playerTitle")}
        />
        <div className="flex flex-wrap items-center gap-2 bg-panel px-3 py-2">
          <button
            type="button"
            onClick={() => void fetchTranscript()}
            disabled={loading}
            className="rounded-full bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-ink disabled:opacity-50"
          >
            {loading ? t("youtube.transcriptLoading") : t("youtube.fetchTranscript")}
          </button>
          {cues.length > 0 && onSendToBot && (
            <button
              type="button"
              onClick={handToBot}
              className="inline-flex items-center gap-1 rounded-full border border-hairline px-3 py-1.5 text-[13px] text-ink hover:bg-raised"
            >
              <Send size={14} />
              {t("youtube.sendToBot")}
            </button>
          )}
          {cues.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="ml-auto inline-flex items-center gap-1 text-[13px] text-ink-secondary hover:text-ink"
              aria-expanded={open}
              aria-controls={panelId}
            >
              {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {t("youtube.transcriptPanel")}
            </button>
          )}
        </div>
        {open && (
          <div id={panelId} className="border-t border-hairline/30 bg-inset px-3 py-2">
            {error && <p className="text-[13px] text-danger">{error}</p>}
            {!error && cues.length > 0 && (
              <>
                <label className="mb-2 flex items-center gap-2 rounded-lg border border-hairline/40 bg-panel px-2 py-1.5">
                  <Search size={14} className="text-ink-tertiary" />
                  <input
                    type="search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={t("youtube.searchTranscript")}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none"
                  />
                </label>
                <ul className="max-h-48 space-y-1 overflow-y-auto text-[13px] leading-snug">
                  {filtered.map((cue, i) => (
                    <li key={`${cue.startMs}-${i}`}>
                      <button
                        type="button"
                        className="group flex w-full gap-2 rounded px-1 py-0.5 text-start hover:bg-raised"
                        onClick={() => playerRef.current?.seekTo(cue.startMs / 1000)}
                      >
                        <span className="shrink-0 tabular-nums text-accent">{formatCueTime(cue.startMs)}</span>
                        <span className="text-ink">{cue.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
      </div>
    </BlockFrame>
  );
});
