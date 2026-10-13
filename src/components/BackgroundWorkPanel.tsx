// Right sidebar: sub-agents and background work only (never the open
// conversation's own turn). Routines, hops, parallel tasks and sub-agents.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Layers, Loader2 } from "lucide-react";

import { api, openThread, useStore, type Bot } from "@/state/store";
import { useShowThreads } from "@/lib/thread-preferences";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import {
  activityLive,
  activityStatusActive,
  activityStatusLabel,
  activitySubtitle,
  formatActivityDuration,
  loadBotActivityDetail,
  type BotActivityDetail,
  type BotActivityItem,
} from "@/lib/bot-activity";
import { useBotActivityFeed } from "@/lib/use-bot-activity-feed";
import { ActivityStatusIcon } from "./bot-settings/ActivityCard";
import { ActivitySteps } from "./bot-settings/ActivitySteps";
import { ActivityDetailModal } from "./bot-settings/ActivityDetailModal";
import { InstanceProviderMark, ProviderMark } from "./ProviderIcons";
import { FINISHED_FADE_MS } from "@/lib/bot-activity";
import type { InstanceInfo } from "@/state/store";

function engineMark(item: BotActivityItem, instances: readonly InstanceInfo[]) {
  const instanceId = item.engine?.instanceId;
  if (!instanceId) return <ProviderMark driverKind="" size={18} className="text-ink-secondary" />;
  const instance = instances.find((entry) => entry.instanceId === instanceId);
  if (instance) return <InstanceProviderMark instance={instance} size={18} />;
  return <ProviderMark driverKind={instanceId} size={18} />;
}

