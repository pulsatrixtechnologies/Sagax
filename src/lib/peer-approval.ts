// A card for one of Sagax's teammate tools (agents__coordinate_bots,
// ask_bot, delegate_bot, send_to_bot, post_to_room) reads as who it writes
// to and what it says, never as the bot ids and JSON the tool was called
// with. Covers both a Grok-gate MCP card (`agents__send_to_bot`) and the
// harness-native peer-review card (`tool: "send_to_bot"`, allowKey
// `send_to_bot:<id>`).
import { parseArgs, parseToolId } from "../../shared/approval-describe";
import type { OptionCardData } from "@/state/store";

export type PeerApprovalKind = "write" | "ask" | "post";

export interface PeerApproval {
  kind: PeerApprovalKind;
  /** the teammates, in the order the bot named them */
  botIds: string[];
  /** the room, for post_to_room */
  roomIds?: string[];
  /** what the bot sends them, as it wrote it */
  message?: string;
}

const PEER_TOOLS: Record<string, PeerApprovalKind> = {
  coordinate_bots: "write",
  delegate_bot: "write",
  send_to_bot: "write",
  ask_bot: "ask",
  post_to_room: "post",
};

const PEER_ALLOW = /^(ask_bot|delegate_bot|send_to_bot|post_to_room):(.+)$/;

/** Kind for Sagax's own agents tools: `agents__send_to_bot` or the bare
 * harness name `send_to_bot`. Another server of the same name is not ours. */
function peerToolKind(tool: string): PeerApprovalKind | undefined {
  const { server, name } = parseToolId(tool);
  if (server && server !== "agents") return undefined;
  return PEER_TOOLS[name];
}

/** The gate's subtitle (`agents__coordinate_bots {...}`) without the tool
 * id in front, or undefined when it does not start with it. */
export function subtitleArgs(card: Pick<OptionCardData, "subtitle" | "mcpTool" | "tool">): string | undefined {
  const subtitle = card.subtitle?.trim() ?? "";
  const tool = card.mcpTool ?? card.tool;
  return tool && subtitle.startsWith(`${tool} `) ? subtitle.slice(tool.length + 1).trim() : undefined;
}

/** A JSON object cut short (the gate caps a preview at 2,000 characters and
 * ends it with "…"): the teammate ids, the room, and as much of the message as came. */
function looseArgs(text: string): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  const list = /"(?:bot_ids|botIds)"\s*:\s*\[([^\]]*)/.exec(text);
  if (list) out.bot_ids = [...list[1]!.matchAll(/"([^"\\]+)"/g)].map((match) => match[1]);
  const one = /"(?:bot_id|botId)"\s*:\s*"([^"\\]+)"/.exec(text);
  if (one) out.bot_id = one[1];
  const room = /"(?:group_id|groupId)"\s*:\s*"([^"\\]+)"/.exec(text);
  if (room) out.group_id = room[1];
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

function idsOf(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    const list = Array.isArray(value) ? value : value !== undefined ? [value] : [];
    for (const item of list) {
      if (typeof item === "string" && item.trim() && !out.includes(item)) out.push(item);
    }
  }
  return out;
}

function messageOf(card: Pick<OptionCardData, "subtitle" | "mcpTool" | "tool">, args: Record<string, unknown> | undefined): string | undefined {
  const text = args?.message ?? args?.question ?? args?.task ?? args?.prompt;
  if (typeof text === "string" && text.trim()) return text.trim();
  const sub = card.subtitle?.trim();
  if (!sub) return undefined;
  const tool = card.mcpTool ?? card.tool;
  if (tool && sub.startsWith(`${tool} `)) return undefined;
  if (sub.startsWith("{") || sub.startsWith("[")) return undefined;
  return sub;
}

function targetFromAllowKey(allowKey: string | undefined): { action: string; id: string } | undefined {
  if (!allowKey) return undefined;
  const match = PEER_ALLOW.exec(allowKey);
  return match ? { action: match[1]!, id: match[2]! } : undefined;
}

export function peerApproval(card: Pick<OptionCardData, "toolInput" | "subtitle" | "mcpTool" | "tool" | "allowKey">): PeerApproval | undefined {
  const tool = card.mcpTool ?? card.tool;
  if (!tool) return undefined;
  const kind = peerToolKind(tool);
  if (!kind) return undefined;
  const args = cardArgs(card);
  const granted = targetFromAllowKey(card.allowKey);
  const text = messageOf(card, args);
  const message = text ? { message: text } : {};
  if (kind === "post") {
    const roomIds = idsOf(args?.group_id, args?.groupId, granted?.action === "post_to_room" ? granted.id : undefined);
    if (!roomIds.length) return undefined;
    return { kind, botIds: [], roomIds, ...message };
  }
  const many = args?.bot_ids ?? args?.botIds;
  const one = args?.bot_id ?? args?.botId ?? args?.to_bot_id;
  const fromKey = granted && granted.action !== "post_to_room" ? granted.id : undefined;
  const botIds = idsOf(many, one, fromKey);
  if (!botIds.length) return undefined;
  return { kind, botIds, ...message };
}
