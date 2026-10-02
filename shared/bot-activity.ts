// What a bot is doing and did lately, as its side panel lists it (Details >
// Coding): its conversations' engine sessions (Claude Code, Codex, ...), the
// work other bots handed it (coordinate_bots, delegations), the sub-agents
// it handed to other bots, and its routine runs. Served by
// GET /api/bots/:id/activity (server/routes/bot-activity.ts), narrowed to
// what the asking person may read: on an organization server their own
// threads only, and the routines they may see (routineSeenBy).
import type { WireAccessCard } from "./wire.ts";

export type BotActivityKind = "session" | "routine" | "hop" | "subagent";

/** running: a turn is in flight; waiting: it waits for a person (an
 * approval, a question); queued: not started yet. */
export type BotActivityStatus = "running" | "waiting" | "queued" | "finished" | "failed" | "stopped";

export interface BotActivityActor {
  kind: "person" | "bot" | "routine";
  name: string;
}

export interface BotActivityItem {
  /** `thread:<threadId>` or `run:<routineRunId>` */
  id: string;
  kind: BotActivityKind;
  /** The bot the work runs on (another bot's, for a sub-agent). */
  botId: string;
  botName?: string;
  title: string;
  status: BotActivityStatus;
  startedAt: number;
  /** Absent while it runs. */
  endedAt?: number;
  updatedAt: number;
  /** Present only when the viewer may open that conversation. */
  threadId?: string;
  startedBy?: BotActivityActor;
  /** Sub-agents and hops this one started, counted for the card. */
  childCount?: number;
}

export interface BotActivityStep {
  id: string;
  name: string;
  summary?: string;
  /** undefined while the call runs */
  ok?: boolean;
  at: number;
  /** Organization server: the person's own computer (the desktop bridge)
   * or their server environment. Absent on a solo server. */
  where?: "computer" | "server";
  files?: string[];
}

export interface BotActivityDetail extends BotActivityItem {
  engine?: { instanceId: string; model: string };
  /** Whose credentials the newest turn ran with (TurnDigest.access). */
  via?: "subscription" | "owner-key" | "speaker-key" | "server" | "org-key";
  payer?: "speaker" | "owner" | "organization";
  steps: BotActivityStep[];
  /** Older steps exist beyond the ones listed. */
  stepsTruncated: boolean;
  files: string[];
  children: BotActivityItem[];
  /** A routine run's error or the question it waits on. */
  note?: string;
  /** The viewer may stop it now. */
  canStop: boolean;
  /** A failed routine run refused for lack of credentials (or paused): its
   * access card, only when the viewer is in the card's audience
   * (accessCardAudience). The bot's owner reads it here even when the run's
   * thread is another person's private one; nothing else of that thread. */
  access?: WireAccessCard;
}

export const BOT_ACTIVITY_LIMIT = 20;
export const BOT_ACTIVITY_WINDOW_MS = 7 * 24 * 60 * 60_000;
export const BOT_ACTIVITY_STEPS = 200;

export function activityStatusActive(status: BotActivityStatus): boolean {
  return status === "running" || status === "waiting" || status === "queued";
}