function BackgroundWorkCard({
  bot,
  item,
  now,
  expanded,
  onToggle,
  onOpenTranscript,
  onOpenDetail,
  fading,
}: {
  bot: Bot;
  item: BotActivityItem;
  now: number;
  expanded: boolean;
  onToggle: () => void;
  onOpenTranscript: () => void;
  onOpenDetail: () => void;
  fading?: boolean;
}) {
  const { state } = useStore();
  const [detail, setDetail] = useState<BotActivityDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const instances = state.instances;

  useEffect(() => {
    if (!expanded) {
      setDetail(null);
      return;
    }
    let live = true;
    setLoading(true);
    loadBotActivityDetail(api, bot.id, item.id)
      .then((next) => { if (live) setDetail(next); })
      .catch(() => { if (live) setDetail(null); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [expanded, bot.id, item.id]);

  const elapsed = activityStatusActive(item.status) ? formatActivityDuration(now - item.startedAt) : undefined;
  const modelLine = item.engine?.model;

  return (
    <article
      data-background-work-card={item.id}
      data-background-work-status={item.status}
      className={cn(
        "rounded-xl border border-hairline-weak bg-card transition-opacity ease-out",
        fading && "opacity-0",
      )}
      style={fading ? { transitionDuration: `${FINISHED_FADE_MS}ms` } : undefined}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-inset">
          {engineMark(item, instances)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <ActivityStatusIcon status={item.status} size={14} />
            <span className="truncate text-[13px] font-medium text-ink">{item.title}</span>
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-ink-secondary">
            {activityStatusLabel(item.status)}
            {elapsed ? ` · ${elapsed}` : ""}
            {item.currentStep ? ` · ${item.currentStep}` : ""}
          </span>
          {modelLine && (
            <span className="mt-0.5 block truncate text-[11px] text-ink-tertiary">{modelLine}</span>
          )}
          {!expanded && item.status === "finished" && detail?.note && (
            <span className="mt-1 line-clamp-2 text-[12px] text-ink-secondary">{detail.note}</span>
          )}
        </span>
        {expanded ? <ChevronDown size={16} className="shrink-0 text-ink-secondary" /> : <ChevronRight size={16} className="shrink-0 text-ink-secondary" />}
      </button>
      {expanded && (
        <div className="border-t border-hairline-weak px-3 pb-3 pt-2">
          {loading && (
            <p className="flex items-center gap-2 py-2 text-[12px] text-ink-secondary">
              <Loader2 size={14} className="animate-spin" aria-hidden />{t("backgroundWork.loadingDetail")}
            </p>
          )}
          {detail && !loading && (
            <>
              {detail.steps.length > 0 && (
                <div className="mb-2 max-h-48 overflow-y-auto">
                  <ActivitySteps steps={detail.steps} truncated={detail.stepsTruncated} />
                </div>
              )}
              {detail.note && (
                <p className="mb-2 rounded-lg bg-inset px-2.5 py-2 text-[12px] leading-relaxed text-ink-secondary">{detail.note}</p>
              )}
              {!activityStatusActive(detail.status) && detail.steps.length === 0 && !detail.note && (
                <p className="text-[12px] text-ink-secondary">{activitySubtitle(item, now)}</p>
              )}
            </>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            {item.threadId && (
              <button
                type="button"
                onClick={onOpenTranscript}
                className="inline-flex items-center gap-1 rounded-lg border border-hairline-weak px-2.5 py-1 text-[12px] text-ink hover:bg-hover"
              >
                <ExternalLink size={12} aria-hidden />
                {t("backgroundWork.openTranscript")}
              </button>
            )}
            <button
              type="button"
              onClick={onOpenDetail}
              className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12px] text-accent-text hover:bg-hover"
            >
              {t("backgroundWork.openDetail")}
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

export function BackgroundWorkPanel({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const threadsShown = useShowThreads();
  const feed = useBotActivityFeed(bot);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [modalItem, setModalItem] = useState<BotActivityItem | null>(null);

  const items = useMemo(() => {
    if (!feed.list) return [];
    return activityLive(feed.list.items, feed.list.subagents, feed.live);
  }, [feed.list, feed.live]);

  const openTranscript = useCallback((item: BotActivityItem) => {
    if (!item.threadId) return;
    openThread(dispatch, { botId: bot.id, threadId: item.threadId }, state, threadsShown);
  }, [bot.id, dispatch, state, threadsShown]);

  useEffect(() => {
    if (feed.deepLinked) setModalItem(feed.deepLinked);
  }, [feed.deepLinked]);

  if (items.length === 0 && feed.list !== null && !feed.error) {
    return null;
  }

  return (
    <>
      <aside
        data-background-work-panel=""
        aria-label={t("backgroundWork.title")}
        className="hidden h-full w-[min(320px,30vw)] min-w-[260px] shrink-0 flex-col border-l border-hairline-weak bg-app lg:flex"
      >
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline-weak px-3">
          <Layers size={16} className="text-ink-secondary" aria-hidden />
          <h2 className="truncate text-[13px] font-medium text-ink">{t("backgroundWork.title")}</h2>
          {items.some((item) => activityStatusActive(item.status)) && (
            <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-secondary">
              <Loader2 size={12} className="animate-spin text-accent-text" aria-hidden />
              {items.filter((item) => activityStatusActive(item.status)).length}
            </span>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {feed.list === null && !feed.error && (
            <p className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
              <Loader2 size={14} className="animate-spin" />{t("backgroundWork.loading")}
            </p>
          )}
          {feed.error && feed.list === null && (
            <p role="alert" className="text-[12.5px] text-ink-secondary">{t("backgroundWork.error")}</p>
          )}
          {items.length === 0 && feed.list !== null && (
            <p className="rounded-xl border border-dashed border-hairline/50 px-3 py-4 text-center text-[12.5px] text-ink-secondary">
              {t("backgroundWork.empty")}
            </p>
          )}
          <ul className="flex flex-col gap-2">
            {items.map((item) => (
              <li key={item.id}>
                <BackgroundWorkCard
                  bot={bot}
                  item={item}
                  now={feed.now}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId((current) => (current === item.id ? null : item.id))}
                  onOpenTranscript={() => openTranscript(item)}
                  onOpenDetail={() => setModalItem(item)}
                  fading={feed.live.fading(item)}
                />
              </li>
            ))}
          </ul>
        </div>
      </aside>
      {modalItem && (
        <ActivityDetailModal
          item={modalItem}
          onClose={() => {
            setModalItem(null);
            feed.clearDeepLink();
          }}
          onChanged={() => { void feed.refresh(); }}
        />
      )}
    </>
  );
}
