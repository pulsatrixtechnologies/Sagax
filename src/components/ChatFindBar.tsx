import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";

import { landOnSearchHit } from "@/lib/focus-message";
import { t } from "@/lib/i18n";
import type { SearchHit } from "@/lib/search-hit";
import { useShowThreads } from "@/lib/thread-preferences";
import { api, useStore } from "@/state/store";

/** Topics of the single stream searched at once, the live one and the
 * newest earlier ones: one request per topic, so a long stream stays cheap. */
export const STREAM_FIND_TOPICS = 20;

/** The newest hits first across several threads (the single stream's topics). */
export function mergeStreamHits(pages: ReadonlyArray<ReadonlyArray<SearchHit>>, limit = 100): SearchHit[] {
  return pages.flat().sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Find in this conversation. In the single stream it is its topics
 * (`threadIds`, the live one first, the newest STREAM_FIND_TOPICS): each thread is searched on its own, as
 * the server scopes it, and the hits merge newest first. */
export function ChatFindBar({ threadId, threadIds, onClose }: { threadId: string; threadIds?: readonly string[]; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    const request = ++requestRef.current;
    if (!trimmed) {
      setHits([]);
      setIndex(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      const scope = threadIds?.length ? threadIds.slice(0, STREAM_FIND_TOPICS) : [threadId];
      void Promise.all(scope.map((id) => api(`/api/search?q=${encodeURIComponent(trimmed)}&limit=100&threadId=${encodeURIComponent(id)}`)))
        .then((bodies) => {
          if (request !== requestRef.current) return;
          const pages = bodies.map((body) => (Array.isArray(body?.hits) ? body.hits as SearchHit[] : []));
          setHits(scope.length > 1 ? mergeStreamHits(pages) : pages[0] ?? []);
          setIndex(0);
        })
        .catch((error) => {
          if (request !== requestRef.current) return;
          setHits([]);
          dispatch({ type: "error", message: error instanceof Error ? error.message : t("chat.find.failed") });
        })
        .finally(() => {
          if (request === requestRef.current) setLoading(false);
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [dispatch, query, threadId, threadIds?.join("\n")]);

  const land = (next: number) => {
    const hit = hits[next];
    if (!hit) return;
    setIndex(next);
    void landOnSearchHit(hit, state, dispatch, showThreads).catch((error) =>
      dispatch({ type: "error", message: error instanceof Error ? error.message : t("chat.find.unavailable") }),
    );
  };
  const move = (delta: number) => {
    if (!hits.length) return;
    land((index + delta + hits.length) % hits.length);
  };

  // Jump to the first match as soon as a new result set arrives.
  useEffect(() => {
    if (hits[0]) land(0);
    // `land` intentionally reads the state that produced this result set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits]);

  return (
    <div className="w-full px-5 pb-2">
      <div className="flex items-center gap-1.5 rounded-xl border border-hairline/50 bg-panel px-2 py-1.5 shadow-sm focus-within:border-focus">
        <Search size={15} className="shrink-0 text-ink-secondary" />
        <input
          ref={inputRef}
          dir="auto"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "Enter") {
              event.preventDefault();
              move(event.shiftKey ? -1 : 1);
            }
          }}
          placeholder={t("chat.find.placeholder")}
          aria-label={t("chat.find.placeholder")}
          className="min-w-0 flex-1 bg-transparent px-1 text-[13px] text-ink outline-none placeholder:text-ink-tertiary"
        />
        <span className="min-w-[58px] text-right text-[11.5px] tabular-nums text-ink-secondary">
          {loading
            ? t("chat.find.searching")
            : query.trim()
              ? hits.length
                ? t("chat.find.position", { index: index + 1, count: hits.length })
                : t("chat.find.noResults")
              : ""}
        </span>
        <button
          type="button"
          onClick={() => move(-1)}
          disabled={!hits.length}
          aria-label={t("chat.find.previous")}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-30"
        >
          <ChevronUp size={15} />
        </button>
        <button
          type="button"
          onClick={() => move(1)}
          disabled={!hits.length}
          aria-label={t("chat.find.next")}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink disabled:opacity-30"
        >
          <ChevronDown size={15} />
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("chat.find.close")}
          className="rounded-md p-1 text-ink-secondary hover:bg-raised hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
