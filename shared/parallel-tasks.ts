// Parallel tasks: a request sent to a bot that is already working can run as
// its own task instead of joining or waiting behind the running turn.
//
// A parallel task is an ordinary thread of the same bot (same persona,
// memory and tools, its own engine session and working context) linked to
// the conversation it was asked from (`WireTask.parallelOf`). The
// conversation shows the request, a live task card (`Message.parallelTask`)
// and, when the task settles, its result as a reply quoting the request.
// Server: server/parallel-tasks.ts and the send route in server/index.ts.

/** What a message sent while the bot is busy does.
 * - steer: join the running turn (today's behavior; queued when the engine
 *   cannot take it live).
 * - parallel: run as its own task, in parallel.
 * - after: wait for the running turn, then run (the queue). */
export type BusySendMode = "steer" | "parallel" | "after";

export const BUSY_SEND_MODES: readonly BusySendMode[] = ["steer", "parallel", "after"];

/** The person's default for a busy send (localStorage, synced per person on an
 * organization server): "ask" offers the three choices each time. */
export type BusySendPreference = "ask" | BusySendMode;

export const BUSY_SEND_PREFERENCE_KEY = "sagax.busySend.v1";

export function isBusySendMode(value: unknown): value is BusySendMode {
  return value === "steer" || value === "parallel" || value === "after";
}

export function parseBusySendPreference(value: unknown): BusySendPreference {
  return value === "ask" || isBusySendMode(value) ? value : "ask";
}

/** Where a parallel task stands, as its card in the conversation shows it. */
export type ParallelTaskState = "queued" | "running" | "done" | "failed" | "stopped";

/** On a conversation's messages: the request line, the task card and the
 * result reply all carry the task they belong to. */
export interface ParallelTaskRef {
  /** The task's own thread (same bot). */
  threadId: string;
  /** Short name of the task, as its sidebar row reads. */
  title: string;
  /** The person's request line in the conversation the task answers. */
  requestMessageId: string;
  /** request: the person's words; card: the live card; result: the answer. */
  role: "request" | "card" | "result";
  /** On the card only: the last state the server recorded. While the task
   * runs, clients read live state from the task itself (busy, activity). */
  state?: ParallelTaskState;
  startedAt?: number;
  endedAt?: number;
}

/** On a task opened as a parallel task: the conversation it answers. */
export interface TaskParallelOf {
  threadId: string;
  /** The request line in that conversation. */
  messageId: string;
  /** The task card in that conversation, patched as the task moves. */
  cardMessageId?: string;
  at: number;
  /** Who asked (organization server): the person whose limit it counts in. */
  principalId?: string;
  /** Set once the result was posted back. */
  reportedAt?: number;
  /** How it ended, once reported. */
  outcome?: ParallelTaskState;
  /** Opened by the bot itself (start_thread with report_back), not a person. */
  byBot?: boolean;
}

/** Default number of parallel tasks one person may have running on one bot. */
export const DEFAULT_MAX_PARALLEL_PER_PERSON = 3;
export const MAX_PARALLEL_PER_PERSON = 10;

/** Words that read as a change to the running work, not a new request. */
const STEER_HINTS = [
  // fr
  "arrête", "arrete", "stop", "plutôt", "plutot", "attends", "non,", "non ", "aussi", "en fait", "oublie", "change", "corrige", "continue", "au lieu",
  // en
  "instead", "wait", "also", "actually", "don't", "dont", "cancel", "rather", "keep going", "use ", "no,",
];

/** The choice offered first when the person picks per message: a short
 * correction reads as a steer; anything else as unrelated work, which runs
 * in parallel. The person always sees and can change the choice. */
export function suggestBusySendMode(text: string): BusySendMode {
  const words = text.trim().toLowerCase();
  if (!words) return "steer";
  const short = words.length <= 60;
  if (short && STEER_HINTS.some((hint) => words.startsWith(hint) || words.includes(` ${hint}`))) return "steer";
  return "parallel";
}

/** A task card's state from the task's live record. */
export function liveParallelState(
  recorded: ParallelTaskState | undefined,
  task: { busy?: boolean; activity?: string } | undefined,
  queued: boolean,
): ParallelTaskState | "waiting" {
  if (recorded === "done" || recorded === "failed" || recorded === "stopped") return recorded;
  if (task?.activity === "waiting-on-you") return "waiting";
  if (task?.busy) return "running";
  if (queued) return "queued";
  return recorded ?? "queued";
}
