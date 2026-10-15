// A bot's own parallel conversations, automatic recovery and busy-send
// default (server/bot-runtime-settings.ts, JC 2026-10-15). A bot without a
// value of its own reads the server default (Settings no longer edits it);
// busySend falls back to the person's own earlier choice.
import type { BusySendPreference } from "../../shared/parallel-tasks";
import { DEFAULT_MAX_PARALLEL_PER_PERSON } from "../../shared/parallel-tasks";
import type { Bot, ConfigStatus } from "@/state/store";

type RuntimeBot = Pick<Bot, "maxConcurrentThreads" | "maxParallelPerPerson" | "busySend" | "automaticRecovery">;
type RuntimeConfig = Pick<ConfigStatus, "threads" | "automaticRecovery"> | null | undefined;

export type BotRecovery = NonNullable<Bot["automaticRecovery"]>;

export interface BotRuntimePatch {
  maxConcurrentThreads?: number;
  maxParallelPerPerson?: number;
  busySend?: BusySendPreference;
  automaticRecovery?: BotRecovery;
}

export const BOT_THREAD_LIMITS = Array.from({ length: 10 }, (_, i) => i + 1);

export function botThreadLimit(bot: RuntimeBot, config: RuntimeConfig): number {
  return bot.maxConcurrentThreads ?? config?.threads?.maxConcurrentPerBot ?? 3;
}

export function botParallelLimit(bot: RuntimeBot, config: RuntimeConfig): number {
  return bot.maxParallelPerPerson ?? config?.threads?.maxParallelPerPerson ?? DEFAULT_MAX_PARALLEL_PER_PERSON;
}

export function botRecovery(bot: RuntimeBot, config: RuntimeConfig): BotRecovery {
  return bot.automaticRecovery ?? config?.automaticRecovery ?? { enabled: false };
}

/** What a message sent while this bot works does: the bot's own choice,
 * else the person's own earlier default. */
export function botBusySend(bot: Pick<Bot, "busySend"> | null | undefined, personal: BusySendPreference): BusySendPreference {
  return bot?.busySend ?? personal;
}

export function botRuntimeSettingsPath(botId: string): string {
  return `/api/bots/${encodeURIComponent(botId)}/runtime-settings`;
}

export function botToolGrantsPath(botId: string, grantId?: string): string {
  const base = `/api/bots/${encodeURIComponent(botId)}/tool-grants`;
  return grantId ? `${base}/${encodeURIComponent(grantId)}/revoke` : base;
}
