// Emoji reactions on a chat message (shared/reactions.ts, src/lib/reactions.ts):
//
// - ReactButton: the smiley in the message's hover bar; it opens the picker.
// - ReactionPicker: the eight quick reactions, then a search in the built-in
//   emoji set (src/lib/emoji-list.ts). Escape or a press outside closes it.
// - ReactionChips: one chip per emoji under the message (emoji + count),
//   highlighted when the viewer is among the reactors; a click toggles the
//   viewer's own; hovering or focusing it lists who reacted, a bot with its
//   mascot (from `bots`).
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { SmilePlus } from "lucide-react";

import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { searchEmoji } from "@/lib/emoji-list";
import { t } from "@/lib/i18n";
import { reactionActorName, reactionChips, reactionTooltip, type ReactionChip } from "@/lib/reactions";
import type { Bot } from "@/state/store";
import { QUICK_REACTIONS, type ReactionActor } from "../../shared/reactions";
import { BotAvatar } from "./Avatar";

/** The smiley that opens the picker. */
export function ReactButton({ open, onToggle, className }: { open: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      type="button"
      data-react-button
      onClick={onToggle}
      aria-label={t("reactions.add")}
      title={t("reactions.add")}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={cn("rounded-md p-1.5 text-ink-secondary hover:bg-raised hover:text-ink", open && "bg-raised text-ink", className)}
    >
      <SmilePlus size={14} aria-hidden="true" />
    </button>
  );
}

/** The picker, absolutely placed above whatever holds it (`relative`).
 * `align` keeps it on the message's side. `mine` marks the quick reactions
 * the viewer already put there (choosing one again takes it back). */
export function ReactionPicker({
  onPick,
  onClose,
  align,
  mine = [],
  className,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  align: "start" | "end";
  mine?: readonly string[];
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  // A press on this message's own smiley is left to its toggle.
  const inside = useRef({
    contains: (target: unknown) => {
      const root = rootRef.current;
      if (!root || !(target instanceof Node)) return false;
      if (root.contains(target)) return true;
      const button = target instanceof Element ? target.closest("[data-react-button]") : null;
      return Boolean(button && root.parentElement?.contains(button));
    },
  });
  usePopoverDismiss(true, inside, onClose);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const quick = new Set<string>(QUICK_REACTIONS);
  const results = useMemo(() => {
    const found = searchEmoji(query);
    return query.trim() ? found : found.filter((entry) => !quick.has(entry.emoji));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const pick = (emoji: string) => {
    onPick(emoji);
    onClose();
  };
  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const first = results[0];
      if (first) pick(first.emoji);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      rootRef.current?.querySelector<HTMLElement>("[data-emoji-result]")?.focus();
    }
  };
  const choice = (emoji: string, label: string, kind: "quick" | "result") => (
    <button
      key={emoji}
      type="button"
      {...(kind === "quick" ? { "data-quick-reaction": emoji } : { "data-emoji-result": emoji })}
      onClick={() => pick(emoji)}
      aria-label={label}
      title={label}
      aria-pressed={mine.includes(emoji) || undefined}
      className={cn(
        "flex size-8 items-center justify-center rounded-md text-[18px] leading-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-none",
        mine.includes(emoji) && "bg-accent/15",
      )}
    >
      {emoji}
    </button>
  );
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t("reactions.add")}
      data-reaction-picker
      className={cn(
        "absolute bottom-full z-40 mb-1 flex w-[17rem] max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5",
        align === "end" ? "right-0" : "left-0",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        {QUICK_REACTIONS.map((emoji) => choice(emoji, t("reactions.reactWith", { emoji }), "quick"))}
      </div>
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onSearchKey}
        placeholder={t("reactions.search")}
        aria-label={t("reactions.search")}
        className="h-7 rounded-md border-[0.5px] border-border bg-inset px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-tertiary focus:border-accent"
      />
      <div role="group" aria-label={t("reactions.results")} className="grid max-h-40 grid-cols-8 overflow-y-auto">
        {results.map((entry) => choice(entry.emoji, t("reactions.reactWith", { emoji: entry.emoji }), "result"))}
      </div>
      {results.length === 0 && <p className="px-1 pb-1 text-[12px] text-ink-tertiary">{t("reactions.none")}</p>}
    </div>
  );
}

