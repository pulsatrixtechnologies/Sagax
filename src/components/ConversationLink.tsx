// The one way a transcript says "Go to conversation": a centered, quiet line
// (phrase, the bot's mark, the bot's name). Used by the collapsed bot-to-bot
// exchange and by the opened-thread receipt, so they cannot drift apart.
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";
import { mausInk, type MausColor } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";

export function ConversationLink({
  bot,
  name,
  color,
  onClick,
  label,
  title,
  testId,
  attributes,
  children,
}: {
  bot: { name: string; color: MausColor } & Partial<Bot>;
  name: string;
  color: MausColor;
  onClick: () => void;
  label?: string;
  title?: string;
  testId?: string;
  attributes?: Record<string, string>;
  /** Rendered beside the line, e.g. an opened sheet. */
  children?: ReactNode;
}) {
  return (
    <div className="flex justify-center py-1">
      <button
        type="button"
        {...(testId ? { "data-testid": testId } : {})}
        {...attributes}
        onClick={onClick}
        {...(label ? { "aria-label": label } : {})}
        {...(title ? { title } : {})}
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-raised"
      >
        <span>{t("chat.goToConversation")}</span>
        <BotAvatar bot={bot as Bot} state="happy" size={16} animated={false} />
        <span className="font-medium" style={{ color: mausInk(color) }}>{name}</span>
      </button>
      {children}
    </div>
  );
}
