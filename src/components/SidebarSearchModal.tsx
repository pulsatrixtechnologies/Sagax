import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { useStore, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

function blurb(bot: Bot): string {
  const description = bot.description?.trim().replace(/\s+/g, " ");
  if (description) return description;
  const line = bot.soul?.split("\n").map((part) => part.trim()).find(Boolean);
  return line?.replace(/\s+/g, " ") ?? "";
}

function matches(bot: Bot, query: string): boolean {
  if (!query) return true;
  const haystack = `${bot.name} ${bot.title} ${blurb(bot)}`.toLowerCase();
  return haystack.includes(query);
}

/** Bot switcher opened from the sidebar search button. */
export function SidebarSearchModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const bots = state.bots.filter((bot) => !bot.hidden);
  const q = query.trim().toLowerCase();
  const shown = bots.filter((bot) => matches(bot, q));
  const selected = shown.length ? Math.min(cursor, shown.length - 1) : 0;

  useEffect(() => setCursor(0), [q]);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected, shown.length]);

  const choose = (bot: Bot) => {
    dispatch({ type: "select", id: bot.id });
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setCursor(shown.length ? (selected + 1) % shown.length : 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setCursor(shown.length ? (selected - 1 + shown.length) % shown.length : 0);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const bot = shown[selected];
      if (bot) choose(bot);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-[12vh]"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("sidebar.searchAria")}
        className="flex max-h-[min(560px,72vh)] w-full max-w-[640px] flex-col overflow-hidden rounded-2xl border border-hairline/50 bg-card shadow-2xl shadow-black/60"
      >
        <div className="px-3 pt-3">
          <label className="flex items-center gap-2 rounded-xl bg-raised/70 px-3 py-2.5">
            <Search size={16} className="shrink-0 text-ink-secondary" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("sidebar.search")}
              aria-label={t("sidebar.searchAria")}
              className="w-full bg-transparent text-[14px] text-ink placeholder:text-ink-secondary focus:outline-none"
            />
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {shown.length === 0 && (
            <div className="px-3 py-6 text-center text-[13px] text-ink-secondary">{t("sidebar.noMatch", { query })}</div>
          )}
          {shown.map((bot) => {
            const index = bots.indexOf(bot);
            const active = shown[selected]?.id === bot.id;
            const title = bot.title.trim();
            const detail = blurb(bot);
            return (
              <button
                key={bot.id}
                type="button"
                ref={active ? selectedRef : undefined}
                onClick={() => choose(bot)}
                onMouseMove={() => setCursor(shown.indexOf(bot))}
                className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left", active ? "bg-raised" : "hover:bg-raised/50")}
              >
                <BotAvatar bot={bot} state="idle" size={32} animated={false} />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[14px] font-semibold text-ink">{bot.name}</span>
                    {title ? (
                      <span className="shrink-0 rounded-md border border-hairline/60 px-1.5 py-0.5 text-[11px] leading-4 text-ink-secondary">{title}</span>
                    ) : null}
                  </span>
                  {detail ? <span className="mt-0.5 block truncate text-[12.5px] text-ink-secondary">{detail}</span> : null}
                </span>
                {index >= 0 && index < 9 ? (
                  <span className="shrink-0 rounded-md border border-hairline/60 px-1.5 py-0.5 text-[12px] tabular-nums text-ink-secondary">#{index + 1}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
