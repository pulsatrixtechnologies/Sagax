// "Conversation with <bot>": the bot-to-bot exchange, shown folded in BOTH
// bots' chats (WireBot.botConversations, server/inter-bot-conversations.ts).
// The server only names a conversation to a viewer who may read it, on both
// bots; the messages come from the same thread route as any conversation.
import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { api, useStore, type Bot, type Message } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";

/** The plain text lines of one conversation, each with who said it. The
 * thread belongs to the destination bot: a line names its speaker (`from`),
 * else a user line is the origin bot's words. Receipts, cards and empty rows are left out. */
export function conversationLines(messages: readonly Message[], mine: string, other: string, direction: "in" | "out"): { id: string; who: string; text: string }[] {
  const origin = direction === "in" ? other : mine;
  const destination = direction === "in" ? mine : other;
  return messages
    .filter((message) => message.kind === "text" && typeof message.text === "string" && message.text.trim() !== "")
    .map((message) => ({ id: message.id, who: message.from?.name ?? (message.role === "user" ? origin : destination), text: message.text!.trim() }));
}

function Row({ bot, row, bots }: { bot: Pick<Bot, "id" | "name">; row: NonNullable<Bot["botConversations"]>[number]; bots: readonly Bot[] }) {
  const { dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const other = bots.find((candidate) => candidate.id === row.otherBotId);
  useEffect(() => {
    if (!open) return;
    let live = true;
    api<{ messages?: Message[] }>(`/api/threads/${row.threadId}/messages?limit=60`)
      .then((page) => { if (live) setMessages(page.messages ?? []); })
      .catch(() => { if (live) setMessages([]); });
    return () => { live = false; };
  }, [open, row.threadId, row.updatedAt]);
  const lines = messages ? conversationLines(messages, bot.name, row.otherName, row.direction) : [];
  return (
    <div data-bot-conversation={row.direction} className="rounded-lg border border-hairline/40 bg-inset text-[12px] text-ink-secondary">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:text-ink">
        {open ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
        {other && <BotAvatar bot={other} size={18} />}
        <span className="min-w-0 flex-1 truncate">{t("chat.botConversation.title", { name: row.otherName })}</span>
        {row.running && <span data-bot-conversation-working role="status" className="shrink-0 text-[11px] text-success">{t("chat.botConversation.working")}</span>}
      </button>
      {row.running && <div className="flex justify-end px-3 pb-1.5">
        <button type="button" data-bot-conversation-stop onClick={() => dispatch({ type: "stopParallelTask", botId: row.direction === "in" ? bot.id : row.otherBotId, threadId: row.threadId })} className="rounded px-2 py-0.5 text-[11.5px] hover:bg-raised hover:text-ink">{t("chat.botConversation.stop")}</button>
      </div>}
      {open && <div className="flex flex-col gap-1.5 border-t border-hairline/40 px-3 py-2">
        {messages === null && <span>{t("chat.botConversation.loading")}</span>}
        {messages !== null && lines.length === 0 && <span>{t("chat.botConversation.empty")}</span>}
        {lines.map((line) => (
          <p key={line.id} className={cn("whitespace-pre-wrap break-words text-ink")}>
            <span className="font-medium text-ink-secondary">{line.who}</span>{" : "}{line.text}
          </p>
        ))}
      </div>}
    </div>
  );
}

export function BotConversations({ bot, bots }: { bot: Bot; bots: readonly Bot[] }) {
  const rows = bot.botConversations ?? [];
  if (rows.length === 0) return null;
  return (
    <div data-bot-conversations className="mx-5 mb-2 flex flex-col gap-1.5">
      {rows.map((row) => <Row key={row.threadId} bot={bot} row={row} bots={bots} />)}
    </div>
  );
}
