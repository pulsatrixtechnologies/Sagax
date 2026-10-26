import { extractMcpImages } from "../../mcp-tool-images.ts";
import { toolDetailPreview } from "../../tool-summary.ts";

export type AcpToolEndEvent = { type: "item.completed" } & (
  | { itemType: "tool"; itemId: string | undefined; ok: boolean; output?: string; [field: string]: unknown }
  | { itemType: "assistant_image"; data: string }
);

/**
 * The events that end a finished tool item: its completion, then any images its result carries. An item already in
 * `ended` gets none, and an item that ends here joins it: ACP v1 lets an update name a tool call that already
 * finished, and a `tool_call` may arrive already completed or failed with no update after it. `toolFields` adds the
 * driver's own fields (a structured tool result) to the completion.
 */
export function acpToolEndEvents(
  update: { status?: unknown; rawOutput?: unknown; content?: unknown },
  itemId: string | undefined,
  ended: Set<string>,
  toolFields: Record<string, unknown> = {},
): AcpToolEndEvent[] {
  if (itemId !== undefined) {
    if (ended.has(itemId)) return [];
    ended.add(itemId);
  }
  return [
    { type: "item.completed", itemType: "tool", itemId, ok: update.status !== "failed",
      output: toolDetailPreview(update.rawOutput ?? update.content), ...toolFields },
    ...extractMcpImages(update.content ?? update.rawOutput).map((img): AcpToolEndEvent =>
      ({ type: "item.completed", itemType: "assistant_image", data: img.data })),
  ];
}
