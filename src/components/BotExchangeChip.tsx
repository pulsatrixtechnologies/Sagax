// A collapsed bot-to-bot run: one quiet chip in the transcript, the lines
// themselves in a sheet that fills the chat column. The messages stay
// stored; this only changes how they are drawn.
import { createContext, useCallback, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight } from "lucide-react";
import { formatTime, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { ConversationLink } from "./ConversationLink";
import { activeLocale, t } from "@/lib/i18n";
import { MAUS_COLORS, mausInk, type MausColor } from "@/lib/mascot";
import { botBubbleVars } from "@/lib/bubble-colors";
import { CHAT_BUBBLE_WIDTH_CLASS, CHAT_COLUMN_CLASS, chatBubbleWidth } from "@/lib/chat-bubble-width";
import { prefersWideBubble } from "@/lib/rich-blocks";
import { runCorners } from "@/lib/room-authors";
import { cn } from "@/lib/cn";
import { ChatMarkdown } from "./ChatMarkdown";
import { ClusterLabel } from "./ClusterLabel";
import { MessageBoundary } from "./MessageBoundary";
import { ToolActivity, botNames } from "./ToolActivity";
import {
  exchangeBody,
  exchangeKey,
  exchangeSheetRow,
  exchangeSide,
  exchangeSpeaker,
  startsNewStretch,
  transcriptDateLabel,
  type ExchangeParty,
  type ExchangeRun,
} from "@/lib/bot-exchange";

// The open sheet is placed in this element (absolute inset-0), never on
// document.body, so the sidebar and the bot panel stay usable.
const ExchangeColumnContext = createContext<HTMLElement | null>(null);

export function ExchangeColumnProvider({ node, children }: { node: HTMLElement | null; children: ReactNode }) {
  return <ExchangeColumnContext.Provider value={node}>{children}</ExchangeColumnContext.Provider>;
}

export function useExchangeColumn(): { node: HTMLElement | null; ref: (node: HTMLElement | null) => void } {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const ref = useCallback((next: HTMLElement | null) => {
    setNode((current) => (current === next ? current : next));
  }, []);
  return { node, ref };
}

function inkColor(color: string | undefined): MausColor {
  return color && mausInk(color) ? (color as MausColor) : "blue";
}

export function avatarBot(party: ExchangeParty, bots?: readonly Bot[]): { name: string; color: MausColor } & Partial<Bot> {
  const found = party.id ? bots?.find((bot) => bot.id === party.id) : undefined;
  if (found) return found;
  return { name: party.name, color: inkColor(party.color) };
}

/** Centered quiet date, the first line of a visible cluster. */
export function TranscriptDate({ at }: { at: number }) {
  return (
    <div data-testid="transcript-date" className="py-3 text-center text-[13px] text-ink-secondary">
      {transcriptDateLabel(
        at,
        Date.now(),
        { today: t("chat.day.today"), yesterday: t("chat.day.yesterday") },
        activeLocale(),
        formatTime(at),
      )}
    </div>
  );
}

/** `loadError`: the thread's lines could not be read; `onRetry` reads them
 * again. With no line to show, the sheet says so rather than staying blank
 * (#1502). */
export function ExchangeSheet({ run, bots, showToolCalls, onClose, loadError = false, onRetry }: { run: ExchangeRun; bots?: readonly Bot[]; showToolCalls: boolean; onClose: () => void; loadError?: boolean; onRetry?: () => void }) {
  const column = useContext(ExchangeColumnContext);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const fallback = run.ends[0];
  // A tool step is never a line with a speaker: it is a chip with Tool
  // calls on, and nothing at all otherwise.
  const rows = run.messages.flatMap((message) => {
    const shape = exchangeSheetRow(message, showToolCalls);
    return shape ? [{ message, shape }] : [];
  });
  const sheet = (
    <div
      className="absolute inset-0 z-20 flex min-h-0 flex-col bg-app"
      role="dialog"
      aria-modal="false"
      aria-label={t("chat.exchange.open", { count: run.messages.length, name: run.party.name })}
      data-testid="bot-exchange-sheet"
      onClick={onClose}
    >
      <div className="flex justify-center pt-6" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center gap-2 rounded-full bg-elevated px-3 py-1.5">
          {run.ends.map((party, index) => {
            const bot = avatarBot(party, bots);
            return (
              <span key={`${party.id ?? party.name}:${index}`} className="flex items-center gap-1.5">
                {index > 0 && <ArrowLeftRight size={14} className="text-ink-tertiary" />}
                <BotAvatar bot={bot} state="happy" size={18} animated={false} />
                <span className="text-[13px] font-medium" style={{ color: mausInk(bot.color) }}>{party.name}</span>
              </span>
            );
          })}
        </div>
      </div>
      {/* The same pane and column as a 1:1 chat (ChatView): the gutter, the
          960px column, Geist at 13px, the Markdown renderer and the bubble
          widths, so the lines use the room a wider window gives. */}
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-5" data-testid="bot-exchange-scroll">
      <div className={cn(CHAT_COLUMN_CLASS, "py-6")} role="log" aria-live="off" onClick={(event) => event.stopPropagation()}>
        {loadError ? (
          <div role="alert" data-testid="bot-exchange-error" className="flex flex-col items-center gap-2 py-8 text-center text-[13px] text-ink-secondary">
            <p>{t("chat.exchange.loadError")}</p>
            {onRetry && (
              <button type="button" data-testid="bot-exchange-retry" onClick={onRetry} className="rounded-full bg-raised px-3 py-1 text-[12.5px] text-ink hover:bg-raised-hover">
                {t("chat.retry")}
              </button>
            )}
          </div>
        ) : rows.length === 0 && (
          <p role="status" data-testid="bot-exchange-empty" className="py-8 text-center text-[13px] text-ink-secondary">
            {t("chat.exchange.empty", { name: run.party.name })}
          </p>
        )}
        {rows.map(({ message, shape }, index) => {
          const previous = rows[index - 1];
          const next = rows[index + 1];
          const newStretch = startsNewStretch(previous?.message.at, message.at);
          const stamp = newStretch && <TranscriptDate at={message.at} />;
          if (shape === "tool") {
            return (
              <div key={message.id} className="contents">
                {stamp}
                <div data-mid={message.id} className="ps-4">
                  <ToolActivity tool={message.tool!} nameOf={botNames(bots)} />
                </div>
              </div>
            );
          }
          const speaker = exchangeSpeaker(message, fallback);
          const bot = avatarBot(speaker, bots);
          // The first bot of the header answers like a bot in a 1:1; the
          // other takes the person's side, in its own colour (botBubbleVars).
          const end = exchangeSide(speaker, fallback) === "end";
          const sameAuthor = (row: typeof previous) =>
            row?.shape === "line" && exchangeKey(exchangeSpeaker(row.message, fallback)) === exchangeKey(speaker);
          const joinsAbove = !newStretch && sameAuthor(previous);
          const joinsBelow = Boolean(next) && !startsNewStretch(message.at, next!.message.at) && sameAuthor(next);
          const text = exchangeBody(message);
          const width = CHAT_BUBBLE_WIDTH_CLASS[chatBubbleWidth({ terminal: false, wide: Boolean(text) && prefersWideBubble(text) })];
          const time = (
            <span className="self-end pb-1 text-[11px] tabular-nums text-ink-tertiary opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100">
              {formatTime(message.at)}
            </span>
          );
          return (
            <div key={message.id} className="contents">
              {stamp}
              {!joinsAbove && <ClusterLabel bot={bot as Bot} name={speaker.name} color={bot.color} end={end} />}
              <div
                data-mid={message.id}
                data-side={end ? "end" : "start"}
                className={cn("group flex w-full flex-col", end ? "items-end" : "items-start", joinsAbove && "-mt-2")}
                style={end ? (botBubbleVars(MAUS_COLORS[bot.color]) as CSSProperties) : undefined}
              >
                <div className={cn("flex w-full items-end gap-1.5", end ? "justify-end" : "justify-start")}>
                  {end && time}
                  <div
                    data-chat-bubble
                    className={cn(
                      "rounded-[18px] px-3 py-[7px] text-[13px] leading-5",
                      width,
                      end ? "bg-bubble-user" : "bg-bubble-bot text-ink",
                      runCorners(end ? "end" : "start", joinsAbove, joinsBelow),
                    )}
                    title={new Date(message.at).toLocaleString(activeLocale())}
                  >
                    <MessageBoundary fallbackText={text}>
                      <ChatMarkdown text={text} botId={speaker.id} />
                    </MessageBoundary>
                  </div>
                  {!end && time}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      </div>
      <div className="flex justify-center pb-8" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          data-testid="bot-exchange-close"
          onClick={onClose}
          className="rounded-full bg-raised px-4 py-2 text-[13px] text-ink hover:bg-raised-hover"
        >
          {t("chat.exchange.close")}
        </button>
      </div>
    </div>
  );
  // A column host (ChatView, GroupView) is the containing block. Without one
  // (unit render) the sheet stays in the chip, still not viewport-fixed.
  return column ? createPortal(sheet, column) : sheet;
}

export function BotExchangeChip({
  run,
  bots,
  forceOpen = false,
  showToolCalls = false,
  onGo,
}: {
  run: ExchangeRun;
  bots?: readonly Bot[];
  /** Settings > Tool calls: tool steps inside the run show as chips. */
  showToolCalls?: boolean;
  /** A search hit inside the run opens the sheet, the same way a folded tool run does. */
  forceOpen?: boolean;
  /** Opens that bot's conversation. False when there is no conversation to open, and the sheet stays. */
  onGo?: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (forceOpen) setHeld(false);
  }, [forceOpen]);
  const shown = open || (forceOpen && !held);
  const party = avatarBot(run.party, bots);
  return (
    <ConversationLink
      bot={party}
      name={run.party.name}
      color={party.color}
      testId="bot-exchange-chip"
      label={t("chat.goToConversationWith", { name: run.party.name })}
      onClick={() => {
        if (onGo?.()) return;
        setHeld(false);
        setOpen(true);
      }}
    >
      {shown && (
        <ExchangeSheet
          run={run}
          bots={bots}
          showToolCalls={showToolCalls}
          onClose={() => {
            setOpen(false);
            setHeld(true);
          }}
        />
      )}
    </ConversationLink>
  );
}
