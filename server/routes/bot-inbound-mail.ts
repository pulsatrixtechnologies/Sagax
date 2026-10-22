// GET /api/bots/:id/inbound-mail (contract C, 2026-10-21, B21 / iOS CO5):
// the bot's own email address, given by the Perspicax relay
// (server/bot-mail-addresses.ts), for the bot profile row and the botmail
// trigger editor. `{ available, address, enabled }`: `available: false` on a
// solo server, an older Perspicax, inbound mail off, or any failure (the app
// then shows nothing). The address is not an id; it may be shown and copied.
// Client-scoped in server/request-auth.ts; the bot visibility check every
// client route passes (bot-visibility.ts pathSubject) answers a hidden bot
// as missing before this runs.
import { NO_BOT_MAIL, type BotInboundMail } from "../bot-mail-addresses.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotInboundMailReadDeps {
  bot(id: string): { id: string } | null | undefined;
  /** An organization server linked to Perspicax. */
  organization(): boolean;
  address(botId: string): Promise<BotInboundMail>;
}

export function createBotInboundMailReadRoutes(deps: BotInboundMailReadDeps): RouteHandler {
  return async ({ res, path, method, json }) => {
    const m = /^\/api\/bots\/([\w-]+)\/inbound-mail$/.exec(path);
    if (!m || method !== "GET") return PASS;
    const bot = deps.bot(m[1]!);
    if (!bot) return json(res, 404, { error: "no such bot" });
    res.setHeader("cache-control", "no-store");
    if (!deps.organization()) return json(res, 200, NO_BOT_MAIL);
    let answer: BotInboundMail = NO_BOT_MAIL;
    try {
      answer = await deps.address(bot.id);
    } catch {
      answer = NO_BOT_MAIL;
    }
    return json(res, 200, { available: answer.available, address: answer.address, enabled: answer.enabled });
  };
}
