// Display filter for per-tool receipts. Mirrors CompanionCore
// `isToolActivityRow`: Success, Error and running chips stay in the store
// and leave the transcript on iPhone and iPad. Desktop Electron still
// honours Settings > Tool calls.

import type { Message } from "@/state/store";
import { isStatusActivity } from "@/lib/activity-runs";
import { showToolCallsEnabled, type FeatureFlagConfig } from "@/lib/feature-flags";
import { failedTurnCause } from "../../shared/failed-turn";

export type AppleMobileWebEnv = {
  userAgent?: string;
  maxTouchPoints?: number;
  capacitorPlatform?: string | null;
  electron?: boolean;
};

function readAppleMobileWebEnv(): AppleMobileWebEnv {
  const win = typeof window === "undefined" ? undefined : (window as Window & {
    Capacitor?: { getPlatform?: () => string };
  });
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const cap = win?.Capacitor;
  const ogb = win?.ogb;
  return {
    userAgent: nav?.userAgent,
    maxTouchPoints: nav?.maxTouchPoints,
    capacitorPlatform: typeof cap?.getPlatform === "function" ? cap.getPlatform() : null,
    electron: Boolean(ogb?.platform || ogb?.getCapabilities || ogb?.remoteClient),
  };
}

/** Safari / WKWebView / Capacitor on iPhone or iPad. Not the desktop app. */
export function isAppleMobileWebClient(env: AppleMobileWebEnv = readAppleMobileWebEnv()): boolean {
  if (env.electron) return false;
  if (env.capacitorPlatform === "ios") return true;
  const ua = env.userAgent ?? "";
  if (/iPhone|iPod|iPad/.test(ua)) return true;
  // iPadOS 13+ Safari reports as Macintosh with touch.
  return /Macintosh/.test(ua) && (env.maxTouchPoints ?? 0) > 1;
}

/** A per-tool receipt (running, Success, Error). Not a notice, failed turn,
 * parallel card, or a chip that opens another conversation. */
export function isToolActivityRow(message: Message): boolean {
  if (message.kind !== "activity" || !message.tool) return false;
  if (message.parallelTask?.role === "card") return false;
  if (failedTurnCause(message.tool.name) !== null) return false;
  if (isStatusActivity(message)) return false;
  if (message.comm || message.threadRef) return false;
  // A ConnectWise widget is the row. The tool chip stays in the fold.
  if (message.tool.widget) return false;
  return true;
}

/** Tool chips in ChatView / GroupView. Always off on iOS and iPadOS web. */
export function showToolCallRows(
  config: FeatureFlagConfig | null | undefined,
  env: AppleMobileWebEnv = readAppleMobileWebEnv(),
): boolean {
  return showToolCallsEnabled(config) && !isAppleMobileWebClient(env);
}
