// Client side of the bot panel's Coding list (shared/bot-activity.ts,
// server/routes/bot-activity.ts): fetches, labels and times.
import type { LocaleKey } from "@/locales";
import { t } from "@/lib/i18n";
import type {
  BotActivityDetail,
  BotActivityItem,
  BotActivityStatus,
  BotActivityStep,
} from "../../shared/bot-activity";

export type { BotActivityDetail, BotActivityItem, BotActivityStatus, BotActivityStep };
export { activityStatusActive } from "../../shared/bot-activity";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;

export async function loadBotActivity(api: Api, botId: string): Promise<BotActivityItem[]> {
  const { items } = await api<{ items: BotActivityItem[] }>(`/api/bots/${encodeURIComponent(botId)}/activity`);
  return items;
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

/** The card's second line: the status, plus who handed it over when a bot did. */
export function activitySubtitle(item: BotActivityItem): string {
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
