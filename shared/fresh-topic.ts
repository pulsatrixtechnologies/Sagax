// Fresh topic on return (single stream, thread mode off; JC 2026-10-18).
//
// When a person comes back to a bot's conversation after a while, they land
// on a new, empty topic ("New topic") instead of the whole history: less on
// screen, and the bot still knows everything (the "Earlier topics" digest and
// recall_topic, docs/single-stream-orchestration.md). The earlier topics stay
// one discreet "Earlier topics" line away, and ⌘F still searches them.
//
// The rule, shared by the desktop (src/lib/fresh-topic.ts) and the phone
// (ios/Sources/CompanionCore/FreshTopic.swift, same test vectors in
// shared/fresh-topic.vectors.json):
// - a fresh topic only when the current topic has been quiet for longer than
//   the threshold (default 4 h, Settings > Appearance > Conversation), or the
//   person comes back after leaving the app or the bot for longer than that;
//   a person who was here a moment ago (left less than the threshold ago)
//   stays in the topic they just read, however old;
// - never over a live conversation: a turn running, an approval or a question
//   waiting, an unread answer, teammates still working, or a topic nobody
//   wrote in yet (it already is a new topic). The person stays where the
//   conversation waits;
// - the fresh topic is a draft: the server creates it (POST .../tasks
//   { stream: true }) only with the first message, so no empty topics pile up;
// - notifications and links into an earlier message always open that topic
//   (the callers that follow them never ask this rule).
//
// Pure: no clock, no storage.

/** Settings > Appearance > Conversation, per person (synced on an
 * organization server, shared/user-preferences.ts). Hours as a decimal
 * string; "0" never starts a fresh topic. Absent or unreadable is the default. */
export const FRESH_TOPIC_AFTER_KEY = "sagax.freshTopicAfter.v1";

export const FRESH_TOPIC_AFTER_DEFAULT_HOURS = 4;

/** The choices the setting offers, in hours (0 = never). */
export const FRESH_TOPIC_AFTER_CHOICES = [1, 2, 4, 8, 24, 0] as const;

export type FreshTopicAfterHours = (typeof FRESH_TOPIC_AFTER_CHOICES)[number];

const HOUR_MS = 60 * 60 * 1000;

export function parseFreshTopicAfter(value: unknown): FreshTopicAfterHours {
  const hours = typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return (FRESH_TOPIC_AFTER_CHOICES as readonly number[]).includes(hours)
    ? hours as FreshTopicAfterHours
    : FRESH_TOPIC_AFTER_DEFAULT_HOURS;
}

/** The threshold in milliseconds; 0 means never. */
export function freshTopicAfterMs(hours: FreshTopicAfterHours): number {
  return hours * HOUR_MS;
}

/** What the rule reads about the topic the bot would open to (a WireTask). */
export interface FreshTopicTask {
  createdAt: number;
  /** The newest message's time (the server's stamp). */
  updatedAt?: number;
  busy?: boolean;
  /** "working" | "waiting-on-you" | ... */
  activity?: string;
  unread?: boolean;
  waitingForTeammates?: boolean;
}

export interface FreshTopicInput {
  /** The topic the bot would open to (its newest segment); undefined when
   * the bot has no segment yet. */
  topic: FreshTopicTask | undefined;
  now: number;
  /** The threshold (freshTopicAfterMs); 0 never starts a fresh topic. */
  afterMs: number;
  /** When the person last left this bot or the app, if known. */
  leftAt?: number;
  /** Messages waiting in the topic's queue on this client. */
  queued?: boolean;
}

export type FreshTopicReason =
  | "idle" // the topic has been quiet longer than the threshold
  | "away" // the person was away longer than the threshold
  | "never" // the setting is off
  | "no-topic" // nothing to come back to
  | "untouched" // the topic is still empty: it already is a new topic
  | "live" // a turn runs, teammates work or messages wait in the queue
  | "waiting" // an approval or a question waits on the person
  | "unread" // an answer the person has not read yet
  | "seen" // quiet for long, but the person was here a moment ago
  | "recent"; // neither quiet nor away for long enough

export interface FreshTopicDecision {
  fresh: boolean;
  reason: FreshTopicReason;
}

/** Whether coming back should land on a fresh topic. */
export function freshTopicOnReturn(input: FreshTopicInput): FreshTopicDecision {
  const { topic, now, afterMs } = input;
  if (!(afterMs > 0)) return { fresh: false, reason: "never" };
  if (!topic) return { fresh: false, reason: "no-topic" };
  if (topic.busy || topic.activity === "working" || topic.waitingForTeammates || input.queued) return { fresh: false, reason: "live" };
  if (topic.activity === "waiting-on-you") return { fresh: false, reason: "waiting" };
  if (topic.unread) return { fresh: false, reason: "unread" };
  // No stamp, or a stamp no newer than its birth: nobody wrote there yet.
  if (typeof topic.updatedAt !== "number" || topic.updatedAt <= topic.createdAt) return { fresh: false, reason: "untouched" };
  const left = typeof input.leftAt === "number" ? input.leftAt : undefined;
  // Here a moment ago (another bot, another app for a minute): the topic
  // the person just read stays, however old it is.
  if (left !== undefined && now - left <= afterMs) return { fresh: false, reason: now - topic.updatedAt > afterMs ? "seen" : "recent" };
  // Something happened there since they left (an answer that finished while
  // the window was hidden is already marked read): they see it first.
  if (left !== undefined && topic.updatedAt > left) return { fresh: false, reason: "unread" };
  if (left !== undefined) return { fresh: true, reason: "away" };
  if (now - topic.updatedAt > afterMs) return { fresh: true, reason: "idle" };
  return { fresh: false, reason: "recent" };
}
