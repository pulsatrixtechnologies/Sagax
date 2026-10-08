// Details > Coding and Details > Activity, from one list (GET
// /api/bots/:id/activity, narrowed by the server to what this person may
// read: on an organization server their own threads only).
//
// Coding is code work only: running coding jobs (the server's `coding`:
// edits to source files, version control, pull requests, file changes inside
// a repository; never a title) with their repository and branch, then the
// pull requests, branches and commits the bot's coding jobs of the window
// produced (the server's `code`, read off their own git, gh and GitHub
// calls), each opening in the browser. Activity is parallel work only
// (isParallelWork): routine runs, work handed over, the sub-agents this bot's
// threads started, parallel tasks and jobs the bot opened on itself; never a
// conversation's own turn, which is the chat. A running entry has a spinner,
// elapsed time, current step and Stop where the viewer may. When it finishes
// it reads "Finished" for FINISHED_LINGER_MS, fades out and leaves
// (LiveActivity). A section with nothing to show is not drawn, title
// included. The section title opens ActivityListModal, the history (newest
// first, by status, searchable), and a card opens ActivityDetailModal. The
// list refetches when the bot's threads change (the store's event stream)
// and polls while work runs.
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Activity, ChevronRight, GitBranch, GitCommitHorizontal, GitMerge, GitPullRequest, GitPullRequestClosed, Loader2, SquareTerminal } from "lucide-react";

import { api, useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { openExternalLink } from "@/lib/app-links";
import {
  activityLive,
  activitySignature,
  activityStatusActive,
  codeWorkWhen,
  codingLive,
  codingWhere,
  codingWork,
  codingWorkEmpty,
  pullActionLabel,
  type BotCodePullRequest,
  type CodingWork,
  FINISHED_FADE_MS,
  LiveActivity,
  type LiveView,
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
  /** A third line under an entry (a coding job's repository and branch). */
  where?: (item: BotActivityItem) => string | undefined;
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
          <ActivityCard item={item} onOpen={actions.onOpen} now={actions.now} onStop={actions.onStop} stopping={actions.stopping?.has(item.id)} where={actions.where?.(item)} />
        </li>
      ))}
    </ul>
  );
}

/** A list of entries as it is drawn (the history modal's too): loading,
 * error, empty or the cards. Split out so it renders without the fetching
 * around it. */
export function ActivityList({ items, error, onOpen, now, onStop, stopping, fading, where, label, emptyKey = "botPanel.coding.empty" }: {
  items: BotActivityItem[] | null;
  label?: string;
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
  return <Cards items={items} label={label ?? t("botPanel.coding.title")} actions={{ onOpen, now, onStop, stopping, fading, where }} />;
}

/** One row of code work: an icon, a line, a quieter line; with a web page
 * it opens in the system browser. */
function CodeRow({ kind, icon, title, subtitle, url, name }: { kind: string; icon: React.ReactNode; title: string; subtitle: string; url?: string; name: string }) {
  const body = (
    <>
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[18px] text-ink">{title}</span>
        <span className="block truncate text-[12px] leading-[17px] text-ink-secondary">{subtitle}</span>
      </span>
    </>
  );
  const row = "flex w-full min-w-0 items-center gap-3 rounded-lg px-3 py-1.5 text-left";
  return (
    <li data-code-row={kind}>
      {url ? (
        <button
          type="button"
          data-code-link={url}
          onClick={() => void openExternalLink(url)}
          aria-label={t("botPanel.code.openAria", { name })}
          title={url}
          className={cn(row, "transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60")}
        >
          {body}
        </button>
      ) : <div className={row}>{body}</div>}
    </li>
  );
}

function pullIcon(pull: BotCodePullRequest) {
  const common = { size: 16, strokeWidth: 1.9, "aria-hidden": true as const };
  if (pull.action === "merged") return <GitMerge {...common} className="shrink-0 text-accent-text" />;
  if (pull.action === "closed") return <GitPullRequestClosed {...common} className="shrink-0 text-danger" />;
  return <GitPullRequest {...common} className="shrink-0 text-success" />;
}

function pullTitle(pull: BotCodePullRequest): string {
  if (pull.title && pull.number !== undefined) return `#${pull.number} ${pull.title}`;
  if (pull.title) return pull.title;
  return pull.number !== undefined ? t("botPanel.code.pr.numbered", { number: pull.number }) : t("botPanel.code.pr.new");
}

function CodeGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h3 className="px-1 text-[12px] leading-[17px] text-ink-tertiary">{label}</h3>
      <ul className="-mx-2 flex flex-col" aria-label={label}>{children}</ul>
    </div>
  );
}

/** The Coding section's code work: pull requests, branches, commits. Each
 * group shows only when it has rows. Split out so it renders without the
 * fetching around it. */
