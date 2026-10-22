// The bot's own email address (B21, contract C of 2026-10-21):
// GET /api/bots/:id/inbound-mail answers { available, address, enabled },
// from the Perspicax relay (server/bot-mail-addresses.ts). Nothing is shown
// while it loads, on a solo server, or when the read fails.
import { useEffect, useState } from "react";

import { api } from "@/state/store";

export interface BotInboundMail {
  available: boolean;
  address: string | null;
  enabled: boolean;
}

export const NO_BOT_MAIL: BotInboundMail = { available: false, address: null, enabled: false };
const ADDRESS = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9.-]{1,253}$/;

/** The answer when it is the contract's and names an address, else none. */
export function botInboundMailFrom(response: unknown): BotInboundMail {
  if (!response || typeof response !== "object" || Array.isArray(response)) return NO_BOT_MAIL;
  const { available, address, enabled } = response as Record<string, unknown>;
  if (available !== true || typeof address !== "string" || address.length > 320 || !ADDRESS.test(address)) return NO_BOT_MAIL;
  return { available: true, address, enabled: enabled === true };
}

/** Null while loading (and for no bot); a late answer for another bot is dropped. */
export function useBotInboundMail(botId: string | null | undefined): BotInboundMail | null {
  const [loaded, setLoaded] = useState<{ botId: string; mail: BotInboundMail } | null>(null);
  useEffect(() => {
    if (!botId) return;
    const controller = new AbortController();
    void api(`/api/bots/${encodeURIComponent(botId)}/inbound-mail`, { signal: controller.signal, timeoutMs: 10_000 })
      .then((response: unknown) => {
        if (!controller.signal.aborted) setLoaded({ botId, mail: botInboundMailFrom(response) });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ botId, mail: NO_BOT_MAIL });
      });
    return () => controller.abort();
  }, [botId]);
  return botId && loaded?.botId === botId ? loaded.mail : null;
}
