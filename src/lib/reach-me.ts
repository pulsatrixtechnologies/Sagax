// "Me joindre" on the bot page (2026-10-26): GET/PUT /api/bots/:id/reach-me,
// the Telegram link and the WhatsApp Business number
// (server/routes/reach-me.ts). Nothing is shown while it loads or when the
// read fails.
import { useEffect, useState } from "react";

import { DEFAULT_REACH_ME, REACH_CHANNELS, type ReachChannelId, type ReachMeSettings } from "../../shared/reach-me";
import { api } from "@/state/store";

export interface ReachChannelView {
  ready: boolean;
  reason?: string;
  devices?: number;
  connected?: boolean;
  username?: string;
  linking?: boolean;
  /** WhatsApp (server/reach-me/whatsapp.ts WhatsAppView): never a token, an
   * app secret or the Phone Number ID. */
  displayNumber?: string;
  verifiedName?: string;
  number?: string;
  linkUrl?: string;
  linkCode?: string;
  codeSentTo?: string;
  webhookUrl?: string;
  verifyToken?: string;
  webhookPublic?: boolean;
  replies?: boolean;
  hasAppSecret?: boolean;
  templateName?: string;
  templateLanguage?: string;
  windowOpen?: boolean;
}

export interface ReachMeView {
  saved: boolean;
  settings: ReachMeSettings;
  channels: Record<ReachChannelId, ReachChannelView>;
}

const NO_CHANNEL: ReachChannelView = { ready: false };

/** The answer when it is the route's, else null. */
export function reachMeFrom(response: unknown): ReachMeView | null {
  if (!response || typeof response !== "object" || Array.isArray(response)) return null;
  const { saved, settings, channels } = response as Record<string, unknown>;
  if (!settings || typeof settings !== "object" || !Array.isArray((settings as ReachMeSettings).channels)) return null;
  const rawChannels = channels && typeof channels === "object" ? channels as Record<string, ReachChannelView> : {};
  const views = Object.fromEntries(REACH_CHANNELS.map((id) => [id, { ...NO_CHANNEL, ...rawChannels[id] }])) as Record<ReachChannelId, ReachChannelView>;
  return { saved: saved === true, settings: settings as ReachMeSettings, channels: views };
}

export function useReachMe(botId: string | null | undefined): [ReachMeView | null, (view: ReachMeView) => void] {
  const [loaded, setLoaded] = useState<{ botId: string; view: ReachMeView | null } | null>(null);
  useEffect(() => {
    if (!botId) return;
    const controller = new AbortController();
    void api(`/api/bots/${encodeURIComponent(botId)}/reach-me`, { signal: controller.signal, timeoutMs: 10_000 })
      .then((response: unknown) => { if (!controller.signal.aborted) setLoaded({ botId, view: reachMeFrom(response) }); })
      .catch(() => { if (!controller.signal.aborted) setLoaded({ botId, view: null }); });
    return () => controller.abort();
  }, [botId]);
  const set = (view: ReachMeView) => { if (botId) setLoaded({ botId, view }); };
  return [botId && loaded?.botId === botId ? loaded.view : null, set];
}

type Result = { ok: true; view: ReachMeView; link?: string } | { ok: false; error: string; field?: string };

async function call(path: string, init: { method: string; body?: unknown }): Promise<Result> {
  try {
    const response = await api(path, { method: init.method, ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}), timeoutMs: 20_000 }) as Record<string, unknown>;
    const view = reachMeFrom(response);
    if (!view) return { ok: false, error: "unavailable" };
    return { ok: true, view, ...(typeof response.link === "string" ? { link: response.link } : {}) };
  } catch (cause) {
    const body = (cause as { body?: { error?: unknown; field?: unknown } } | null)?.body;
    return { ok: false, error: typeof body?.error === "string" ? body.error : "unavailable", ...(typeof body?.field === "string" ? { field: body.field } : {}) };
  }
}

export const saveReachMe = (botId: string, settings: ReachMeSettings) => call(`/api/bots/${encodeURIComponent(botId)}/reach-me`, { method: "PUT", body: settings });
export const connectReachTelegram = (botId: string, token: string) => call(`/api/bots/${encodeURIComponent(botId)}/reach-me/telegram`, { method: "POST", body: { token } });
export const disconnectReachTelegram = (botId: string) => call(`/api/bots/${encodeURIComponent(botId)}/reach-me/telegram`, { method: "DELETE" });

/** One step of the WhatsApp setup, as the bot page asks it. */
export type ReachWhatsAppStep =
  | { kind: "connect"; accessToken: string; phoneNumberId: string; appSecret?: string; templateName?: string; templateLanguage?: string }
  | { kind: "update"; templateName?: string; templateLanguage?: string; appSecret?: string }
  | { kind: "link"; number?: string; code?: string }
  | { kind: "disconnect" };

export function reachWhatsApp(botId: string, step: ReachWhatsAppStep) {
  const path = `/api/bots/${encodeURIComponent(botId)}/reach-me/whatsapp`;
  const { kind, ...body } = step;
  if (kind === "disconnect") return call(path, { method: "DELETE" });
  if (kind === "link") return call(`${path}/link`, { method: "POST", body });
  return call(path, { method: kind === "update" ? "PUT" : "POST", body });
}

/** The browser's own time zone, for a first range. */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Toronto";
  } catch {
    return "America/Toronto";
  }
}

export { DEFAULT_REACH_ME };
