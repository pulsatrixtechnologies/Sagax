// Single stream (thread mode off): one continuous conversation per bot.
//
// With Settings > Conversations > "One conversation", the person sees one
// conversation per bot, like the reference design: whatever arrives (a typed
// message, a call, a routine's report, an AI client's ask, another device's
// turn, a notification answered) lands in that one conversation, in time
// order, and its history loads upward. "New topic" does not hide what came
// before: it starts a fresh engine context (a new thread on the server) and
// the app keeps drawing one timeline. Each thread of that stream is a
// "segment". The data model is the existing threads: nothing is moved or
// copied, so turning threads back on shows the same segments as threads
// again (docs/single-stream-orchestration.md).
//
// This file is THE rule, read by the server (where a routine, a peer, a
// webhook, a call or an AI client lands; WireBot.mainThreadId), the desktop
// (which thread a bot opens to, what the timeline draws) and the phone
// (CompanionCore/SingleStream.swift, the same cases in
// shared/single-stream.vectors.json). Nobody else decides which thread is
// "the conversation": one rule, one place, so no path can drift again.
//
// Pure: no store, no clock.

/** The thread fields the stream rule reads (WireTask and TaskRecord alike). */
export interface StreamTaskFacts {
  threadId: string;
  createdAt: number;
  routineRunId?: unknown;
  routineResults?: unknown;
  hidden?: unknown;
  confidential?: unknown;
  openedBy?: unknown;
  parallelOf?: unknown;
  /** Archived by the person (Reset history, Archive): out of the timeline,
   * kept with threads shown. */
  archivedAt?: unknown;
  /** Closed by close_thread: a job that ended, never the live end. */
  closedBy?: unknown;
}

/** Whether a thread is a segment of its bot's stream: a conversation a person
 * had with the bot. Never a routine run, an AI client's hidden conversation
 * (#291), a confidential thread (#683, kept to itself), a thread a bot opened
 * (a job or a pair conversation, reached by its own link), a parallel task
 * (its card and result already sit in the conversation that asked), an
 * automatic routine results thread (2026-10-22: "everything should be unified
 * in a single chat page"), an archived thread or a closed one. */
export function isStreamSegment(task: StreamTaskFacts): boolean {
  return !task.routineRunId && task.routineResults !== true && task.hidden !== true && task.confidential !== true
    && !task.openedBy && !task.parallelOf && !present(task.archivedAt) && !task.closedBy;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== false;
}

/** A bot's stream segments, oldest first (the order the person reads). The
 * caller passes the threads this viewer may see (narrowBotForViewer on an
 * organization server), so a shared bot gives each person their own stream. */
export function streamSegments<T extends StreamTaskFacts>(tasks: readonly T[] | undefined): T[] {
  return (tasks ?? []).filter(isStreamSegment).sort((a, b) => a.createdAt - b.createdAt || a.threadId.localeCompare(b.threadId));
}

/** The segments drawn before `threadId` in the stream, oldest first. Empty
 * when the thread is not a segment (a confidential or hidden thread is shown
 * alone, as before). */
export function earlierSegments<T extends StreamTaskFacts>(tasks: readonly T[] | undefined, threadId: string): T[] {
  const segments = streamSegments(tasks);
  const at = segments.findIndex((task) => task.threadId === threadId);
  return at < 0 ? [] : segments.slice(0, at);
}

/** The segment a send goes to: the newest one. A deep link to an older
 * segment scrolls the stream there; the composer still writes at the end. */
export function latestSegment<T extends StreamTaskFacts>(tasks: readonly T[] | undefined): T | undefined {
  return streamSegments(tasks).at(-1);
}

/** THE conversation a person has with a bot: its newest segment. Where the
 * composer writes, where the bot opens, where a routine's report, a peer's
 * ask, a webhook's news, a call's turns and an AI client's work land, on
 * every device. Undefined when the person has no segment yet (a thread is
 * started for them then; a new empty segment is still the conversation: the
 * timeline above it is drawn from the earlier segments, so an empty newest
 * one never strands anybody). */
export function conversationThread<T extends StreamTaskFacts>(tasks: readonly T[] | undefined): T | undefined {
  return latestSegment(tasks);
}

/** The id of the conversation thread, for callers that only need it. */
export function conversationThreadId(tasks: readonly StreamTaskFacts[] | undefined): string | undefined {
  return conversationThread(tasks)?.threadId;
}

/** Whether `threadId` is an earlier segment of the stream: a link, a search
 * hit or a notification there scrolls the one conversation back to it
 * instead of switching threads. */
export function isEarlierStreamSegment(tasks: readonly StreamTaskFacts[] | undefined, threadId: string): boolean {
  const home = conversationThreadId(tasks);
  return home !== undefined && home !== threadId && earlierSegments(tasks, home).some((task) => task.threadId === threadId);
}

/** Whether `threadId` is a thread of the bot that is not part of its stream
 * (a job, a run, a parallel task, a confidential thread): with one
 * conversation it opens beside the conversation, never in its place. False
 * for the conversation itself, an earlier segment, or an unknown thread. */
export function opensBesideConversation(tasks: readonly StreamTaskFacts[] | undefined, threadId: string): boolean {
  const task = (tasks ?? []).find((candidate) => candidate.threadId === threadId);
  return Boolean(task) && !isStreamSegment(task!);
}
