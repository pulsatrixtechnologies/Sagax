import { memo, useEffect, useRef } from "react";
import { Search, Send } from "lucide-react";

import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
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
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);

  const q = filter.trim().toLowerCase();
  const filtered = q ? cues.filter((c) => c.text.toLowerCase().includes(q)) : cues;

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeStartMs]);

  return (
    <div className="px-3 py-3">
      {error && (
        <p className="mb-2 text-[13px] text-danger">{error}</p>
      )}
      {!error && cues.length > 0 && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <label className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-xl border border-hairline/50 bg-panel px-3 py-2 shadow-sm">
              <Search size={15} className="shrink-0 text-ink-tertiary" />
              <input
                type="search"
                value={filter}
                onChange={(e) => onFilter(e.target.value)}
                placeholder={t("youtube.searchTranscript")}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink placeholder:text-ink-tertiary focus:outline-none"
              />
            </label>
            {onSendToBot && (
              <button
                type="button"
                onClick={onSendToBot}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[13px] font-medium text-accent-ink shadow-sm transition hover:opacity-90"
              >
                <Send size={14} />
                {t("youtube.sendToBot")}
              </button>
            )}
          </div>
          <ul
            ref={listRef}
            className="max-h-52 space-y-0.5 overflow-y-auto rounded-xl border border-hairline/35 bg-panel/80 p-1.5 text-[13px] leading-snug"
          >
            {filtered.map((cue, i) => {
              const active = activeStartMs != null && cue.startMs === activeStartMs;
              return (
                <li key={`${cue.startMs}-${i}`} ref={active ? activeRef : undefined}>
                  <button
                    type="button"
                    onClick={() => onSeek(cue.startMs)}
                    className={cn(
                      "flex w-full gap-2.5 rounded-lg px-2 py-1.5 text-start transition",
                      active
                        ? "bg-accent/15 ring-1 ring-accent/35"
                        : "hover:bg-raised/80",
                    )}
                  >
                    <span className="shrink-0 tabular-nums text-[12px] font-medium text-accent">
                      {formatMediaTime(cue.startMs)}
                    </span>
                    <span className="text-ink">{cue.text}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {!error && cues.length === 0 && (
        <p className="text-[13px] text-ink-secondary">{t("youtube.transcriptEmpty")}</p>
      )}
    </div>
  );
});