export function CodeWorkList({ work, now }: { work: CodingWork; now: number }) {
  if (codingWorkEmpty(work)) return null;
  const common = { size: 16, strokeWidth: 1.9, "aria-hidden": true as const, className: "shrink-0 text-ink-secondary" };
  const line = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(" · ");
  return (
    <div data-code-work className="flex flex-col gap-2">
      {work.pullRequests.length > 0 && (
        <CodeGroup label={t("botPanel.code.pullRequests")}>
          {work.pullRequests.map((pull) => (
            <CodeRow
              key={pull.url ?? `${pull.repo}#${pull.number}:${pull.at}`}
              kind="pull"
              icon={pullIcon(pull)}
              title={pullTitle(pull)}
              subtitle={line(pull.repo, pullActionLabel(pull.action), codeWorkWhen(pull.at, now))}
              url={pull.url}
              name={pullTitle(pull)}
            />
          ))}
        </CodeGroup>
      )}
      {work.branches.length > 0 && (
        <CodeGroup label={t("botPanel.code.branches")}>
          {work.branches.map((branch) => (
            <CodeRow
              key={`${branch.repo}:${branch.name}`}
              kind="branch"
              icon={<GitBranch {...common} />}
              title={branch.name}
              subtitle={line(branch.repo, t(branch.pushed ? "botPanel.code.pushed" : "botPanel.code.notPushed"), codeWorkWhen(branch.at, now))}
              url={branch.url}
              name={branch.name}
            />
          ))}
        </CodeGroup>
      )}
      {work.commits.length > 0 && (
        <CodeGroup label={t("botPanel.code.commits")}>
          {work.commits.map((commit) => (
            <CodeRow
              key={commit.sha}
              kind="commit"
              icon={<GitCommitHorizontal {...common} />}
              title={commit.message ?? commit.sha.slice(0, 7)}
              subtitle={line(commit.sha.slice(0, 7), commit.branch, t(commit.pushed ? "botPanel.code.pushed" : "botPanel.code.notPushed"), codeWorkWhen(commit.at, now))}
              url={commit.url}
              name={commit.sha.slice(0, 7)}
            />
          ))}
        </CodeGroup>
      )}
    </div>
  );
}

/** What Details shows for Coding and Activity, given the loaded list:
 * each section's entries, and whether it is drawn at all. Nothing loaded
 * yet (or a failed first load) draws neither. */
export function panelSections(list: BotActivityList | null, live?: LiveView) {
  const coding = list ? codingLive(list.items, live) : [];
  const work = list ? codingWork(list.items) : { pullRequests: [], branches: [], commits: [] };
  const other = list ? activityLive(list.items, list.subagents, live) : [];
  return { coding, work, other, showCoding: coding.length > 0 || !codingWorkEmpty(work), showActivity: other.length > 0 };
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

/** Coding then Activity as Details draws them, each only when it has
 * something to show. Split out so it renders without the fetching. */
export function PanelSections({ list, live, actions, onOpenHistory }: {
  list: BotActivityList | null;
  live?: LiveView;
  actions: CardActions;
  onOpenHistory: (filter: BotActivityFilter) => void;
}) {
  const { coding, work, other, showCoding, showActivity } = panelSections(list, live);
  return (
    <>
      {showCoding && (
        <section data-bot-settings-section="coding" className="flex flex-col gap-2">
          <SectionHeader
            icon={<SquareTerminal size={16} aria-hidden="true" className="text-ink-secondary" />}
            title={t("botPanel.coding.title")}
            name="coding"
            onOpenHistory={onOpenHistory}
          />
          {coding.length > 0 && <ActivityList items={coding} error={false} {...actions} where={codingWhere} />}
          <CodeWorkList work={work} now={actions.now ?? Date.now()} />
        </section>
      )}
      {showActivity && (
        <section data-bot-settings-section="activity" className="flex flex-col gap-2">
          <SectionHeader
            icon={<Activity size={16} aria-hidden="true" className="text-ink-secondary" />}
            title={t("botPanel.activity.title")}
            name="other"
            onOpenHistory={onOpenHistory}
          />
          <ActivityList items={other} error={false} label={t("botPanel.activity.title")} {...actions} />
        </section>
      )}
    </>
  );
}

export function ActivitySection({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const [list, setList] = useState<BotActivityList | null>(null);
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
      })
      // A failed fetch keeps what is on screen; the next poll tries again.
      .catch(() => {});
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
      .catch(() => {});
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
  const actions: CardActions = { onOpen: setOpen, onStop: stop, stopping, now, fading: live.fading };

  return (
    <>
      <PanelSections list={list} live={live} actions={actions} onOpenHistory={setAll} />
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
