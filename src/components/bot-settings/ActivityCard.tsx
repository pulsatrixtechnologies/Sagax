// One Coding entry as a rounded card (status icon, truncated title, status
// line, chevron) and the status icon the detail modal reuses.
import { AlertCircle, CheckCircle2, ChevronRight, CircleSlash, Clock, Hand, Loader2 } from "lucide-react";

import { t } from "@/lib/i18n";
import { activitySubtitle, type BotActivityItem, type BotActivityStatus } from "@/lib/bot-activity";

export function ActivityStatusIcon({ status, size = 16 }: { status: BotActivityStatus; size?: number }) {
  const common = { size, strokeWidth: 1.9, "aria-hidden": true as const, className: "shrink-0" };
  switch (status) {
    case "running":
      return <Loader2 {...common} data-activity-icon="running" className="shrink-0 animate-spin text-accent-text" />;
    case "waiting":
      return <Hand {...common} data-activity-icon="waiting" className="shrink-0 text-warning" />;
    case "queued":
      return <Clock {...common} data-activity-icon="queued" className="shrink-0 text-ink-secondary" />;
    case "failed":
      return <AlertCircle {...common} data-activity-icon="failed" className="shrink-0 text-danger" />;
    case "stopped":
      return <CircleSlash {...common} data-activity-icon="stopped" className="shrink-0 text-ink-secondary" />;
    default:
      return <CheckCircle2 {...common} data-activity-icon="finished" className="shrink-0 text-success" />;
  }
}

export function ActivityCard({ item, onOpen }: { item: BotActivityItem; onOpen: (item: BotActivityItem) => void }) {
  return (
    <button
      type="button"
      data-activity-card={item.id}
      data-activity-status={item.status}
      onClick={() => onOpen(item)}
      aria-label={t("botPanel.coding.openAria", { title: item.title })}
      className="flex w-full items-center gap-3 rounded-xl border border-hairline-weak bg-card px-3 py-2.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
    >
      <ActivityStatusIcon status={item.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[18px] text-ink">{item.title}</span>
        <span className="block truncate text-[12px] leading-[17px] text-ink-secondary">
          {activitySubtitle(item)}
          {item.childCount ? ` · ${t("botPanel.coding.subagents", { count: item.childCount })}` : ""}
        </span>
      </span>
      <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />
    </button>
  );
}
