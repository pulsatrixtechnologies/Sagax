// Client side of the bot panel's Coding and Activity sections
// (shared/bot-activity.ts, server/routes/bot-activity.ts): fetches, labels,
// times, and how the list splits between the two sections.
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import {
  activityStatusActive,
  BOT_ACTIVITY_WINDOW_MS,
  type BotActivityDetail,
  type BotActivityItem,
  type BotActivityList,
  type BotActivityStatus,
  type BotActivityStep,
} from "../../shared/bot-activity";

export type { BotActivityDetail, BotActivityItem, BotActivityList, BotActivityStatus, BotActivityStep };
export { activityStatusActive };

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export type BotActivityFilter = "coding" | "other";

export async function loadBotActivity(api: Api, botId: string, options: { filter?: BotActivityFilter; limit?: number } = {}): Promise<BotActivityList> {
  const query = new URLSearchParams();
  if (options.filter) query.set("filter", options.filter);
  if (options.limit) query.set("limit", String(options.limit));
  const suffix = query.size ? `?${query}` : "";
  const list = await api<Partial<BotActivityList>>(`/api/bots/${encodeURIComponent(botId)}/activity${suffix}`);
  return { items: list.items ?? [], subagents: list.subagents ?? [] };
}

/** Coding shows its few newest jobs; See all opens the rest. */
export const CODING_SHOWN = 4;
/** Activity keeps finished work this long, then lets it go. */
export const ACTIVITY_RECENT_MS = 24 * 60 * 60_000;
export const ACTIVITY_RECENT_SHOWN = 5;

function newestRunningFirst(a: BotActivityItem, b: BotActivityItem): number {
  return Number(activityStatusActive(b.status)) - Number(activityStatusActive(a.status)) || b.updatedAt - a.updatedAt;
}

/** Details > Coding: coding jobs only (the server's `coding`, never a
 * title), running ones first, from the last 7 days, the newest few. */
export function codingPreview(items: readonly BotActivityItem[], now: number, limit = CODING_SHOWN): { shown: BotActivityItem[]; total: number } {
  const since = now - BOT_ACTIVITY_WINDOW_MS;
  const coding = items
    .filter((item) => item.coding && item.kind !== "subagent" && (activityStatusActive(item.status) || item.updatedAt >= since))
    .sort(newestRunningFirst);
  return { shown: coding.slice(0, limit), total: coding.length };
}

export interface ActivityGroups {
  /** Running, waiting or queued: workflows (routine runs, work handed
   * over), sub-agents and other background work that is not coding. */
  running: BotActivityItem[];
  /** Finished, failed or stopped in the last day, newest first. */
  recent: BotActivityItem[];
}

/** Details > Activity: everything that is not a coding job, plus the
 * sub-agents this bot's threads started (coding or not). Empty groups mean
 * the section hides. */
export function activityGroups(items: readonly BotActivityItem[], subagents: readonly BotActivityItem[], now: number, recentLimit = ACTIVITY_RECENT_SHOWN): ActivityGroups {
  const since = now - ACTIVITY_RECENT_MS;
  const seen = new Set<string>();
  const all = [...items.filter((item) => !item.coding), ...subagents].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  const running = all.filter((item) => activityStatusActive(item.status)).sort(newestRunningFirst);
  const recent = all
    .filter((item) => !activityStatusActive(item.status) && (item.endedAt ?? item.updatedAt) >= since)
    .sort((a, b) => (b.endedAt ?? b.updatedAt) - (a.endedAt ?? a.updatedAt))
    .slice(0, recentLimit);
  return { running, recent };
}

/** One entry's detail, by its list id (`thread:<id>` or `run:<id>`). */
export async function loadBotActivityDetail(api: Api, botId: string, itemId: string): Promise<BotActivityDetail> {
  const [kind, ...rest] = itemId.split(":");
  const id = rest.join(":");
  const query = kind === "run" ? `runId=${encodeURIComponent(id)}` : `threadId=${encodeURIComponent(id)}`;
  const { item } = await api<{ item: BotActivityDetail }>(`/api/bots/${encodeURIComponent(botId)}/activity/item?${query}`);
  return item;
}

const STATUS_KEYS: Record<BotActivityStatus, LocaleKey> = {
  running: "botPanel.coding.status.running",
  waiting: "botPanel.coding.status.waiting",
  queued: "botPanel.coding.status.queued",
  finished: "botPanel.coding.status.finished",
  failed: "botPanel.coding.status.failed",
  stopped: "botPanel.coding.status.stopped",
};

export function activityStatusLabel(status: BotActivityStatus): string {
  return t(STATUS_KEYS[status]);
}

const VIA_KEYS: Record<NonNullable<BotActivityDetail["via"]>, LocaleKey> = {
  subscription: "botPanel.activity.via.subscription",
  "owner-key": "botPanel.activity.via.ownerKey",
  "speaker-key": "botPanel.activity.via.speakerKey",
  server: "botPanel.activity.via.server",
  "org-key": "botPanel.activity.via.orgKey",
};

export function activityViaLabel(via: NonNullable<BotActivityDetail["via"]>): string {
  return t(VIA_KEYS[via]);
}

export function activityWhereLabel(where: NonNullable<BotActivityStep["where"]>): string {
  return t(where === "computer" ? "botPanel.activity.where.computer" : "botPanel.activity.where.server");
}

/** "45s", "12m", "1h 05m": an elapsed time at a glance. */
export function formatActivityDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** The card's second line: the status, plus who handed it over when a bot
 * did. A running entry reads its elapsed time and current step instead. */
export function activitySubtitle(item: BotActivityItem, now?: number): string {
  if (now !== undefined && activityStatusActive(item.status)) {
    const parts = [activityStatusLabel(item.status), formatActivityDuration(now - item.startedAt)];
    if (item.kind === "subagent" && item.botName) parts.push(item.botName);
    if (item.kind === "routine") parts.push(t("botPanel.coding.kind.routine"));
    if (item.kind === "hop" && item.startedBy?.name) parts.push(t("botPanel.coding.handedBy", { name: item.startedBy.name }));
    if (item.currentStep) parts.push(item.currentStep);
    return parts.join(" · ");
  }
  const status = activityStatusLabel(item.status);
  if (item.kind === "hop" && item.startedBy?.name) return `${status} · ${t("botPanel.coding.handedBy", { name: item.startedBy.name })}`;
  if (item.kind === "routine") return `${status} · ${t("botPanel.coding.kind.routine")}`;
  if (item.kind === "subagent" && item.botName) return `${status} · ${item.botName}`;
  return status;
}

/** What should be on screen changed: refetch the list. */
export function activitySignature(tasks: ReadonlyArray<{ threadId: string; busy?: boolean; activity?: string; updatedAt?: number }> | undefined): string {
  return (tasks ?? []).map((task) => `${task.threadId}:${task.busy ? 1 : 0}:${task.activity ?? ""}:${task.updatedAt ?? 0}`).join("|");
}
