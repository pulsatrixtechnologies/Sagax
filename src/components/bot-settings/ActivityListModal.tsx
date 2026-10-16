// The history, from the Coding or Activity section title: the bot's last 7
// days as this person may read them, coding jobs or everything else
// (`?filter=coding|other`, server/routes/bot-activity.ts; Activity adds the
// sub-agents), newest first, narrowed by status (running, finished, failed)
// and by words. A card opens ActivityDetailModal above this one.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search } from "lucide-react";

import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { activityStatusActive, historyItems, loadBotActivity, type BotActivityFilter, type BotActivityItem, type HistoryStatus } from "@/lib/bot-activity";
import { ActivityList } from "./ActivitySection";
import { DIALOG, DialogCloseButton } from "../SettingsPrimitives";
import { ACTIVITY_DIALOG } from "./ActivityDetailModal";

const POLL_MS = 4_000;
const FILTERS: BotActivityFilter[] = ["coding", "other"];
const STATUSES: HistoryStatus[] = ["all", "running", "finished", "failed"];
const STATUS_KEYS = {
  all: "botPanel.history.status.all",
  running: "botPanel.history.status.running",
  finished: "botPanel.history.status.finished",
  failed: "botPanel.history.status.failed",
} as const;

// Settings' borderless pills (2026-10-16): the chosen one filled.
const chip = (selected: boolean) => cn(
  "inline-flex h-7 min-h-[44px] items-center rounded-full px-2.5 text-[13px] leading-[18px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 motion-reduce:transition-none md:min-h-0",
  selected ? "bg-selected text-ink" : "text-ink-secondary hover:bg-hover hover:text-ink",
);

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
  const [status, setStatus] = useState<HistoryStatus>("all");
  const [search, setSearch] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);

  const load = useCallback(() => {
    const id = ++request.current;
    return loadBotActivity(api, botId, { filter, limit: 50 })
      .then((next) => {
        if (id !== request.current) return;
        setItems([...next.items, ...next.subagents]);
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
      className={ACTIVITY_DIALOG}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        // Escape closes this layer only, never the bot panel under it.
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        event.stopPropagation();
      }}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="relative flex max-h-[85vh] flex-col">
        <DialogCloseButton label={t("common.close")} onClick={onClose} />
        <div className={DIALOG.header}>
          <h2 id="activity-list-title" className={DIALOG.title}>{t("botPanel.history.title")}</h2>
          <p className={DIALOG.subtitle}>{t("botPanel.list.window")}</p>
          <div role="tablist" className="mt-3 flex gap-1">
            {FILTERS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filter === id}
                data-activity-filter={id}
                onClick={() => onFilter(id)}
                className={chip(filter === id)}
              >
                {t(id === "coding" ? "botPanel.list.filter.coding" : "botPanel.list.filter.other")}
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div role="group" aria-label={t("botPanel.history.statusAria")} className="flex gap-1">
              {STATUSES.map((id) => (
                <button key={id} type="button" aria-pressed={status === id} data-history-status={id} onClick={() => setStatus(id)} className={chip(status === id)}>
                  {t(STATUS_KEYS[id])}
                </button>
              ))}
            </div>
            <label className="ml-auto flex min-w-[160px] flex-1 items-center gap-1.5 rounded-lg border-[0.5px] border-border bg-inset px-2.5 py-1.5 focus-within:border-focus">
              <Search size={13} aria-hidden="true" className="shrink-0 text-ink-secondary" />
              <input
                type="search"
                data-history-search
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("botPanel.history.search")}
                aria-label={t("botPanel.history.search")}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-secondary"
              />
            </label>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-3">
          <ActivityList items={items && historyItems(items, status, search)} error={error} onOpen={onOpen} onStop={onStop} stopping={stopping} now={now} emptyKey="botPanel.list.empty" />
        </div>
      </div>
    </dialog>
  );
}
