// Where bots work for the signed-in person on an organization server: their
// own computer through this desktop app (the desktop bridge), or their server
// environment (server/desktop-bridge-routes.ts, shared/bot-workplace.ts).
// The preference is a synced localStorage key (src/lib/user-preferences-sync.ts
// saves it for the person); the status comes from GET /api/me/desktop-bridge,
// which a solo server answers 404 (then nothing here shows).
import { useEffect, useState } from "react";

import { BOT_WORKPLACE_PREFERENCE, parseBotWorkplace, serializeBotWorkplace, type BotWorkplace } from "../../shared/bot-workplace";

export interface DesktopBridgeActivity {
  at: number;
  target: string;
  kind: "tool" | "network" | "connect";
  detail: string;
  ok: boolean;
  error?: string;
}

export interface DesktopBridgeStatus {
  connected: boolean;
  tunnel: boolean;
  desktops: { id: string; name: string; platform: string; online: boolean; busy: boolean; lastSeenAt: number }[];
  workplace: BotWorkplace;
  activity: DesktopBridgeActivity[];
}

/** Null where there is no bridge (a solo server, no person); throws when
 * the server could not be asked right now. */
export async function loadDesktopBridge(fetchImpl: typeof fetch = fetch): Promise<DesktopBridgeStatus | null> {
  const response = await fetchImpl("/api/me/desktop-bridge", { credentials: "same-origin", cache: "no-store" });
  if (response.status === 404 || response.status === 403) return null;
  if (!response.ok) throw new Error(`desktop bridge status ${response.status}`);
  return await response.json() as DesktopBridgeStatus;
}

export function readWorkplace(storage: Pick<Storage, "getItem"> = localStorage): BotWorkplace {
  try { return parseBotWorkplace(storage.getItem(BOT_WORKPLACE_PREFERENCE)); } catch { return parseBotWorkplace(null); }
}

export function writeWorkplace(value: BotWorkplace, storage: Pick<Storage, "setItem"> = localStorage): void {
  try { storage.setItem(BOT_WORKPLACE_PREFERENCE, serializeBotWorkplace(value)); } catch { /* storage refused */ }
}

/** What the composer says about where this person's bots work right now. */
export type WorkplaceNoticeKind = "computer" | "fallback" | null;

export function workplaceNotice(status: DesktopBridgeStatus | null, workplace: BotWorkplace): WorkplaceNoticeKind {
  if (!status) return null;
  if (workplace.place === "server") return null;
  return status.connected ? "computer" : "fallback";
}

/** The person's bridge status, refreshed while shown (organization only). */
export function useDesktopBridgeStatus(refreshMs = 20_000): DesktopBridgeStatus | null {
  const [status, setStatus] = useState<DesktopBridgeStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    let stopped = false;
    const load = async () => {
      let next: DesktopBridgeStatus | null;
      try { next = await loadDesktopBridge(); } catch { return; /* keep the last answer */ }
      if (cancelled) return;
      setStatus(next);
      // A solo server has no bridge: stop asking.
      if (next === null) stopped = true;
    };
    void load();
    const timer = window.setInterval(() => { if (!stopped && document.visibilityState !== "hidden") void load(); }, refreshMs);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [refreshMs]);
  return status;
}
