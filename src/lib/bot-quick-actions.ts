// Bot actions offered in more than one place (the sidebar row menu, the
// mascot menu in the bot panel, the persona editor's Overview): one request
// each, so every entry point saves the same way.
import { api, type Bot, type ConfigStatus } from "@/state/store";
import type { LocaleKey } from "@/locales";
import { canStepPrimary } from "./bot-capabilities";
import { isViewersPrimaryBot, viewerOwnsBot } from "./primary-bot";
import { viewerActorId } from "./viewer";

/** One Primary Bot per person: the server hands the role over from the
 * previous one (POST /api/bots/:id/primary) and sends both bots' frames. */
export async function requestPrimaryBot(botId: string): Promise<Bot> {
  const response = await api<{ bot: Bot }>(`/api/bots/${botId}/primary`, { method: "POST" });
  return response.bot;
}

/** Archive writes `hidden` (PATCH /api/bots/:id). */
export async function requestBotHidden(botId: string, hidden: boolean): Promise<Bot> {
  const response = await api<{ bot: Bot }>(`/api/bots/${botId}`, {
    method: "PATCH",
    body: JSON.stringify({ hidden }),
  });
  return response.bot;
}

/** Whether "Make primary bot" may run for this bot, and why not. */
export function primaryBotOffer(
  config: ConfigStatus | null | undefined,
  bot: Bot,
): { allowed: true } | { allowed: false; reason: LocaleKey } {
  const viewerId = viewerActorId(config);
  if (isViewersPrimaryBot(bot, viewerId)) return { allowed: false, reason: "persona.primary.already" };
  if (bot.hidden) return { allowed: false, reason: "persona.primary.archived" };
  if (!canStepPrimary(config, bot) || !viewerOwnsBot(bot, viewerId)) return { allowed: false, reason: "persona.primary.ownerOnly" };
  return { allowed: true };
}

/** Why archiving this bot is blocked right now, or null. */
export function archiveBlockReason(bots: readonly Bot[], bot: Bot): LocaleKey | null {
  if (bot.chiefOfStaff) return "sidebar.bot.archiveBlockedChief";
  if (bots.filter((candidate) => !candidate.hidden).length <= 1) return "sidebar.bot.archiveBlockedLast";
  return null;
}
