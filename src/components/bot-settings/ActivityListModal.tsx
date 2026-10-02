// See all, from Details > Coding or Activity: the bot's last 7 days as this
// person may read them, filtered to coding jobs or to everything else
// (`?filter=coding|other`, server/routes/bot-activity.ts). A card opens
// ActivityDetailModal above this one.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { activityStatusActive, loadBotActivity, type BotActivityFilter, type BotActivityItem } from "@/lib/bot-activity";
import { ActivityList } from "./ActivitySection";

const POLL_MS = 4_000;
const FILTERS: BotActivityFilter[] = ["coding", "other"];

export function ActivityListModal({ botId, filter, onFilter, onClose, onOpen, onStop, stopping }: {
  botId: string;
  filter: BotActivityFilter;
  onFilter: (filter: BotActivityFilter) => void;
  onClose: () => void;
  onOpen: (item: BotActivityItem) => void;
  onStop: (item: BotActivityItem) => void;
  stopping: ReadonlySet<string>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<BotActivityItem[] | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);

  const load = useCallback(() => {
    const id = ++request.current;
    return loadBotActivity(api, botId, { filter, limit: 50 })
      .then((next) => {
        if (id !== request.current) return;
        setItems(next.items);
        setNow(Date.now());
        setError(false);
      })
      .catch(() => { if (id === request.current) setError(true); });
  }, [botId, filter]);

  useEffect(() => { setItems(null); void load(); }, [load]);
  const running = items?.some((item) => activityStatusActive(item.status)) ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { void load(); }, POLL_MS);
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { window.clearInterval(timer); window.clearInterval(tick); };
  }, [running, load]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal?.();
    return () => dialog.close?.();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      role="dialog"
      aria-labelledby="activity-list-title"
      data-activity-list={filter}
      className="m-auto w-[min(560px,calc(100%-32px))] max-h-[85vh] overflow-hidden rounded-2xl border border-hairline/50 bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-xs"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        // Escape closes this layer only, never the bot panel under it.
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="relative flex max-h-[85vh] flex-col">
        <button
          type="button"
          aria-label={t("common.close")}
          title={t("common.close")}
          onClick={onClose}
          className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink"
        >
          <X size={16} />
        </button>
        <div className="border-b border-hairline/40 px-5 pb-3 pt-4">
          <h2 id="activity-list-title" className="text-[15px] font-semibold leading-snug text-ink">{t("botPanel.list.title")}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-secondary">{t("botPanel.list.window")}</p>
          <div role="tablist" className="mt-3 flex gap-1">
            {FILTERS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                data-activity-filter={id}
                onClick={() => onFilter(id)}
                className={cn(
                  "rounded-md px-2 py-1 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  filter === id ? "bg-elevated-hover text-ink" : "text-ink-secondary hover:text-ink",
                )}
              >
                {t(id === "coding" ? "botPanel.list.filter.coding" : "botPanel.list.filter.other")}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
          <ActivityList items={items} error={error} onOpen={onOpen} onStop={onStop} stopping={stopping} now={now} emptyKey="botPanel.list.empty" />
        </div>
      </div>
    </dialog>
  );
}
