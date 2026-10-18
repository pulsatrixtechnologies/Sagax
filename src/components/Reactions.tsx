// Emoji reactions on a chat message (shared/reactions.ts, src/lib/reactions.ts):
//
// - ReactButton: the smiley in the message's hover bar; it opens the picker.
// - ReactionPicker: the eight quick reactions, then the full emoji catalogue
//   (src/lib/emoji-catalog.ts, lazy, en + fr words) with search and category
//   tabs (EmojiCatalogGrid). Escape or a press outside closes it.
// - ReactionChips: one chip per emoji under the message (emoji + count),
//   highlighted when the viewer is among the reactors; a click toggles the
//   viewer's own; hovering or focusing it lists who reacted, a bot with its
//   mascot (from `bots`), in a tooltip drawn in a portal (src/lib/popover-placement.ts).
import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { SmilePlus } from "lucide-react";

import { useAnchoredPopover } from "@/hooks/use-anchored-popover";
import { usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { reactionActorName, reactionChips, reactionTooltip, type ReactionChip } from "@/lib/reactions";
import type { Bot } from "@/state/store";
import { QUICK_REACTIONS, type ReactionActor } from "../../shared/reactions";
import { BotAvatar } from "./Avatar";
import { EmojiCatalogGrid, useEmojiChoices } from "./EmojiCatalogGrid";

const QUICK_SET: ReadonlySet<string> = new Set<string>(QUICK_REACTIONS);

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

/** The picker. With `anchorRef` (a message's action row) it is drawn in a
 * portal, fixed above the anchor, below it when there is no room above,
 * and kept inside the window (src/lib/popover-placement.ts), so no
 * scrolling container cuts it; without, it is absolutely placed above
 * whatever holds it (`relative`). `align` keeps it on the message's side.
 * `mine` marks the quick reactions the viewer already put there (choosing
 * one again takes it back). */
export function ReactionPicker({
  onPick,
  onClose,
  align,
  mine = [],
  className,
  anchorRef,
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  align: "start" | "end";
  mine?: readonly string[];
  className?: string;
  anchorRef?: RefObject<HTMLElement | null>;
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
      const holder = anchorRef ? anchorRef.current : root.parentElement;
      return Boolean(button && holder?.contains(button));
    },
  });
  usePopoverDismiss(true, inside, onClose);
  const anchored = Boolean(anchorRef);
  const noAnchor = useRef<HTMLElement | null>(null);
  useAnchoredPopover(anchored, anchorRef ?? noAnchor, rootRef, { prefer: "above", align });
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const catalog = useEmojiChoices(query, QUICK_SET);
  const results = catalog.choices;
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
  const choice = (emoji: string, label: string) => (
    <button
      key={emoji}
      type="button"
      data-quick-reaction={emoji}
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
  const picker = (
    <div
      ref={rootRef}
      role="dialog"
      aria-label={t("reactions.add")}
      data-reaction-picker
      className={cn(
        "flex w-[17rem] max-w-[calc(100vw-1rem)] flex-col gap-1.5 overflow-y-auto rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5",
        anchored ? "fixed left-0 top-0 z-50" : cn("absolute bottom-full z-40 mb-1", align === "end" ? "right-0" : "left-0"),
        className,
      )}
    >
      <div className="flex items-center justify-between">
        {QUICK_REACTIONS.map((emoji) => choice(emoji, t("reactions.reactWith", { emoji })))}
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
      <EmojiCatalogGrid state={catalog} onPick={pick} mine={mine} labelFor={(entry) => t("reactions.reactWith", { emoji: entry.emoji })} />
    </div>
  );
  return anchored && typeof document !== "undefined" ? createPortal(picker, document.body) : picker;
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

function focusVisible(target: EventTarget): boolean {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return false;
  }
}

/** One chip: the emoji and its count; who reacted in the tooltip. The
 * tooltip shows while the chip is hovered or focused, drawn in a portal on
 * document.body above the chip (below it when there is no room), because a
 * transcript row (content-visibility: auto) paints nothing outside itself. */
function Chip({ chip, selfIds, onToggle, end, bots }: { chip: ReactionChip; selfIds: readonly string[]; onToggle: (emoji: string) => void; end: boolean; bots: readonly Bot[] }) {
  const label = reactionTooltip(chip, selfIds);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = hovered || focused;
  useAnchoredPopover(open, buttonRef, tipRef, { prefer: "above", align: end ? "end" : "start" });
  const tip = (
    <span
      ref={tipRef}
      aria-hidden="true"
      data-reaction-tip
      data-reaction-tip-for={chip.emoji}
      className="pointer-events-none fixed left-0 top-0 z-50 flex w-max max-w-[16rem] flex-col gap-1 rounded-md border-[0.5px] border-border bg-elevated px-2 py-1.5 text-[11px] leading-4 text-ink shadow-sm animate-pop-in"
    >
      {chip.actors.map((actor) => (
        <span key={actor.id} data-reaction-actor={actor.id} className="flex items-center gap-1.5">
          <ActorFace actor={actor} bots={bots} />
          <span className="truncate">{reactionActorName(actor, selfIds)}</span>
        </span>
      ))}
      <span className="text-ink-tertiary">{t("reactions.reactedWith", { emoji: chip.emoji })}</span>
    </span>
  );
  return (
    <span
      className="relative inline-flex"
      onPointerEnter={(event) => { if (event.pointerType !== "touch") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
      // keyboard focus only: a click or a tap also focuses the chip, and the
      // tooltip would then stay up after the pointer left
      onFocus={(event) => setFocused(focusVisible(event.target))}
      onBlur={() => setFocused(false)}
    >
      <button
        ref={buttonRef}
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
      {open && (typeof document === "undefined" ? tip : createPortal(tip, document.body))}
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
