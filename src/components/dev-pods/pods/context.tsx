// Context: how much of the model's window the last call filled, from the
// conversation's own usage record. Click opens the bot's Usage details.
import { Gauge } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { contextDetail, contextShare, contextValue, type ContextTone } from "@/lib/usage";
import { registerDevPod, type DevPodContext } from "../registry";

export interface ContextData {
  value: string;
  detail: string;
  percent?: number;
  tone: ContextTone;
}

export function contextData(task: DevPodContext["task"]): ContextData | null {
  const usage = task?.usage;
  if (!usage) return null;
  const share = contextShare(usage);
  if (!share) return null;
  return { value: contextValue(usage), detail: contextDetail(usage) ?? "", percent: share.percent, tone: share.tone };
}

const TONE_TEXT: Record<ContextTone, string> = { quiet: "text-ink-secondary", warning: "text-warning", danger: "text-warning" };
const TONE_BAR: Record<ContextTone, string> = { quiet: "bg-ink-secondary", warning: "bg-warning", danger: "bg-warning" };

function ContextSummary({ data }: { data: ContextData }) {
  return <span data-context-value="" className={cn("shrink-0 text-[12px] tabular-nums", TONE_TEXT[data.tone])}>{data.value}</span>;
}

function ContextBody({ data, ctx }: { data: ContextData; ctx: DevPodContext }) {
  return (
    <button
      type="button"
      onClick={() => ctx.dispatch({ type: "toggleSettings", open: true, section: "usage", botId: ctx.bot.id })}
      title={t("devPods.context.open")}
      aria-label={`${t("devPods.context.open")}: ${data.detail}`}
      className="-mx-1 flex w-[calc(100%+0.5rem)] flex-col gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-hover"
    >
      {data.percent !== undefined && (
        <span
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, data.percent)}
          aria-label={t("devPods.context.title")}
          className="block h-1 w-full overflow-hidden rounded-full bg-hover"
        >
          <span data-context-bar={data.tone} className={cn("block h-full rounded-full", TONE_BAR[data.tone])} style={{ width: `${Math.min(100, data.percent)}%` }} />
        </span>
      )}
      <span className="truncate text-[12px] text-ink-secondary">{data.detail}</span>
    </button>
  );
}

registerDevPod<ContextData>({
  id: "context",
  order: 20,
  title: () => t("devPods.context.title"),
  icon: Gauge,
  collapsible: false,
  useData: (ctx) => {
    const data = contextData(ctx.task);
    return data ? { status: "ready", data } : { status: "empty" };
  },
  Summary: ContextSummary,
  Body: ContextBody,
});
