// Details > Coding and Details > Activity, from one list (GET
// /api/bots/:id/activity, narrowed by the server to what this person may
// read: on an organization server their own threads only).
//
// Coding lists coding jobs only (the server's `coding`: edits to source
// files, version control, pull requests, file changes inside a repository;
// never a title), running ones first, the newest few of the last 7 days, and
// See all opens ActivityListModal on Coding. Activity tracks everything else:
// routine runs and work handed over (workflows), the sub-agents this bot's
// threads started, and other background work. Running entries come first
// with a spinner, elapsed time, current step and Stop where the viewer may;
// work finished in the last day follows. Activity hides when nothing ran.
// A card opens ActivityDetailModal. The list refetches when the bot's
// threads change (the store's event stream) and polls while work runs.
import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Loader2, SquareTerminal } from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import {
  activityGroups,
  activitySignature,
  activityStatusActive,
  codingPreview,
  loadBotActivity,
  loadBotActivityDetail,
  type ActivityGroups,
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
}

function Cards({ items, label, actions }: { items: BotActivityItem[]; label: string; actions: CardActions }) {
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <ActivityCard item={item} onOpen={actions.onOpen} now={actions.now} onStop={actions.onStop} stopping={actions.stopping?.has(item.id)} />
        </li>
      ))}
    </ul>
  );
}

/** The Coding list as it is drawn: loading, error, empty or the cards.
 * Split out so it renders without the fetching around it. */
export function ActivityList({ items, error, onOpen, now, onStop, stopping, emptyKey = "botPanel.coding.empty" }: {
  items: BotActivityItem[] | null;
  error: boolean;
  emptyKey?: "botPanel.coding.empty" | "botPanel.list.empty";
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
  if (items.length === 0) {
    return (
      <div data-activity-empty className="rounded-xl border border-dashed border-hairline/50 px-4 py-3 text-center text-[12.5px] leading-relaxed text-ink-secondary">
        {t(emptyKey)}
      </div>
    );
  }
  return <Cards items={items} label={t("botPanel.coding.title")} actions={{ onOpen, now, onStop, stopping }} />;
}

/** The Activity groups as drawn; nothing at all when both are empty. */
export function ActivityFeed({ groups, actions }: { groups: ActivityGroups; actions: CardActions }) {
  if (!groups.running.length && !groups.recent.length) return null;
  return (
    <div className="flex flex-col gap-3">
      {groups.running.length > 0 && (
        <div data-activity-group="running" className="flex flex-col gap-1.5">
          <h3 className="px-0.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">{t("botPanel.activity.running", { count: groups.running.length })}</h3>
          <Cards items={groups.running} label={t("botPanel.activity.running", { count: groups.running.length })} actions={actions} />
        </div>
      )}
      {groups.recent.length > 0 && (
        <div data-activity-group="recent" className="flex flex-col gap-1.5">
          <h3 className="px-0.5 text-[11.5px] font-medium uppercase tracking-wide text-ink-secondary">{t("botPanel.activity.recent")}</h3>
          <Cards items={groups.recent} label={t("botPanel.activity.recent")} actions={actions} />
        </div>
      )}
    </div>
  );
}

function SectionHeader({ icon, title, action }: { icon: React.ReactNode; title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{title}</h2>
      {action}
    </div>
  );
}

function HeaderLink({ onClick, children, name }: { onClick: () => void; children: React.ReactNode; name: string }) {
  return (
    <button
      type="button"
      data-activity-see-all={name}
      onClick={onClick}
      className="shrink-0 rounded-md px-1.5 py-0.5 text-[12px] text-accent-text hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      {children}
    </button>
  );
}

export function ActivitySection({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [list, setList] = useState<BotActivityList | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<BotActivityItem | null>(null);
  const [all, setAll] = useState<BotActivityFilter | null>(null);
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const request = useRef(0);
  const signature = activitySignature(bot.tasks);

  const refresh = useCallback(() => {
    const id = ++request.current;
    return loadBotActivity(api, bot.id, { limit: LIST_LIMIT })
      .then((next) => {
        if (id !== request.current) return;
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

  const coding = list ? codingPreview(list.items, now) : null;
  const groups = list ? activityGroups(list.items, list.subagents, now) : { running: [], recent: [] };
  const otherCount = list ? list.items.filter((item) => !item.coding).length : 0;
  const actions: CardActions = { onOpen: setOpen, onStop: stop, stopping, now };

  return (
    <>
      <section data-bot-settings-section="coding" className="flex flex-col gap-2">
        <SectionHeader
          icon={<SquareTerminal size={16} aria-hidden="true" className="text-ink-secondary" />}
          title={t("botPanel.coding.title")}
          action={coding && coding.total > coding.shown.length
            ? <HeaderLink name="coding" onClick={() => setAll("coding")}>{t("botPanel.coding.seeAll", { count: coding.total })}</HeaderLink>
            : undefined}
        />
        <ActivityList items={coding?.shown ?? null} error={error} {...actions} />
      </section>
      {(groups.running.length > 0 || groups.recent.length > 0) && (
        <section data-bot-settings-section="activity" className="flex flex-col gap-2">
          <SectionHeader
            icon={<Activity size={16} aria-hidden="true" className="text-ink-secondary" />}
            title={t("botPanel.activity.title")}
            action={otherCount > 0
              ? <HeaderLink name="other" onClick={() => setAll("other")}>{t("botPanel.activity.history")}</HeaderLink>
              : undefined}
          />
          <ActivityFeed groups={groups} actions={actions} />
        </section>
      )}
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
