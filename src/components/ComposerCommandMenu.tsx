// The composer's "/" menu: Sagax's own commands and the engine's (Claude
// Code, Codex), grouped Sagax, Engine, Plugins, MCP, each with its argument
// hint. What the chat cannot run stays listed, dimmed, with the reason.
import type { RefObject } from "react";
import { BookOpen, Plug, Puzzle, RefreshCw, Target, Terminal } from "lucide-react";

import { cn } from "@/lib/cn";
import type { ComposerMenuItem } from "@/lib/composer-commands";
import { t } from "@/lib/i18n";

export interface ComposerCommandMenuProps {
  items: ComposerMenuItem[];
  highlight: number;
  loading: boolean;
  onPick: (item: ComposerMenuItem) => void;
  onHighlight: (index: number) => void;
  /** Read the engine's list again (shown once a list was read). */
  onRefresh?: () => void;
  listRef?: RefObject<HTMLDivElement | null>;
  className?: string;
  exitProps?: { inert?: boolean; "aria-hidden"?: boolean };
}

function ItemIcon({ item }: { item: ComposerMenuItem }) {
  if (item.kind === "sagax") {
    return item.command.id === "goal" ? <Target size={15} aria-hidden="true" /> : <BookOpen size={15} aria-hidden="true" />;
  }
  if (item.group === "plugins") return <Puzzle size={15} aria-hidden="true" />;
  if (item.group === "mcp") return <Plug size={15} aria-hidden="true" />;
  return <Terminal size={15} aria-hidden="true" />;
}

export function ComposerCommandMenu({ items, highlight, loading, onPick, onHighlight, onRefresh, listRef, className, exitProps }: ComposerCommandMenuProps) {
  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label={t("composer.commands.aria")}
      className={cn("absolute bottom-full left-2 z-20 mb-2 max-h-80 w-[26rem] max-w-[calc(100vw-2rem)] overflow-x-hidden overflow-y-auto overscroll-contain rounded-xl border border-hairline/40 bg-raised shadow-lg", className)}
      {...exitProps}
    >
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-hairline/20 bg-raised px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        <span className="flex-1">{t("composer.commands.title")}</span>
        {loading && <span className="normal-case tracking-normal">{t("composer.commands.loading")}</span>}
        {onRefresh && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRefresh}
            aria-label={t("composer.commands.refresh")}
            title={t("composer.commands.refresh")}
            className="flex size-5 items-center justify-center rounded hover:bg-raised-hover"
          >
            <RefreshCw size={11} aria-hidden="true" />
          </button>
        )}
      </div>
      {items.map((item, index) => {
        const unavailable = item.kind === "engine" ? item.unavailable : undefined;
        const reason = unavailable ? t(`composer.commands.unavailable.${unavailable}`) : undefined;
        const startsGroup = index === 0 || items[index - 1]?.group !== item.group;
        return (
          <div key={item.key}>
            {startsGroup && (
              <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-tertiary">
                {t(`composer.commands.group.${item.group}`)}
              </div>
            )}
            <button
              type="button"
              role="option"
              data-command-index={index}
              aria-selected={index === highlight}
              aria-disabled={unavailable ? true : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onPick(item)}
              onMouseEnter={() => onHighlight(index)}
              title={reason}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left",
                index === highlight ? "bg-raised-hover" : "",
                unavailable ? "cursor-not-allowed opacity-55" : "",
              )}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <ItemIcon item={item} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="truncate text-[14px] font-medium text-accent">{item.label}</span>
                  {item.kind === "engine" && item.argumentHint && (
                    <span className="truncate font-mono text-[11px] text-ink-tertiary">{item.argumentHint}</span>
                  )}
                </span>
                <span className="block truncate text-xs text-ink-secondary">{reason ?? item.description}</span>
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
