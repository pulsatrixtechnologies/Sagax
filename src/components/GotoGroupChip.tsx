// Several "Go to conversation" lines in a row, drawn as one compact chip:
// "3 conversations with [stacked faces] 3 agents". It opens a list of each
// target once (a bot's face and name, or the cube for a thread or a room);
// picking one does what that line did on its own: go to the conversation,
// or open the exchange sheet in this column when there is nowhere to go.
// One target (the same bot twice) stays the plain line.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Box, ChevronDown } from "lucide-react";
import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { mausInk, type MausColor } from "@/lib/mascot";
import { gotoAgents, gotoEntryView, type GotoGroup, type GotoTarget } from "@/lib/goto-lines";
import { BotAvatar } from "./Avatar";
import { BotExchangeChip, ExchangeSheet, avatarBot } from "./BotExchangeChip";
import { ConversationLink } from "./ConversationLink";
import { useMenuMotion } from "./MenuMotion";

const MAX_FACES = 3;

type Owners = { bots: readonly Bot[]; groups?: readonly { id: string; name: string }[] };

function inkOf(color: string | undefined): MausColor {
  return color && mausInk(color) ? (color as MausColor) : "blue";
}

function faceOf(bot: { id?: string; name: string; color?: string }, bots: readonly Bot[]) {
  return avatarBot({ ...(bot.id ? { id: bot.id } : {}), name: bot.name, ...(bot.color ? { color: bot.color } : {}) }, bots);
}

/** The lone line: exactly what the stack would have drawn for one target. */
function SingleLine({
  target,
  owners,
  showToolCalls,
  forceOpen,
  onSelect,
}: {
  target: GotoTarget;
  owners: Owners;
  showToolCalls: boolean;
  forceOpen: boolean;
  onSelect: (target: GotoTarget) => boolean;
}) {
  if (target.kind === "exchange") {
    return (
      <BotExchangeChip
        run={target.run}
        bots={owners.bots}
        showToolCalls={showToolCalls}
        forceOpen={forceOpen}
        onGo={() => onSelect(target)}
      />
    );
  }
  const ref = target.message.threadRef!;
  const bot = owners.bots.find((candidate) => candidate.id === ref.botId);
  const room = bot ? undefined : owners.groups?.find((candidate) => candidate.id === ref.botId);
  const name = bot?.name ?? room?.name ?? ref.title;
  const color = inkOf(bot?.color);
  return (
    <ConversationLink
      bot={bot ?? { name, color }}
      name={name}
      color={color}
      attributes={{ "data-thread-chip": ref.threadId }}
      title={ref.title ? t("chat.openThread", { title: ref.title }) : t("chat.goToConversation")}
      onClick={() => onSelect(target)}
    />
  );
}

export function GotoGroupChip({
  group,
  bots,
  groups,
  showToolCalls = false,
  focusedId,
  onSelect,
}: {
  group: GotoGroup;
  bots: readonly Bot[];
  groups?: readonly { id: string; name: string }[];
  showToolCalls?: boolean;
  /** A search hit inside one of the exchanges opens its sheet. */
  focusedId?: string | null;
  /** Does what the target's own line does. False: nowhere to go, the exchange sheet opens here. */
  onSelect: (target: GotoTarget) => boolean;
}) {
  const owners = useMemo(() => ({ bots, groups }), [bots, groups]);
  const entries = useMemo(() => group.targets.map((target) => gotoEntryView(target, owners)), [group.targets, owners]);
  const agents = useMemo(() => gotoAgents(entries, owners), [entries, owners]);
  const [open, setOpen] = useState(false);
  const motion = useMenuMotion(open);
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const forcedKey = focusedId
    ? group.targets.find((target) => target.kind === "exchange" && target.run.messages.some((message) => message.id === focusedId))?.key ?? null
    : null;
  useEffect(() => {
    if (forcedKey) setHeld(false);
  }, [forcedKey]);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (group.targets.length === 1) {
    return (
      <SingleLine
        target={group.targets[0]!}
        owners={owners}
        showToolCalls={showToolCalls}
        forceOpen={Boolean(forcedKey)}
        onSelect={onSelect}
      />
    );
  }

  const count = group.targets.length;
  const agentsLabel = agents.length === 1 ? t("chat.gotoGroup.agentsOne") : t("chat.gotoGroup.agents", { count: agents.length });
  const shownSheet = sheetKey ?? (forcedKey && !held ? forcedKey : null);
  const sheetTarget = group.targets.find((target) => target.key === shownSheet && target.kind === "exchange");

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const pick = (target: GotoTarget) => {
    setOpen(false);
    if (onSelect(target)) return;
    if (target.kind === "exchange") {
      setHeld(false);
      setSheetKey(target.key);
    }
  };
  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter((item): item is HTMLButtonElement => Boolean(item));
    const at = items.findIndex((item) => item === document.activeElement);
    const move = (next: number) => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus();
    };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close(false);
  };

  return (
    <div className="flex justify-center py-1">
      <div ref={rootRef} className="relative">
        <button
          ref={triggerRef}
          type="button"
          data-testid="goto-group-chip"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={t("chat.gotoGroup.aria", { count, agents: agentsLabel })}
          onClick={() => setOpen((value) => !value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && !open) {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-raised",
            open && "bg-raised",
          )}
        >
          <span>{agents.length ? t("chat.gotoGroup.with", { count }) : t("chat.gotoGroup.count", { count })}</span>
          {agents.length > 0 && (
            <>
              <span className="flex items-center -space-x-1.5" aria-hidden="true">
                {agents.slice(0, MAX_FACES).map((agent) => (
                  <span key={agent.key} className="inline-flex rounded-full ring-2 ring-app">
                    <BotAvatar bot={faceOf(agent.bot, bots) as Bot} state="happy" size={16} animated={false} />
                  </span>
                ))}
              </span>
              <span className="font-medium text-ink">{agentsLabel}</span>
            </>
          )}
          <ChevronDown size={12} aria-hidden="true" className={cn("transition-transform", open && "rotate-180")} />
        </button>
        {motion.shown && (
          <div
            role="menu"
            aria-label={t("chat.gotoGroup.menu")}
            data-testid="goto-group-menu"
            onKeyDown={onMenuKey}
            className={cn(
              "absolute left-1/2 top-full z-30 mt-1 flex w-[280px] max-w-[80vw] -translate-x-1/2 flex-col gap-0.5 overflow-hidden rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5 text-[13px] leading-[18px]",
              motion.className,
            )}
            {...motion.exitProps}
          >
            {entries.map((entry, index) => {
              const target = group.targets[index]!;
              const face = entry.bot ? faceOf(entry.bot, bots) : null;
              return (
                <button
                  key={entry.key}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                  }}
                  type="button"
                  role="menuitem"
                  data-goto-target={entry.key}
                  aria-label={t("chat.goToConversationWith", { name: entry.label })}
                  onClick={() => pick(target)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ink hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                >
                  {face ? (
                    <BotAvatar bot={face as Bot} state="happy" size={18} animated={false} />
                  ) : (
                    <span className="flex size-[18px] shrink-0 items-center justify-center text-ink-secondary">
                      <Box size={15} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.detail && <span className="max-w-[40%] shrink-0 truncate text-[12px] text-ink-tertiary">{entry.detail}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {sheetTarget?.kind === "exchange" && (
        <ExchangeSheet
          run={sheetTarget.run}
          bots={bots}
          showToolCalls={showToolCalls}
          onClose={() => {
            setSheetKey(null);
            setHeld(true);
          }}
        />
      )}
    </div>
  );
}
