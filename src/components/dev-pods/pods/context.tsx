// Context: how full the model's window is after the last call, from the
// conversation's own usage record, and what fills it, in tokens. One bar
// spans the whole window: a colored segment per part (the prompt, Sagax's
// tools, memory, skills, agents, the messages, and what the engine adds),
// the rest is free. The parts are estimates from measured sizes
// (context-breakdown.ts); the total is the model's own reading. The raw
// sizes, the message count and the MCP servers of the turn stay one click
// away. A high reading offers Compact and New conversation.
import { useRef, useState } from "react";
import { ChevronRight, Gauge } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { CHART_PALETTE } from "@/lib/chart-palette";
import { contextShare, formatTokens, type ContextTone } from "@/lib/usage";
import { api } from "@/state/store";
import { normalizeTurnConnectors } from "../../../../shared/turn-connectors";
import { useSkinScheme } from "../../rich-ui";
import { contextBreakdown, type BreakdownKey, type BreakdownPart, type ContextBucketsInput } from "../context-breakdown";
import { registerDevPod, type DevPodContext } from "../registry";

export interface ContextData {
  /** The tokens the model reported, and its window when known. */
  tokens?: number;
  window?: number;
  percent?: number;
  tone: ContextTone;
  parts: BreakdownPart[];
  /** The measured sizes as the server sent them (bytes, and a message count). */
  buckets?: ContextBucketsInput;
  /** MCP servers this turn mounted (not account connectors). */
  servers: string[];
}

const RAW_KEYS = ["messages", "messageBytes", "prompt", "tools", "memory", "skills", "agents"] as const;

function measuredBuckets(value: unknown): ContextBucketsInput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const out: Record<string, number> = {};
  for (const key of RAW_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) out[key] = Math.trunc(raw);
  }
  return Object.keys(out).length ? out as ContextBucketsInput : undefined;
}

export function contextData(task: DevPodContext["task"]): ContextData | null {
  const usage = task?.usage;
  if (!usage) return null;
  const buckets = measuredBuckets(usage.context?.buckets);
  const share = contextShare(usage);
  if (!share && !buckets) return null;
  const record = normalizeTurnConnectors(task?.connectors);
  const servers = (record?.connectors ?? [])
    .filter((connector) => connector.source !== "claude" && connector.source !== "grok" && connector.source !== "plugin" && connector.state === "connected")
    .map((connector) => connector.name);
  return {
    ...(share ? { tokens: share.tokens } : {}),
    ...(share?.window ? { window: share.window } : {}),
    ...(share?.percent !== undefined ? { percent: share.percent } : {}),
    tone: share?.tone ?? "quiet",
    parts: contextBreakdown(buckets, share?.tokens),
    ...(buckets ? { buckets } : {}),
    servers,
  };
}

const RAW_LABEL: Record<"prompt" | "tools" | "memory" | "skills" | "agents" | "messageBytes", LocaleKey> = {
  prompt: "devPods.context.raw.prompt",
  tools: "devPods.context.raw.tools",
  memory: "devPods.context.raw.memory",
  skills: "devPods.context.raw.skills",
  agents: "devPods.context.raw.agents",
  messageBytes: "devPods.context.raw.messageBytes",
};

const PART_LABEL: Record<BreakdownKey, LocaleKey> = {
  prompt: "devPods.context.part.prompt",
  tools: "devPods.context.part.tools",
  memory: "devPods.context.part.memory",
  skills: "devPods.context.part.skills",
  agents: "devPods.context.part.agents",
  messages: "devPods.context.part.messages",
  engine: "devPods.context.part.engine",
};

/** One fixed, distinct palette slot per part, whatever is present; what the
 * engine adds on its own stays neutral. */
const PART_SLOT: Record<Exclude<BreakdownKey, "engine">, number> = { prompt: 0, tools: 1, memory: 2, skills: 3, agents: 4, messages: 6 };
function partColor(key: BreakdownKey, scheme: "light" | "dark"): string {
  if (key === "engine") return scheme === "dark" ? "#6b7280" : "#9ca3af";
  return CHART_PALETTE[scheme][PART_SLOT[key]]!;
}

const TONE_TEXT: Record<ContextTone, string> = { quiet: "text-ink-secondary", warning: "text-warning", danger: "text-danger" };

function ContextSummary({ data }: { data: ContextData }) {
  const value = data.percent !== undefined ? `${data.percent} %` : data.tokens ? formatTokens(data.tokens) : "";
  return <span data-context-value="" className={cn("shrink-0 text-[12px] tabular-nums", TONE_TEXT[data.tone])}>{value}</span>;
}

const ACTION = "rounded-md px-1.5 py-0.5 text-[12px] font-medium text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-50";

