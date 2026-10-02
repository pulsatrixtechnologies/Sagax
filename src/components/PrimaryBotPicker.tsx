import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { primaryBotChoices } from "@/lib/primary-bot";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";

export interface PrimaryBotPickerProps {
  open: boolean;
  bots: readonly Bot[];
  viewerId: string;
  /** The current Primary Bot, left out of the list. */
  currentId: string | null;
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (botId: string) => void;
}

/** "Choose a primary Bot": search, the person's own bots (never the current
 * one), Cancel and Confirm. Confirm stays off until a different bot is
 * chosen. Portalled to <body> like ConfirmDialog, with Escape and a focus
 * trap. */
export function PrimaryBotPicker({ open, bots, viewerId, currentId, pending = false, error, onCancel, onConfirm }: PrimaryBotPickerProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const cancelAction = useRef(onCancel);
  cancelAction.current = onCancel;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(null);
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    searchRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelAction.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>("input, button:not([disabled])");
      if (!controls?.length) return;
      const first = controls[0]!;
      const last = controls[controls.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (opener?.isConnected && opener !== document.body) opener.focus();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(event) => event.target === event.currentTarget && !pending && onCancel()}
    >
      <PrimaryBotPickerCard
        ref={dialogRef}
        searchRef={searchRef}
        bots={bots}
        viewerId={viewerId}
        currentId={currentId}
        query={query}
        onQuery={setQuery}
        selected={selected}
        onSelect={setSelected}
        pending={pending}
        error={error}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </div>,
    document.body,
  );
}

/** The card alone, without the portal or key handling, so tests can render
 * it to static markup and read its handlers. */
export function PrimaryBotPickerCard({
  ref,
  searchRef,
  bots,
  viewerId,
  currentId,
  query,
  onQuery,
  selected,
  onSelect,
  pending = false,
  error,
  onCancel,
  onConfirm,
}: {
  ref?: React.Ref<HTMLDivElement>;
  searchRef?: React.Ref<HTMLInputElement>;
  bots: readonly Bot[];
  viewerId: string;
  currentId: string | null;
  query: string;
  onQuery: (query: string) => void;
  selected: string | null;
  onSelect: (botId: string) => void;
  pending?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (botId: string) => void;
}) {
  const any = primaryBotChoices(bots, viewerId, currentId).length > 0;
  const choices = primaryBotChoices(bots, viewerId, currentId, query);
  const chosen = selected && selected !== currentId && choices.some((bot) => bot.id === selected) ? selected : null;
  return (
    <div
      ref={ref}
      role="dialog"
      tabIndex={-1}
      aria-modal="true"
      aria-busy={pending}
      aria-labelledby="primary-bot-picker-title"
      aria-describedby="primary-bot-picker-hint"
      data-testid="primary-bot-picker"
      className="flex max-h-[min(560px,calc(100dvh-32px))] w-full max-w-[400px] flex-col rounded-[14px] border border-border bg-elevated outline-none"
    >
      <div className="px-4 pt-4">
        <h2 id="primary-bot-picker-title" className="text-[15px] font-semibold leading-[22px] text-ink">{t("primaryBot.chooseTitle")}</h2>
        <p id="primary-bot-picker-hint" className="mt-0.5 text-[13px] leading-[18px] text-ink-tertiary">{t("primaryBot.chooseHint")}</p>
        <label className="mt-3 flex h-8 items-center gap-2 rounded-lg border border-border bg-panel px-2.5 text-ink-secondary focus-within:ring-2 focus-within:ring-accent/50">
          <Search size={14} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={t("primaryBot.search")}
            aria-label={t("primaryBot.searchLabel")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-tertiary"
          />
        </label>
      </div>
      <div role="listbox" aria-label={t("primaryBot.chooseTitle")} className="mt-2 min-h-[64px] flex-1 overflow-y-auto overscroll-contain px-2">
        {choices.map((bot) => {
          const isSelected = bot.id === chosen;
          return (
            <button
              key={bot.id}
              type="button"
              role="option"
              aria-selected={isSelected}
              data-bot-id={bot.id}
              onClick={() => onSelect(bot.id)}
              onDoubleClick={() => !pending && onConfirm(bot.id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] leading-[18px] text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                isSelected ? "bg-accent/12" : "hover:bg-hover",
              )}
            >
              <BotAvatar bot={bot} state="idle" size={28} animated={false} />
              <span className="min-w-0 flex-1 truncate">{bot.name}</span>
            </button>
          );
        })}
        {!choices.length && (
          <p className="px-2 py-4 text-center text-[13px] text-ink-tertiary">{any ? t("primaryBot.noMatch") : t("primaryBot.empty")}</p>
        )}
      </div>
      {error && <p role="alert" className="px-4 pt-2 text-[12px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2 px-4 py-3">
        <button type="button" onClick={onCancel} disabled={pending} className="ui-button disabled:opacity-50">
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => chosen && onConfirm(chosen)}
          disabled={!chosen || pending}
          className="ui-button ui-button-primary disabled:opacity-50"
        >
          {t("primaryBot.confirm")}
        </button>
      </div>
    </div>
  );
}
