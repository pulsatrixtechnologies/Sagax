// How wide a chat bubble may grow. Prose keeps the narrow reading measure;
// tables, diagrams, charts, widgets and email drafts get a wide card; a live
// terminal takes the whole transcript column (less the gutter the other rows
// keep), so a shell prompt has its columns and the widget follows the column.
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
