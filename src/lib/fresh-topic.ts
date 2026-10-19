// Fresh topic on return, the desktop half (shared/fresh-topic.ts has the
// rule). Coming back to a bot's conversation after the threshold lands on a
// new, empty topic: a draft the store keeps (AppState.freshTopic) until the
// first message creates it on the server. This module holds the person's
// threshold (Settings > Appearance > Conversation), when they left each bot
// or the app (this device only), and which bot is on screen.
import { useSyncExternalStore } from "react";
import {
  FRESH_TOPIC_AFTER_KEY,
  freshTopicAfterMs,
  freshTopicOnReturn,
  parseFreshTopicAfter,
  type FreshTopicAfterHours,
  type FreshTopicDecision,
} from "../../shared/fresh-topic";
import { isStreamSegment } from "../../shared/single-stream";

export { FRESH_TOPIC_AFTER_CHOICES } from "../../shared/fresh-topic";
export type { FreshTopicAfterHours } from "../../shared/fresh-topic";

/** When the person left each bot or the app, on this device only. */
const LEFT_KEY = "sagax.freshTopicLeft.v1";
const LEFT_MAX = 200;

const listeners = new Set<() => void>();
let session: FreshTopicAfterHours | null = null;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readFreshTopicAfter(): FreshTopicAfterHours {
  if (session !== null) return session;
  try {
    return parseFreshTopicAfter(storage()?.getItem(FRESH_TOPIC_AFTER_KEY));
  } catch {
    return parseFreshTopicAfter(undefined);
  }
}

export function writeFreshTopicAfter(next: FreshTopicAfterHours): void {
  session = next;
  try {
    storage()?.setItem(FRESH_TOPIC_AFTER_KEY, String(next));
    session = null;
  } catch {
    // Storage refused: the choice holds for this session.
  }
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent) {
  if (event.key !== FRESH_TOPIC_AFTER_KEY && event.key !== null) return;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

export function useFreshTopicAfter(): FreshTopicAfterHours {
  return useSyncExternalStore(subscribe, readFreshTopicAfter, () => parseFreshTopicAfter(undefined));
}

// ── when the person left ────────────────────────────────────────────────

let leftCache: Record<string, number> | null = null;

function readLeft(): Record<string, number> {
  if (leftCache) return leftCache;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(storage()?.getItem(LEFT_KEY) ?? "null");
  } catch {
    parsed = null;
  }
  const out: Record<string, number> = {};
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof at === "number" && Number.isFinite(at)) out[id] = at;
    }
  }
  leftCache = out;
  return out;
}

function writeLeft(next: Record<string, number>): void {
  const kept = Object.entries(next).sort((a, b) => b[1] - a[1]).slice(0, LEFT_MAX);
  leftCache = Object.fromEntries(kept);
  try {
    storage()?.setItem(LEFT_KEY, JSON.stringify(leftCache));
  } catch {
    // Storage refused: this session still remembers.
  }
}

/** The person left `botId` (another bot, another view, the window hidden,
 * the app closing). */
export function noteLeftBot(botId: string, at: number): void {
  writeLeft({ ...readLeft(), [botId]: at });
}

/** The person is back with `botId`: its away time is spent. */
export function noteBackAtBot(botId: string): void {
  const left = readLeft();
  if (!(botId in left)) return;
  const { [botId]: _gone, ...rest } = left;
  writeLeft(rest);
}

export function leftBotAt(botId: string): number | undefined {
  return readLeft()[botId];
}

// ── the bot on screen ───────────────────────────────────────────────────

let onScreen: string | null = null;

/** The main chat says which bot it shows while the window is visible (null
 * when none): opening the bot already on screen is not a return. */
export function setOnScreenBot(botId: string | null): void {
  onScreen = botId;
}

export function onScreenBot(): string | null {
  return onScreen;
}

/** Test seam: forget this module's memory. */
export function resetFreshTopicMemory(): void {
  leftCache = null;
  onScreen = null;
  session = null;
}

// ── the landing ─────────────────────────────────────────────────────────

type LandingTask = {
  threadId: string;
  createdAt?: number;
  updatedAt?: number;
  busy?: boolean;
  activity?: string;
  unread?: boolean;
  waitingForTeammates?: boolean;
  routineRunId?: unknown;
  hidden?: unknown;
  confidential?: unknown;
  openedBy?: unknown;
  parallelOf?: unknown;
};

/** Whether opening `bot` at `threadId` (its newest segment) lands on a
 * fresh topic. Only a stream segment can: a confidential, hidden or
 * bot-opened thread opens alone, as it is. */
export function freshTopicLanding(
  bot: { id: string; busy?: boolean; tasks?: readonly LandingTask[] },
  threadId: string,
  options: { now: number; queued?: boolean; force?: boolean } = { now: Date.now() },
): FreshTopicDecision {
  const task = bot.tasks?.find((candidate) => candidate.threadId === threadId);
  if (!options.force && onScreen === bot.id) return { fresh: false, reason: "recent" };
  if (!task || typeof task.createdAt !== "number" || !isStreamSegment({ ...task, createdAt: task.createdAt })) {
    return { fresh: false, reason: "no-topic" };
  }
  const leftAt = leftBotAt(bot.id);
  return freshTopicOnReturn({
    topic: { ...task, createdAt: task.createdAt },
    now: options.now,
    afterMs: freshTopicAfterMs(readFreshTopicAfter()),
    ...(leftAt !== undefined ? { leftAt } : {}),
    ...(options.queued ? { queued: true } : {}),
  });
}
