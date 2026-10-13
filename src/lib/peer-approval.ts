// A card for one of Sagax's teammate tools (agents__coordinate_bots,
// ask_bot, delegate_bot, send_to_bot) reads as who it writes to and what it
// says, never as the bot ids and JSON the tool was called with.
import { parseArgs, parseToolId } from "../../shared/approval-describe";
import type { OptionCardData } from "@/state/store";

export type PeerApprovalKind = "write" | "ask";

export interface PeerApproval {
  kind: PeerApprovalKind;
  /** the teammates, in the order the bot named them */
  botIds: string[];
  /** what the bot sends them, as it wrote it */
  message?: string;
}

const PEER_TOOLS: Record<string, PeerApprovalKind> = {
  coordinate_bots: "write",
  delegate_bot: "write",
  send_to_bot: "write",
  ask_bot: "ask",
};

/** The gate's subtitle (`agents__coordinate_bots {...}`) without the tool
 * id in front, or undefined when it does not start with it. */
export function subtitleArgs(card: Pick<OptionCardData, "subtitle" | "mcpTool" | "tool">): string | undefined {
  const subtitle = card.subtitle?.trim() ?? "";
  const tool = card.mcpTool ?? card.tool;
  return tool && subtitle.startsWith(`${tool} `) ? subtitle.slice(tool.length + 1).trim() : undefined;
}

/** A JSON object cut short (the gate caps a preview at 2,000 characters and
 * ends it with "…"): the teammate ids and as much of the message as came. */
function looseArgs(text: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  const list = /"(?:bot_ids|botIds)"\s*:\s*\[([^\]]*)/.exec(text);
  if (list) out.bot_ids = [...list[1]!.matchAll(/"([^"\\]+)"/g)].map((match) => match[1]);
  const one = /"(?:bot_id|botId)"\s*:\s*"([^"\\]+)"/.exec(text);
  if (one) out.bot_id = one[1];
  const message = /"(?:message|question)"\s*:\s*"((?:\\.|[^"\\])*)("?)/.exec(text);
  if (message) {
    let value = message[1]!;
    try { value = JSON.parse(`"${value.replace(/\\$/, "")}"`) as string; } catch { /* keep it as sent */ }
    out.message = message[2] ? value : `${value.replace(/…$/, "")}…`;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The card's arguments: its JSON input, else the gate's subtitle with the
 * tool id taken off, else what can be read from either when cut short. */
export function cardArgs(card: Pick<OptionCardData, "toolInput" | "subtitle" | "mcpTool" | "tool">): Record<string, unknown> | undefined {
  const rest = subtitleArgs(card) ?? card.subtitle;
  return parseArgs(card.toolInput) ?? parseArgs(rest)
    ?? (card.toolInput ? looseArgs(card.toolInput) : undefined) ?? (rest ? looseArgs(rest) : undefined);
}

export function peerApproval(card: Pick<OptionCardData, "toolInput" | "subtitle" | "mcpTool" | "tool">): PeerApproval | undefined {
  const tool = card.mcpTool ?? card.tool;
  if (!tool) return undefined;
  const { server, name } = parseToolId(tool);
  const kind = PEER_TOOLS[name];
  if (server !== "agents" || !kind) return undefined;
  const args = cardArgs(card);
  if (!args) return undefined;
  const many = args.bot_ids ?? args.botIds;
  const one = args.bot_id ?? args.botId ?? args.to_bot_id;
  const botIds = (Array.isArray(many) ? many : typeof one === "string" ? [one] : [])
    .filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  if (!botIds.length) return undefined;
  const text = args.message ?? args.question ?? args.task ?? args.prompt;
  return { kind, botIds, ...(typeof text === "string" && text.trim() ? { message: text.trim() } : {}) };
}
