// The context figures for a floating mascot's energy bar: the very ones the
// chat header's ring shows (src/lib/usage.ts), for the thread the balloon
// follows. The brain puts them in every snapshot, so the bar updates live as
// turns settle, pushed to the window like the rest (no polling).
import { t } from "@/lib/i18n";
import { contextDetail, contextShare } from "@/lib/usage";
import type { TaskUsage } from "@/state/store";
import type { FloatingContext } from "./gauge";

export function floatingContext(usage: TaskUsage | undefined): FloatingContext | null {
  if (!usage) return null;
  const share = contextShare(usage);
  if (!share) return null;
  return {
    ...(share.percent === undefined ? {} : { percent: share.percent }),
    tokens: share.tokens,
    ...(share.window === undefined ? {} : { window: share.window }),
    detail: contextDetail(usage) ?? "",
    label: share.percent === undefined ? (contextDetail(usage) ?? "") : t("floatingBots.context", { percent: String(share.percent) }),
  };
}
