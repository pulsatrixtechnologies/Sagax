// A collapsed bot-to-bot run: one quiet chip in the transcript, the lines
// themselves in a sheet that fills the chat column. The messages stay
// stored; this only changes how they are drawn.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight } from "lucide-react";
import { formatTime, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { activeLocale, t } from "@/lib/i18n";
import { mausInk, type MausColor } from "@/lib/mascot";
import {
  exchangeBody,
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

function avatarBot(party: ExchangeParty, bots?: readonly Bot[]): { name: string; color: MausColor } & Partial<Bot> {
  const found = party.id ? bots?.find((bot) => bot.id === party.id) : undefined;
  if (found) return found;
  return { name: party.name, color: inkColor(party.color) };
}

/** Centered quiet date, the first line of a visible cluster. */
export function TranscriptDate({ at }: { at: number }) {
  return (
    <div className="py-3 text-center text-[13px] text-ink-secondary">
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

function ExchangeSheet({ run, bots, onClose }: { run: ExchangeRun; bots?: readonly Bot[]; onClose: () => void }) {
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
      <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col gap-4 overflow-y-auto px-6 py-6" onClick={(event) => event.stopPropagation()}>
        {run.messages.map((message, index) => {
          const previous = run.messages[index - 1];
          const speaker = exchangeSpeaker(message, fallback);
          const bot = avatarBot(speaker, bots);
          return (
            <div key={message.id} className="contents">
              {startsNewStretch(previous?.at, message.at) && <TranscriptDate at={message.at} />}
              <div data-mid={message.id} className="relative ps-4">
                <div className="mb-1 text-[12px] font-medium" style={{ color: mausInk(bot.color) }}>{speaker.name}</div>
                <div className="whitespace-pre-wrap rounded-[18px] bg-card px-3 py-2 text-[13px] leading-5 text-ink">
                  {exchangeBody(message)}
                </div>
                <div className="absolute bottom-0 start-0">
                  <BotAvatar bot={bot} state="happy" size={18} animated={false} />
                </div>
              </div>
            </div>
          );
        })}
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
  onGo,
}: {
  run: ExchangeRun;
  bots?: readonly Bot[];
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
  const phrase = t("chat.goToConversation");
  return (
    <div className="flex justify-center py-1">
      <button
        type="button"
        data-testid="bot-exchange-chip"
        onClick={() => {
          if (onGo?.()) return;
          setHeld(false);
          setOpen(true);
        }}
        aria-label={t("chat.goToConversationWith", { name: run.party.name })}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-raised"
      >
        <span>{phrase}</span>
        <BotAvatar bot={party} state="happy" size={16} animated={false} />
        <span className="font-medium" style={{ color: mausInk(party.color) }}>{run.party.name}</span>
      </button>
      {shown && (
        <ExchangeSheet
          run={run}
          bots={bots}
          onClose={() => {
            setOpen(false);
            setHeld(true);
          }}
        />
      )}
    </div>
  );
}
