import { memo, useEffect, useRef } from "react";
import { Search, Send } from "lucide-react";

import { t } from "@/lib/i18n";
import { formatMediaTime } from "./MediaPlayerChrome";

export type TranscriptCue = { startMs: number; text: string };

export const TranscriptDrawer = memo(function TranscriptDrawer({
  cues,
  filter,
  onFilter,
  activeStartMs,
  onSeek,
  error,
  onSendToBot,
}: {
  cues: TranscriptCue[];
  filter: string;
  onFilter: (v: string) => void;
  activeStartMs?: number | null;
  onSeek: (startMs: number) => void;
  error?: string | null;
  onSendToBot?: () => void;
}) {
  const activeRef = useRef<HTMLLIElement>(null);

  const q = filter.trim().toLowerCase();
  const filtered = q ? cues.filter((c) => c.text.toLowerCase().includes(q)) : cues;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeStartMs]);

  return (
    <div className="vpc-transcript">
      {error && <p className="vpc-transcript-error">{error}</p>}
      {!error && cues.length > 0 && (
        <>
          <div className="vpc-transcript-tools">
            <label className="vpc-search">
              <Search size={15} />
              <input
                type="search"
                value={filter}
                onChange={(e) => onFilter(e.target.value)}
                placeholder={t("youtube.searchTranscript")}
              />
            </label>
            {onSendToBot && (
              <button type="button" className="vpc-send" onClick={onSendToBot}>
                <Send size={14} />
                {t("youtube.sendToBot")}
              </button>
            )}
          </div>
          <ul className="vpc-cues">
            {filtered.map((cue, i) => {
              const active = activeStartMs != null && cue.startMs === activeStartMs;
              return (
                <li key={`${cue.startMs}-${i}`} ref={active ? activeRef : undefined}>
                  <button
                    type="button"
                    className="vpc-cue"
                    data-active={active ? "true" : "false"}
                    onClick={() => onSeek(cue.startMs)}
                  >
                    <span className="vpc-cue-time">{formatMediaTime(cue.startMs)}</span>
                    <span>{cue.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {!error && cues.length === 0 && (
        <p className="vpc-empty">{t("youtube.transcriptEmpty")}</p>
      )}
    </div>
  );
});
