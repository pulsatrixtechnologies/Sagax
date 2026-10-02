// Details > Coding and Details > Activity, from one list (GET
// /api/bots/:id/activity, narrowed by the server to what this person may
// read: on an organization server their own threads only).
//
// Both sections show live work only. Coding lists running coding jobs (the
// server's `coding`: edits to source files, version control, pull requests,
// file changes inside a repository; never a title). Activity lists
// everything else that runs: routine runs and work handed over (workflows),
// the sub-agents this bot's threads started, parallel tasks and other
// background work. A running entry has a spinner, elapsed time, current step
// and Stop where the viewer may. When it finishes it reads "Finished" for
// FINISHED_LINGER_MS, fades out and leaves (LiveActivity); with nothing
// running a section is its header and a quiet line. The section title opens
// ActivityListModal, the history (newest first, by status, searchable), and
// a card opens ActivityDetailModal. The list refetches when the bot's
// threads change (the store's event stream) and polls while work runs.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Activity, ChevronRight, Loader2, SquareTerminal } from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import {
  activityLive,
  activitySignature,
  activityStatusActive,
  codingLive,
  FINISHED_FADE_MS,
  LiveActivity,
  loadBotActivity,
  loadBotActivityDetail,
  type BotActivityFilter,
  type BotActivityItem,
  type BotActivityList,
} from "@/lib/bot-activity";
import { ActivityCard } from "./ActivityCard";
import { ActivityDetailModal } from "./ActivityDetailModal";
import { ActivityListModal } from "./ActivityListModal";

const POLL_ACTIVE_MS = 4_000;
const POLL_IDLE_MS = 30_000;
const LIST_LIMIT = 50;

export interface CardActions {
  onOpen: (item: BotActivityItem) => void;
  onStop?: (item: BotActivityItem) => void;
  stopping?: ReadonlySet<string>;
  now?: number;
  /** A finished entry on its way out of the panel. */
  fading?: (item: BotActivityItem) => boolean;
}

function Cards({ items, label, actions }: { items: BotActivityItem[]; label: string; actions: CardActions }) {
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {items.map((item) => (
        <li
          key={item.id}
          data-activity-fading={actions.fading?.(item) ? "" : undefined}
          className={cn("transition-opacity ease-out", actions.fading?.(item) && "opacity-0")}
          style={{ transitionDuration: `${FINISHED_FADE_MS}ms` }}
        >
          <ActivityCard item={item} onOpen={actions.onOpen} now={actions.now} onStop={actions.onStop} stopping={actions.stopping?.has(item.id)} />
        </li>
      ))}
    </ul>
  );
}

/** The Coding list as it is drawn: loading, error, empty or the cards.
 * Split out so it renders without the fetching around it. */
export function ActivityList({ items, error, onOpen, now, onStop, stopping, fading, label, emptyKey = "botPanel.coding.empty" }: {
  items: BotActivityItem[] | null;
  label?: string;
  error: boolean;
  emptyKey?: "botPanel.coding.empty" | "botPanel.list.empty" | "botPanel.live.idle";
} & CardActions) {
  if (items === null && error) {
    return <p role="alert" className="rounded-xl bg-card px-3 py-2.5 text-[12.5px] text-ink-secondary">{t("botPanel.coding.error")}</p>;
  }
  if (items === null) {
    return (
      <p role="status" className="flex items-center gap-2 px-1 py-2 text-[12.5px] text-ink-secondary">
        <Loader2 size={14} className="animate-spin" />{t("botPanel.coding.loading")}
      </p>
    );
  }
  if (items.length === 0 && emptyKey === "botPanel.live.idle") {
    return <p data-activity-empty className="px-0.5 text-[12.5px] text-ink-tertiary">{t(emptyKey)}</p>;
  }
  if (items.length === 0) {
    return (
      <div data-activity-empty className="rounded-xl border border-dashed border-hairline/50 px-4 py-3 text-center text-[12.5px] leading-relaxed text-ink-secondary">
        {t(emptyKey)}
      </div>
    );
  }
  return <Cards items={items} label={label ?? t("botPanel.coding.title")} actions={{ onOpen, now, onStop, stopping, fading }} />;
}

