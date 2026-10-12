// Coding agents a bot launched through the agent-to-agent API (send_prompt on
// a peer's hidden conversation). Listed in the bot panel Details > Coding
// (GET /api/bots/:id/activity `launchedAgents`).
import type { BotActivityStatus } from "./bot-activity.ts";

export interface BotLaunchedAgentPullRequest {
  number: number;
  url?: string;
}

export interface BotLaunchedAgentItem {
  /** `thread:<threadId>` on the target bot */
  id: string;
  /** The bot that runs the agent (the peer that was prompted). */
  targetBotId: string;
  targetBotName: string;
  /** Shown as “{targetBotName}: {title}”. */
  title: string;
  status: BotActivityStatus;
  startedAt: number;
  updatedAt: number;
  /** Open the agent's hidden conversation when the viewer may read it. */
  threadId?: string;
  /** The pull request tied to a failed run, when the agent opened one. */
  pullRequest?: BotLaunchedAgentPullRequest;
}

export const BOT_LAUNCHED_AGENTS_LIMIT = 20;
export const BOT_LAUNCHED_AGENTS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