function ContextBody({ data, ctx }: { data: ContextData; ctx: DevPodContext }) {
  const ref = useRef<HTMLDivElement>(null);
  const scheme = useSkinScheme(ref);
  const [compact, setCompact] = useState<"idle" | "sent" | "failed">("idle");
  // the bar spans the window when it is known, else the tokens used
  const span = data.window ?? data.tokens ?? data.parts.reduce((sum, part) => sum + part.tokens, 0);
  const headline = data.tokens !== undefined
    ? data.window && data.percent !== undefined
      ? t("devPods.context.headline", { percent: String(data.percent), tokens: formatTokens(data.tokens), window: formatTokens(data.window) })
      : t("devPods.context.headlineNoWindow", { tokens: formatTokens(data.tokens) })
    : t("devPods.context.headlineMeasured");
  const high = data.tone !== "quiet";
  const runCompact = () => {
    setCompact("sent");
    api(`/api/bots/${encodeURIComponent(ctx.bot.id)}/compact`, { method: "POST", body: JSON.stringify({ threadId: ctx.bot.threadId }) })
      .catch(() => setCompact("failed"));
  };
  return (
    <div ref={ref} className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-1.5">
        <span data-context-detail="" className={cn("text-[12.5px] tabular-nums", high ? TONE_TEXT[data.tone] : "text-ink")}>{headline}</span>
        {span > 0 && (
          <span
            role="meter"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, data.percent ?? 100)}
            aria-label={t("devPods.context.title")}
            aria-valuetext={headline}
            data-context-bar={data.tone}
            className="flex h-2 w-full overflow-hidden rounded-full bg-hover"
          >
            {data.parts.length
              ? data.parts.map((part) => (
                <span
                  key={part.key}
                  data-context-segment={part.key}
                  className="block h-full first:rounded-l-full"
                  style={{ width: `${Math.min(100, (part.tokens / span) * 100)}%`, backgroundColor: partColor(part.key, scheme) }}
                />
              ))
              : <span className={cn("block h-full rounded-full", high ? "bg-warning" : "bg-ink-secondary")} style={{ width: `${Math.min(100, data.percent ?? 0)}%` }} />}
          </span>
        )}
      </div>
      {data.parts.length > 0 && (
        <ul data-context-parts="" className="flex flex-col gap-1">
          {data.parts.map((part) => (
            <li key={part.key} data-context-part={part.key} className="grid grid-cols-[10px_minmax(0,1fr)_auto_2.75rem] items-center gap-x-2 text-[12px]">
              <span aria-hidden="true" className="size-2 rounded-[3px]" style={{ backgroundColor: partColor(part.key, scheme) }} />
              <span className="min-w-0 break-words text-ink">{t(PART_LABEL[part.key])}</span>
              <span className="tabular-nums text-ink-secondary">≈ {formatTokens(part.tokens)}</span>
              <span className="text-right tabular-nums text-ink-secondary">{part.percent} %</span>
            </li>
          ))}
        </ul>
      )}
      {high && (
        <div data-context-actions="" className="flex flex-wrap items-center gap-1">
          <button type="button" data-context-compact="" disabled={compact === "sent"} onClick={runCompact} className={ACTION}>
            {compact === "sent" ? t("devPods.context.compacting") : t("devPods.context.compact")}
          </button>
          <button type="button" data-context-new="" onClick={() => ctx.dispatch({ type: "newTask", botId: ctx.bot.id })} className={ACTION}>
            {t("devPods.context.newConversation")}
          </button>
          {compact === "failed" && <span className="text-[12px] text-danger">{t("devPods.context.compactFailed")}</span>}
        </div>
      )}
      <details data-context-details="" className="group/ctx">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-[12px] text-ink-secondary hover:text-ink [&::-webkit-details-marker]:hidden">
          <ChevronRight size={12} aria-hidden="true" className="transition-transform group-open/ctx:rotate-90" />
          {t("devPods.context.details")}
        </summary>
        <div className="mt-1.5 flex flex-col gap-2 pl-4 text-[12px] text-ink-secondary">
          {data.parts.length > 0 && <p>{t("devPods.context.estimateNote")}</p>}
          {data.buckets && (
            <dl data-context-raw="" className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5">
              {data.buckets.messages !== undefined && (<><dt>{t("devPods.context.raw.messages")}</dt><dd className="text-right tabular-nums">{data.buckets.messages.toLocaleString()}</dd></>)}
              {(["prompt", "tools", "memory", "skills", "agents", "messageBytes"] as const).filter((key) => data.buckets?.[key] !== undefined).map((key) => (
                <div key={key} className="contents">
                  <dt>{t(RAW_LABEL[key])}</dt>
                  <dd className="text-right tabular-nums">{t("devPods.context.raw.bytes", { bytes: (data.buckets?.[key] ?? 0).toLocaleString() })}</dd>
                </div>
              ))}
            </dl>
          )}
          {data.servers.length > 0 && (
            <div data-context-servers="">
              <p className="text-ink-secondary">{t("devPods.context.mcpServers", { count: String(data.servers.length) })}</p>
              <ul className="mt-0.5 flex flex-col">
                {data.servers.map((name) => <li key={name} className="break-words text-ink [overflow-wrap:anywhere]">{name}</li>)}
              </ul>
            </div>
          )}
          <button
            type="button"
            data-context-usage=""
            onClick={() => ctx.dispatch({ type: "toggleSettings", open: true, section: "usage", botId: ctx.bot.id })}
            className="self-start rounded-md py-0.5 text-[12px] font-medium text-accent-text hover:underline"
          >
            {t("devPods.context.open")}
          </button>
        </div>
      </details>
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
    const data = contextData(ctx.task);
    return data ? { status: "ready", data } : { status: "empty" };
  },
  Summary: ContextSummary,
  Body: ContextBody,
});
