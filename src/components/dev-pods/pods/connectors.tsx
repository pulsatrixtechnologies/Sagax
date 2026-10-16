// Connectors: the MCP servers this bot mounts (Plugins > MCP servers and the
// bot's own list), read from the list the Access section already uses.
import { useState } from "react";
import { Plug } from "lucide-react";
import { t } from "@/lib/i18n";
import { mcpServersForBot, useMcpServers, type McpServerSummary } from "@/lib/mcp-servers";
import { Github, Slack } from "../../brand-icons";
import { registerDevPod, type DevPodContext } from "../registry";

export const CONNECTORS_SHOWN = 3;

function ConnectorIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  if (lower.includes("github")) return <Github size={14} aria-hidden="true" className="shrink-0 text-ink" />;
  if (lower.includes("slack")) return <Slack size={14} aria-hidden="true" className="shrink-0 text-ink" />;
  return (
    <span aria-hidden="true" className="flex size-[18px] shrink-0 items-center justify-center rounded-md bg-hover text-[10px] font-semibold uppercase text-ink-secondary">
      {name.trim().charAt(0) || "?"}
    </span>
  );
}

function ConnectorsBody({ data, ctx }: { data: McpServerSummary[]; ctx: DevPodContext }) {
  const [all, setAll] = useState(false);
  const shown = all ? data : data.slice(0, CONNECTORS_SHOWN);
  return (
    <div className="flex flex-col gap-0.5">
      <ul className="flex flex-col gap-0.5">
        {shown.map((server) => (
          <li key={server.name} data-connector={server.name}>
            <button
              type="button"
              onClick={() => ctx.dispatch({ type: "togglePlugins", open: true, surface: "mcp", botId: ctx.bot.id })}
              className="-mx-1 flex min-h-[28px] w-[calc(100%+0.5rem)] items-center gap-2 rounded-md px-1 text-left hover:bg-hover"
            >
              <ConnectorIcon name={server.name} />
              <span className="min-w-0 flex-1 truncate text-ink">{server.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {data.length > CONNECTORS_SHOWN && (
        <button type="button" data-connectors-more="" onClick={() => setAll((value) => !value)} className="self-start rounded-md px-1 py-0.5 text-[12px] text-ink-secondary hover:bg-hover hover:text-ink">
          {all ? t("devPods.connectors.less") : t("devPods.connectors.more")}
        </button>
      )}
    </div>
  );
}

registerDevPod<McpServerSummary[]>({
  id: "connectors",
  order: 30,
  title: () => t("devPods.connectors.title"),
  icon: Plug,
  collapsible: true,
  useData: (ctx) => {
    const { servers, error, refresh } = useMcpServers();
    if (servers === null) return error ? { status: "error", retry: () => void refresh() } : { status: "loading" };
    const mounted = mcpServersForBot(servers, ctx.bot.mcpServers);
    return mounted.length ? { status: "ready", data: mounted } : { status: "empty" };
  },
  Body: ConnectorsBody,
});
