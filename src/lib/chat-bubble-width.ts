// How wide a chat bubble may grow. Prose keeps the narrow reading measure;
// tables, diagrams, charts, widgets and email drafts get a wide card; a live
// terminal takes the whole transcript column (less the gutter the other rows
// keep), so a shell prompt has its columns and the widget follows the column.
/** The transcript column of a conversation: a 1:1 (ChatView), a room
 * (GroupView) and an open bot-to-bot conversation (BotExchangeChip) share it,
 * inside a scroll pane with a px-5 gutter. */
export const CHAT_COLUMN_CLASS = "mx-auto flex w-full max-w-[960px] flex-col gap-3";

export type ChatBubbleWidth = "fit" | "wide" | "column";

export const CHAT_BUBBLE_WIDTH_CLASS: Record<ChatBubbleWidth, string> = {
  fit: "w-fit max-w-[min(80%,560px,calc(100%-82px))]",
  wide: "w-full max-w-[min(94%,780px,calc(100%-82px))]",
  column: "w-full max-w-[calc(100%-82px)]",
};

export function chatBubbleWidth({ terminal, wide }: { terminal: boolean; wide: boolean }): ChatBubbleWidth {
  if (terminal) return "column";
  return wide ? "wide" : "fit";
}
