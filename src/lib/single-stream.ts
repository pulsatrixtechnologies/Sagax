// The single stream on this client (Show threads off, the default since
// 2026-10-17): a bot is one continuous conversation. Its segments are its
// threads (shared/single-stream.ts); the newest one is live (the composer
// writes there), earlier ones are drawn above it, each under a "New topic"
// divider. Navigation lands at the newest segment and scrolls back to an
// older message instead of switching threads, so nothing is ever "elsewhere".
// docs/single-stream-orchestration.md.
import { earlierSegments, isStreamSegment, latestSegment, type StreamTaskFacts } from "../../shared/single-stream";

export { earlierSegments, isStreamSegment, latestSegment };

type StreamTasks = ReadonlyArray<{ threadId: string; updatedAt?: number; busy?: boolean; unread?: boolean; activity?: string } & Partial<Omit<StreamTaskFacts, "threadId">>> | undefined;

/** The tasks the stream rule can read: only those with a creation time. */
function facts(tasks: StreamTasks): StreamTaskFacts[] {
  return (tasks ?? []).filter((task): task is StreamTaskFacts => typeof task.createdAt === "number");
}

/** Nobody wrote there yet and nothing runs or waits (a New topic not yet
 * used, or one another device opened and left). */
function untouched(task: NonNullable<StreamTasks>[number]): boolean {
  if (task.busy || task.unread || task.activity === "working" || task.activity === "waiting-on-you") return false;
  return typeof task.updatedAt === "number" && typeof task.createdAt === "number" && task.updatedAt <= task.createdAt;
}

/** The thread a bot opens to in the stream: its newest segment with
 * something in it, or the newest one when `selected` is it (a New topic just
 * started here), or nothing when it has no segment (the caller keeps its
 * older rule). An empty topic another device left never strands the person. */
export function streamHomeThread(tasks: StreamTasks, selected?: string): string | undefined {
  const list = tasks ?? [];
  const byId = new Map(list.map((task) => [task.threadId, task]));
  const segments = facts(list).filter(isStreamSegment).sort((a, b) => b.createdAt - a.createdAt || b.threadId.localeCompare(a.threadId));
  const newest = segments[0];
  if (!newest) return undefined;
  if (newest.threadId === selected) return newest.threadId;
  return (segments.find((task) => !untouched(byId.get(task.threadId)!)) ?? newest).threadId;
}

/** Whether `threadId` is a segment of this bot's stream other than the
 * newest: a link there opens the stream and scrolls back to it. */
export function isEarlierSegment(tasks: StreamTasks, threadId: string, selected?: string): boolean {
  const home = streamHomeThread(tasks, selected);
  if (!home || home === threadId) return false;
  return facts(tasks).some((task) => task.threadId === threadId && isStreamSegment(task));
}

/** The earlier segments shown above `threadId`, newest first (the order
 * scrolling back reaches them). */
export function segmentsAbove<T extends StreamTaskFacts>(tasks: readonly T[] | undefined, threadId: string): T[] {
  return earlierSegments(tasks, threadId).reverse();
}

/** How many earlier segments to load so that `threadId` is on screen:
 * every segment from the newest earlier one back to it. Zero when it is not
 * an earlier segment. */
export function segmentsToReach<T extends StreamTaskFacts>(tasks: readonly T[] | undefined, currentThreadId: string, threadId: string): number {
  const above = segmentsAbove(tasks, currentThreadId);
  const at = above.findIndex((task) => task.threadId === threadId);
  return at < 0 ? 0 : at + 1;
}

/** With threads hidden: the unread threads the one conversation holds
 * besides `shownThreadId`, read with it when it is on screen. Its other
 * segments (drawn above it) and the parallel tasks of a segment (their
 * answer is posted in the conversation, #1145). Nothing when the thread on
 * screen is not a segment (a confidential or bot-opened thread is shown
 * alone). No thread gets a sidebar row of its own in this mode, so a reply
 * left unread there would keep the bot's badge up for good. */
export function streamUnreadReadWith(tasks: StreamTasks, shownThreadId: string): string[] {
  const all = facts(tasks);
  const shown = all.find((task) => task.threadId === shownThreadId);
  if (!shown || !isStreamSegment(shown)) return [];
  const segments = new Set(all.filter(isStreamSegment).map((task) => task.threadId));
  const inStream = (task: NonNullable<StreamTasks>[number]) => {
    const source = parallelSource(task);
    return segments.has(task.threadId) || (source !== undefined && segments.has(source));
  };
  return (tasks ?? []).filter((task) => task.unread === true && task.threadId !== shownThreadId && inStream(task))
    .map((task) => task.threadId);
}

function parallelSource(task: NonNullable<StreamTasks>[number]): string | undefined {
  const of = task.parallelOf as { threadId?: unknown } | undefined;
  return typeof of?.threadId === "string" ? of.threadId : undefined;
}
