// Context: how much of the model's window the last call filled, from the
// conversation's own usage record. Click opens the bot's Usage details.
import { Gauge } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { dedupeConnectors, mcpServersForBot, useMcpServers } from "@/lib/mcp-servers";
import { contextDetail, contextShare, contextValue, formatTokens, type ContextTone } from "@/lib/usage";
import { registerDevPod, type DevPodContext } from "../registry";

const BUCKETS = ["messages", "tools", "memory", "skills", "agents", "prompt"] as const;
type BucketKey = typeof BUCKETS[number];

export interface ContextData {
  value: string;
  detail: string;
  percent?: number;
  tone: ContextTone;
  /** "N% used, X / max" when the window is a real limit. Absent otherwise. */
  usedOf?: string;
  /** Measured buckets. A missing key was not measured. Never a made-up share. */
  buckets?: Partial<Record<BucketKey, number>>;
  /** Mounted connector names. Absent until the list has loaded. */
  tools?: string[];
}

function measuredBuckets(value: unknown): ContextData["buckets"] {
  if (!value || typeof value !== "object") return undefined;
  const out: Partial<Record<BucketKey, number>> = {};
  for (const key of BUCKETS) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) out[key] = Math.trunc(raw);
  }
  return Object.keys(out).length ? out : undefined;
}

export function contextData(task: DevPodContext["task"]): ContextData | null {
  const usage = task?.usage;
  if (!usage) return null;
  const buckets = measuredBuckets(usage.context?.buckets);
  const share = contextShare(usage);
  if (!share && !buckets) return null;
  const usedOf = share?.window && share.percent !== undefined
    ? t("devPods.context.usedOf", { percent: String(share.percent), tokens: formatTokens(share.tokens), window: formatTokens(share.window) })
    : undefined;
  const value = share ? contextValue(usage) : buckets?.messages !== undefined ? String(buckets.messages) : "";
  return {
    value,
    detail: share ? contextDetail(usage) ?? "" : "",
    ...(share?.percent !== undefined ? { percent: share.percent } : {}),
    tone: share?.tone ?? "quiet",
    ...(usedOf ? { usedOf } : {}),
    ...(buckets ? { buckets } : {}),
  };
}

const BUCKET_LABEL: Record<BucketKey, "devPods.context.messages" | "devPods.context.tools" | "devPods.context.memory" | "devPods.context.skills" | "devPods.context.agents" | "devPods.context.prompt"> = {
  messages: "devPods.context.messages",
  tools: "devPods.context.tools",
  memory: "devPods.context.memory",
  skills: "devPods.context.skills",
  agents: "devPods.context.agents",
  prompt: "devPods.context.prompt",
};

const TONE_TEXT: Record<ContextTone, string> = { quiet: "text-ink-secondary", warning: "text-warning", danger: "text-warning" };
const TONE_BAR: Record<ContextTone, string> = { quiet: "bg-ink-secondary", warning: "bg-warning", danger: "bg-warning" };

function ContextSummary({ data }: { data: ContextData }) {
  return <span data-context-value="" className={cn("shrink-0 text-[12px] tabular-nums", TONE_TEXT[data.tone])}>{data.value}</span>;
}

function ContextBody({ data, ctx }: { data: ContextData; ctx: DevPodContext }) {
  const tools = data.tools;
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => ctx.dispatch({ type: "toggleSettings", open: true, section: "usage", botId: ctx.bot.id })}
        title={t("devPods.context.open")}
        aria-label={`${t("devPods.context.open")}: ${data.usedOf ?? data.detail}`}
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
        <span data-context-detail="" className="truncate text-[12px] text-ink-secondary">{data.usedOf ?? data.detail}</span>
      </button>
      {data.buckets && (
        <ul data-context-buckets="" className="flex flex-col">
          {BUCKETS.filter((key) => data.buckets?.[key] !== undefined).map((key) => (
            <li key={key} data-context-bucket={key} className="text-[12px] text-ink-secondary">
              {key === "messages"
                ? t(BUCKET_LABEL[key], { count: String(data.buckets?.[key]) })
                : t(BUCKET_LABEL[key], { bytes: (data.buckets?.[key] ?? 0).toLocaleString("en-US") })}
            </li>
          ))}
        </ul>
      )}
      {tools && tools.length > 0 && (
        <details data-context-tools="">
          <summary className="cursor-pointer text-[12px] text-ink-secondary">{t("devPods.context.mcpTools", { count: String(tools.length) })}</summary>
          <ul className="mt-1 flex flex-col">
            {tools.map((name) => <li key={name} className="truncate text-[12px] text-ink">{name}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

registerDevPod<ContextData>({
  id: "context",
  order: 20,
  title: () => t("devPods.context.title"),
  icon: Gauge,
  collapsible: false,
  useData: (ctx) => {
    const { servers } = useMcpServers();
    const data = contextData(ctx.task);
    if (!data) return { status: "empty" };
    const tools = servers ? dedupeConnectors(mcpServersForBot(servers, ctx.bot.mcpServers)).map((server) => server.name) : undefined;
    return { status: "ready", data: { ...data, ...(tools ? { tools } : {}) } };
  },
  Summary: ContextSummary,
  Body: ContextBody,
});
