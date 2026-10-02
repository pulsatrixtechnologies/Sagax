// Details > Coding: what this bot is doing and did lately (its engine
// sessions, work other bots handed it, sub-agents it started, routine runs),
// one rounded card per entry. A card opens ActivityDetailModal. The list is
// the server's (GET /api/bots/:id/activity), narrowed to what this person may
// read; it refetches when the bot's threads change and polls while work runs.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, SquareTerminal, Workflow } from "lucide-react";

import { api, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import {
  activitySignature,
  activityStatusActive,
  loadBotActivity,
  type BotActivityItem,
} from "@/lib/bot-activity";
import { ActivityCard } from "./ActivityCard";
import { ActivityDetailModal } from "./ActivityDetailModal";

const POLL_ACTIVE_MS = 4_000;
const POLL_IDLE_MS = 30_000;

/** The list as it is drawn: loading, error, empty or the cards. Split out so
 * it renders without the fetching around it. */
export function ActivityList({ items, error, onOpen }: {
  items: BotActivityItem[] | null;
  error: boolean;
  onOpen: (item: BotActivityItem) => void;
}) {
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
      <div className="rounded-xl border border-dashed border-hairline/50 px-4 py-4 text-center text-[12.5px] leading-relaxed text-ink-secondary">
        <Workflow size={18} className="mx-auto mb-1.5 opacity-60" aria-hidden="true" />
        {t("botPanel.coding.empty")}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2" aria-label={t("botPanel.coding.title")}>
      {items.map((item) => (
        <li key={item.id}><ActivityCard item={item} onOpen={onOpen} /></li>
      ))}
    </ul>
  );
}

export function ActivitySection({ bot }: { bot: Bot }) {
  const [items, setItems] = useState<BotActivityItem[] | null>(null);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState<BotActivityItem | null>(null);
  const request = useRef(0);
  const signature = activitySignature(bot.tasks);

  const refresh = useCallback(() => {
    const id = ++request.current;
    return loadBotActivity(api, bot.id)
      .then((next) => {
        if (id !== request.current) return;
        setItems(next);
        setError(false);
      })
      .catch(() => {
        if (id === request.current) setError(true);
      });
  }, [bot.id]);

  useEffect(() => {
    setItems(null);
    setOpen(null);
  }, [bot.id]);
  // The bot's threads changed (a turn started or settled, a hop arrived):
  // what the list shows changed too.
  useEffect(() => { void refresh(); }, [refresh, signature]);
  const active = items?.some((item) => activityStatusActive(item.status)) ?? false;
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, active ? POLL_ACTIVE_MS : POLL_IDLE_MS);
    return () => window.clearInterval(timer);
  }, [refresh, active]);

  return (
    <section data-bot-settings-section="coding" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <SquareTerminal size={16} aria-hidden="true" className="text-ink-secondary" />
        <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("botPanel.coding.title")}</h2>
      </div>
      <ActivityList items={items} error={error} onOpen={setOpen} />
      {open && (
        <ActivityDetailModal
          item={open}
          onClose={() => setOpen(null)}
          onChanged={() => { void refresh(); }}
        />
      )}
    </section>
  );
}
