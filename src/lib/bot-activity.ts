// Client side of the bot panel's Coding and Activity sections
// (shared/bot-activity.ts, server/routes/bot-activity.ts): fetches, labels,
// times, and how the list splits between the two sections.
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import {
  activityStatusActive,
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

/** A job that finishes stays this long in the panel ("Finished"), then
 * goes: the panel shows live work only, past work is in the history. */
export const FINISHED_LINGER_MS = 5_000;
/** The last part of that time fades the card out. */
export const FINISHED_FADE_MS = 700;

function newestRunningFirst(a: BotActivityItem, b: BotActivityItem): number {
  return Number(activityStatusActive(b.status)) - Number(activityStatusActive(a.status)) || b.updatedAt - a.updatedAt;
}

/** What the panel shows: running entries, plus those seen running that
 * finished less than FINISHED_LINGER_MS ago (fading at the end). */
export interface LiveView {
  visible: (item: BotActivityItem) => boolean;
  fading: (item: BotActivityItem) => boolean;
}

/** Follows the entries across fetches. An entry seen running and then
 * settled stays FINISHED_LINGER_MS from the moment it was seen settled,
 * then leaves; `onChange` fires when the fade starts and when it leaves.
 * Entries already settled when first seen never show. */
export class LiveActivity {
  private readonly running = new Set<string>();
  private readonly settled = new Map<string, number>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(private readonly onChange: () => void, private readonly clock: () => number = Date.now) {}

  update(items: readonly BotActivityItem[]): void {
    const at = this.clock();
    for (const item of items) {
      if (activityStatusActive(item.status)) {
        this.running.add(item.id);
        this.settled.delete(item.id);
      } else if (this.running.delete(item.id)) {
        this.settled.set(item.id, at);
        this.later(FINISHED_LINGER_MS - FINISHED_FADE_MS);
        this.later(FINISHED_LINGER_MS);
      }
    }
  }

  view(): LiveView {
    const at = this.clock();
    const age = (item: BotActivityItem) => {
      const since = this.settled.get(item.id);
      return since === undefined ? undefined : at - since;
    };
    return {
      visible: (item) => activityStatusActive(item.status) || (age(item) ?? Infinity) < FINISHED_LINGER_MS,
      fading: (item) => !activityStatusActive(item.status) && (age(item) ?? 0) >= FINISHED_LINGER_MS - FINISHED_FADE_MS,
    };
  }

  dispose(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  private later(ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const at = this.clock();
      for (const [id, since] of this.settled) if (at - since >= FINISHED_LINGER_MS) this.settled.delete(id);
      this.onChange();
    }, ms);
    this.timers.add(timer);
  }
}

const SHOW_ALL: LiveView = { visible: () => true, fading: () => false };

/** Details > Coding: running coding jobs only (the server's `coding`, never
 * a title), and those that just finished while they leave. */
export function codingLive(items: readonly BotActivityItem[], live: LiveView = SHOW_ALL): BotActivityItem[] {
  return items
    .filter((item) => item.coding && item.kind !== "subagent" && live.visible(item))
    .sort(newestRunningFirst);
}

/** Details > Activity: everything that is not a coding job, plus the
 * sub-agents this bot's threads started (coding or not); running entries
 * and those that just finished while they leave. */
export function activityLive(items: readonly BotActivityItem[], subagents: readonly BotActivityItem[], live: LiveView = SHOW_ALL): BotActivityItem[] {
  return uniqueItems([...items.filter((item) => !item.coding), ...subagents])
    .filter((item) => live.visible(item))
    .sort(newestRunningFirst);
}

function uniqueItems(items: readonly BotActivityItem[]): BotActivityItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export type HistoryStatus = "all" | "running" | "finished" | "failed";

/** The history modal's list: newest first, by status and words. Failed
 * includes stopped work. */
export function historyItems(items: readonly BotActivityItem[], status: HistoryStatus, search: string): BotActivityItem[] {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return uniqueItems(items)
    .filter((item) => {
      if (status === "running" && !activityStatusActive(item.status)) return false;
      if (status === "finished" && item.status !== "finished") return false;
      if (status === "failed" && item.status !== "failed" && item.status !== "stopped") return false;
      if (!words.length) return true;
      const text = [item.title, item.botName, item.startedBy?.name, item.currentStep].filter(Boolean).join(" ").toLowerCase();
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => b.startedAt - a.startedAt);
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
