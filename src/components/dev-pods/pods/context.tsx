// Context: how much of the model's window the last call filled, from the
// conversation's own usage record. Click opens the bot's Usage details.
import { Gauge } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { dedupeConnectors, mcpServersForBot, useMcpServers } from "@/lib/mcp-servers";
import { contextDetail, contextShare, contextValue, formatTokens, type ContextTone } from "@/lib/usage";
import { registerDevPod, type DevPodContext } from "../registry";

export interface ContextData {
  value: string;
  detail: string;
  percent?: number;
  tone: ContextTone;
  /** "N% used, X / max" when the window is a real limit. Absent otherwise. */
  usedOf?: string;
  /** Bytes of the assembled system prompt, when the server measured it. */
  promptBytes?: number;
  /** Mounted connector names. Absent until the list has loaded. */
  tools?: string[];
}

export function contextData(task: DevPodContext["task"]): ContextData | null {
  const usage = task?.usage;
  if (!usage) return null;
  const share = contextShare(usage);
  if (!share) return null;
  const promptBytes = usage.context?.promptBytes;
  const usedOf = share.window && share.percent !== undefined
    ? t("devPods.context.usedOf", { percent: String(share.percent), tokens: formatTokens(share.tokens), window: formatTokens(share.window) })
    : undefined;
  return {
    value: contextValue(usage),
    detail: contextDetail(usage) ?? "",
    percent: share.percent,
    tone: share.tone,
    ...(usedOf ? { usedOf } : {}),
    ...(typeof promptBytes === "number" && promptBytes > 0 ? { promptBytes } : {}),
  };
}

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
      {data.promptBytes !== undefined && (
        <p data-context-prompt="" className="text-[12px] text-ink-secondary">{t("devPods.context.systemPrompt", { bytes: data.promptBytes.toLocaleString("en-US") })}</p>
      )}
      <p data-context-unsplit="" className="text-[12px] text-ink-secondary">{t("devPods.context.notSplit")}</p>
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