/** A section header; its title opens the section's history. */
export function SectionHeader({ icon, title, name, onOpenHistory }: { icon: React.ReactNode; title: string; name: BotActivityFilter; onOpenHistory: (filter: BotActivityFilter) => void }) {
  return (
    <h2 className="flex">
      <button
        type="button"
        data-activity-history={name}
        onClick={() => onOpenHistory(name)}
        aria-haspopup="dialog"
        title={t("botPanel.history.open")}
        className="group -mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-[13px] font-normal leading-[18px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {icon}
        <span className="truncate">{title}</span>
        <ChevronRight size={13} aria-hidden="true" className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </button>
    </h2>
  );
}

export function ActivitySection({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [list, setList] = useState<BotActivityList | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<BotActivityItem | null>(null);
  const [all, setAll] = useState<BotActivityFilter | null>(null);
  // Finished work leaves the panel a few seconds after it finished.
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const tracker = useRef<LiveActivity | null>(null);
  tracker.current ??= new LiveActivity(rerender);
  useEffect(() => () => tracker.current?.dispose(), []);
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);
  const signature = activitySignature(bot.tasks);

  const refresh = useCallback(() => {
    const id = ++request.current;
    return loadBotActivity(api, bot.id, { limit: LIST_LIMIT })
      .then((next) => {
        if (id !== request.current) return;
        tracker.current?.update([...next.items, ...next.subagents]);
        setList(next);
        setNow(Date.now());
        setError(false);
      })
      .catch(() => {
        if (id === request.current) setError(true);
      });
  }, [bot.id]);

  useEffect(() => {
    setList(null);
    setOpen(null);
    setAll(null);
    tracker.current?.dispose();
    tracker.current = new LiveActivity(rerender);
  }, [bot.id]);
  // A notification asked for one entry (openBotActivity): open it once,
  // even when it is past the list's window (a routine run refused on the
  // owner's credentials in another person's thread).
  const target = state.botActivityTarget;
  useEffect(() => {
    if (!target || target.botId !== bot.id) return;
    dispatch({ type: "botActivityOpened" });
    let live = true;
    loadBotActivityDetail(api, bot.id, target.itemId)
      .then((detail) => { if (live) setOpen(detail); })
      .catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [target, bot.id, dispatch]);
  // The bot's threads changed (a turn started or settled, a hop arrived):
  // what the lists show changed too.
  useEffect(() => { void refresh(); }, [refresh, signature]);
  const active = Boolean(list && [...list.items, ...list.subagents].some((item) => activityStatusActive(item.status)));
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => window.clearInterval(timer);
  }, [refresh, active]);
  // Elapsed times tick between fetches while something runs.
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);

  const stop = useCallback((item: BotActivityItem) => {
    if (!item.threadId) return;
    setStopping((current) => new Set(current).add(item.id));
    const done = () => setStopping((current) => {
      const next = new Set(current);
      next.delete(item.id);
      return next;
    });
    dispatch({ type: "interrupt", botId: item.botId, threadId: item.threadId, onError: done });
    window.setTimeout(() => { done(); void refresh(); }, 1_500);
  }, [dispatch, refresh]);

  const live = tracker.current.view();
  const coding = list ? codingLive(list.items, live) : null;
  const other = list ? activityLive(list.items, list.subagents, live) : null;
  const actions: CardActions = { onOpen: setOpen, onStop: stop, stopping, now, fading: live.fading };

  return (
    <>
      <section data-bot-settings-section="coding" className="flex flex-col gap-2">
        <SectionHeader
          icon={<SquareTerminal size={16} aria-hidden="true" className="text-ink-secondary" />}
          title={t("botPanel.coding.title")}
          name="coding"
          onOpenHistory={setAll}
        />
        <ActivityList items={coding} error={error} emptyKey="botPanel.live.idle" {...actions} />
      </section>
      <section data-bot-settings-section="activity" className="flex flex-col gap-2">
        <SectionHeader
          icon={<Activity size={16} aria-hidden="true" className="text-ink-secondary" />}
          title={t("botPanel.activity.title")}
          name="other"
          onOpenHistory={setAll}
        />
        {other && <ActivityList items={other} error={false} label={t("botPanel.activity.title")} emptyKey="botPanel.live.idle" {...actions} />}
      </section>
      {all && (
        <ActivityListModal
          botId={bot.id}
          filter={all}
          onFilter={setAll}
          onClose={() => setAll(null)}
          onOpen={setOpen}
          onStop={stop}
          stopping={stopping}
        />
      )}
      {open && (
        <ActivityDetailModal
          item={open}
          onClose={() => setOpen(null)}
          onChanged={() => { void refresh(); }}
        />
      )}
    </>
  );
}
