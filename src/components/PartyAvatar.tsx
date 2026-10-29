// One end of a bot-to-bot exchange: the bot's own mascot, or a neutral icon
// for an outside agent (a person's AI client over MCP, `agent:` ids,
// shared/agent-conversation.ts), which has no mascot of its own.
import { Cpu } from "lucide-react";
import { AGENT_OPENER_PREFIX } from "../../shared/agent-conversation";
import type { MausColor } from "@/lib/mascot";
import type { Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";

/** Whether an exchange party is an outside agent, not a bot. */
export function isAgentParty(id: string | undefined): boolean {
  return typeof id === "string" && id.startsWith(AGENT_OPENER_PREFIX);
}

export function PartyAvatar({ id, bot, size }: { id?: string; bot: { name: string; color: MausColor } & Partial<Bot>; size: number }) {
  if (!isAgentParty(id)) return <BotAvatar bot={bot as Bot} state="happy" size={size} animated={false} />;
  return <AgentIcon size={size} />;
}

/** The neutral icon of an outside agent. */
export function AgentIcon({ size }: { size: number }) {
  return (
    <span
      data-agent-avatar=""
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-raised text-ink-secondary"
      style={{ width: size, height: size }}
    >
      <Cpu size={Math.round(size * 0.62)} strokeWidth={2} />
    </span>
  );
}
