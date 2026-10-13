// Agents this bot launched (agent API), in one grouped card like Grok Bot's
// panel: the coding ones under Details > Coding, the rest under Activity.
import { ChevronRight } from "lucide-react";

import { t } from "@/lib/i18n";
import { openExternalLink } from "@/lib/app-links";
import type { BotLaunchedAgentItem } from "../../../shared/bot-launched-agents.ts";
import { ActivityStatusIcon } from "./ActivityCard";

export function LaunchedAgentsList({ items, onOpen, label }: { items: BotLaunchedAgentItem[]; onOpen: (item: BotLaunchedAgentItem) => void; label?: string }) {
  if (!items.length) return null;
  return (
    <ul
      className="overflow-hidden rounded-xl border border-hairline-weak bg-card"
      aria-label={label ?? t("botPanel.coding.title")}
      data-launched-agents
    >
      {items.map((item, index) => (
        <li key={item.id} className={index > 0 ? "border-t border-hairline-weak" : undefined}>
          <LaunchedAgentRow item={item} onOpen={onOpen} />
        </li>
      ))}
    </ul>
  );
}

function LaunchedAgentRow({ item, onOpen }: { item: BotLaunchedAgentItem; onOpen: (item: BotLaunchedAgentItem) => void }) {
  const openable = Boolean(item.threadId);
  return (
    <div className="flex w-full items-center gap-1">
      <button
        type="button"
        data-launched-agent={item.id}
        data-launched-status={item.status}
        disabled={!openable}
        onClick={() => openable && onOpen(item)}
        aria-label={t("botPanel.coding.openAria", { title: item.title })}
        className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-default"
      >
        <ActivityStatusIcon status={item.status} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-[18px] text-ink">{item.title}</span>
          <LaunchedAgentSubtitle item={item} />
        </span>
        {openable && <ChevronRight size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />}
      </button>
    </div>
  );
}

function LaunchedAgentSubtitle({ item }: { item: BotLaunchedAgentItem }) {
  if (item.status === "failed" && item.pullRequest) {
    const pr = item.pullRequest;
    const label = t("botPanel.coding.runFailed", { number: pr.number });
    if (pr.url) {
      return (
        <span data-launched-subtitle className="block truncate text-[12px] leading-[17px] text-ink-secondary">
          {t("botPanel.coding.runFailedPrefix")}
          {" · "}
          <a
            href={pr.url}
            data-launched-pr
            className="underline decoration-ink-secondary/60 underline-offset-2 hover:text-ink"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void openExternalLink(pr.url!);
            }}
          >
            #{pr.number}
          </a>
        </span>
      );
    }
    return <span data-launched-subtitle className="block truncate text-[12px] leading-[17px] text-ink-secondary">{label}</span>;
  }
  if (item.status === "finished") {
    return <span data-launched-subtitle className="block truncate text-[12px] leading-[17px] text-ink-secondary">{t("botPanel.coding.status.finished")}</span>;
  }
  if (item.status === "running") {
    return <span data-launched-subtitle className="block truncate text-[12px] leading-[17px] text-ink-secondary">{t("botPanel.coding.status.running")}</span>;
  }
  return null;
}