function ActorFace({ actor, bots }: { actor: ReactionActor; bots: readonly Bot[] }) {
  if (actor.kind === "bot") {
    const bot = bots.find((candidate) => `bot:${candidate.id}` === actor.id);
    if (bot) return <BotAvatar bot={bot} state="happy" size={14} motion="none" motionKey={0} animated={false} />;
  }
  const initials = (actor.name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]!.toUpperCase()).join("") || "?";
  return (
    <span aria-hidden="true" className="inline-flex size-3.5 items-center justify-center rounded-full bg-raised text-[7px] font-semibold text-ink-secondary">
      {initials}
    </span>
  );
}

/** One chip: the emoji and its count; who reacted in the tooltip. */
function Chip({ chip, selfIds, onToggle, end, bots }: { chip: ReactionChip; selfIds: readonly string[]; onToggle: (emoji: string) => void; end: boolean; bots: readonly Bot[] }) {
  const label = reactionTooltip(chip, selfIds);
  return (
    <span className="group/chip relative inline-flex">
      <button
        type="button"
        data-reaction-chip={chip.emoji}
        data-mine={chip.mine ? "true" : undefined}
        aria-pressed={chip.mine}
        aria-label={label}
        onClick={() => onToggle(chip.emoji)}
        className={cn(
          "inline-flex h-6 items-center gap-1 rounded-full border-[0.5px] px-1.5 text-[12px] leading-none tabular-nums transition-colors",
          chip.mine
            ? "border-accent/60 bg-accent/15 text-ink"
            : "border-border bg-card text-ink-secondary hover:border-hairline hover:text-ink",
        )}
      >
        <span aria-hidden="true" className="text-[14px] leading-none">{chip.emoji}</span>
        <span aria-hidden="true">{chip.count}</span>
      </button>
      <span
        aria-hidden="true"
        data-reaction-tip
        className={cn(
          "pointer-events-none absolute bottom-full z-30 mb-1 flex w-max max-w-[16rem] flex-col gap-1 rounded-md border-[0.5px] border-border bg-elevated px-2 py-1.5 text-[11px] leading-4 text-ink opacity-0 shadow-sm transition-opacity group-hover/chip:opacity-100 group-focus-within/chip:opacity-100",
          end ? "right-0" : "left-0",
        )}
      >
        {chip.actors.map((actor) => (
          <span key={actor.id} data-reaction-actor={actor.id} className="flex items-center gap-1.5">
            <ActorFace actor={actor} bots={bots} />
            <span className="truncate">{reactionActorName(actor, selfIds)}</span>
          </span>
        ))}
        <span className="text-ink-tertiary">{t("reactions.reactedWith", { emoji: chip.emoji })}</span>
      </span>
    </span>
  );
}

/** The chips under a message, on its side; nothing without reactions. */
export function ReactionChips({
  reactions,
  selfIds,
  onToggle,
  end,
  bots = [],
}: {
  reactions: unknown;
  selfIds: readonly string[];
  onToggle: (emoji: string) => void;
  end: boolean;
  /** The bots that may have reacted, for their mascot in the tooltip. */
  bots?: readonly Bot[];
}) {
  const chips = reactionChips(reactions, selfIds);
  if (!chips.length) return null;
  return (
    <div
      data-testid="reaction-chips"
      role="group"
      aria-label={t("reactions.group")}
      className={cn("mt-1 flex w-full flex-wrap gap-1 px-1", end ? "justify-end" : "justify-start")}
    >
      {chips.map((chip) => <Chip key={chip.emoji} chip={chip} selfIds={selfIds} onToggle={onToggle} end={end} bots={bots} />)}
    </div>
  );
}
