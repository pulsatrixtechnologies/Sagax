import { t } from "@/lib/i18n";

/** The line the nudge button shows when the server says to wait. */
export function nudgeWaitLabel(retryAfterMs: number): string {
  const ms = Math.max(0, retryAfterMs);
  const minutes = Math.ceil(ms / 60_000);
  if (minutes >= 2) return t("nudge.waitMinutes", { count: minutes });
  if (ms >= 60_000) return t("nudge.waitMinute");
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return t("nudge.waitSeconds", { count: seconds });
}
