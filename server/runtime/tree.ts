// Tree reads the runtime makes over stored rows and their events. Nothing
// here writes. Event ids are one global, monotonic order, which is why
// "what happened since this turn began" is read from them and never from
// timestamps: a frozen test clock or a wall clock stepping back could put
// a child of the previous turn inside the current one, and the node would
// wait on work it already returned.
import type { RuntimeStore } from "./store.ts";
import { terminal, type Assignment, type Owner } from "./types.ts";

/** A turn a restart cut runs again once; cut again, it ends with this. */
export const CUT_TWICE = "Interrupted by another Sagax restart after resuming once; not resumed again. Some of its steps may already have taken effect.";

/** Renders elapsed milliseconds as whole minutes, or seconds under one minute. */
export const duration = (ms: number): string => ms >= 60_000 ? `${Math.floor(ms / 60_000)}m` : `${Math.floor(ms / 1000)}s`;

export const clip = (text: string, max: number): string => text.length > max ? text.slice(0, max) : text;

export const isTerminal = (a: Assignment): boolean => terminal(a.status);

/** The children a parent waits on: one-way notices come back with nothing,
 * so they neither hold the parent nor appear in its resume. */
export const awaited = (children: readonly Assignment[]): Assignment[] => children.filter(c => c.reply !== "none");

/** Root first, the node last. Throws on a cycle: the store never writes one,
 * so finding one means the file was edited by hand. */
export function path(store: RuntimeStore, n: Assignment): Assignment[] {
  const out: Assignment[] = [];
  const seen = new Set<string>();
  for (let cur: Assignment | undefined = n; cur; cur = cur.parentId ? store.get(cur.parentId) : undefined) {
    if (seen.has(cur.id)) throw new Error("Invalid assignment ancestry");
    seen.add(cur.id);
    out.unshift(cur);
  }
  return out;
}

/** The id of the event that began the node's latest turn that was not cut
 * by a restart (0 when none). A turn a restart cut and set to run again
 * never returned anything, so what "began since" it began is still owed:
 * its rerun anchors at the turn before it. */
export function lastStartedId(store: RuntimeStore, id: string): number {
  const events = store.events(id);
  let cut = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.kind === "restart_reconciled" && /: rerun /.test(event.detail ?? "")) cut += 1;
    else if (event.kind === "started") {
      if (cut > 0) { cut -= 1; continue; }
      return event.id;
    }
  }
  return 0;
}

/** Children handed out by the node's latest turn: enqueued after it began. */
export function childrenSince(store: RuntimeStore, n: Assignment): Assignment[] {
  const since = lastStartedId(store, n.id);
  return store.children(n.id).filter(c => (store.events(c.id)[0]?.id ?? 0) > since);
}

/** The lane a node's result is written to: its requester, as recorded (a
 * bot turn's thread, an external runtime's run id). */
export function wakeOwner(n: Assignment): Owner {
  const owner: Owner = {};
  if (n.requester.botId !== undefined) owner.botId = n.requester.botId;
  if (n.requester.threadId !== undefined) owner.threadId = n.requester.threadId;
  if (n.requester.runId !== undefined) owner.runId = n.requester.runId;
  return owner;
}

/** Whether this node is the conversation an owner names: a thread (with
 * its bot, when given) or, for an external runtime, the roots of its run. */
export function ownsConversation(n: Assignment, owner: Owner): boolean {
  if (owner.threadId !== undefined) {
    return n.assignee.destination.threadId === owner.threadId && (owner.botId === undefined || n.assignee.botId === owner.botId);
  }
  if (owner.runId !== undefined) return !n.parentId && n.requester.runId === owner.runId;
  return false;
}

/** What a restart did to this node's turn and to the work it waits on, for
 * the first line of the turn after it ("" when nothing): a cut turn runs
 * again in its own conversation, so it checks before it repeats, and a
 * requester learns which of its teammates ran again. */
export function restartNote(n: Assignment, children: readonly Assignment[], nameOf: (child: Assignment) => string): string {
  if (!n.restart) return "";
  const own = n.restart === "rerun"
    ? "Sagax restarted while your previous turn here was running and cut it off; this turn continues it. First check what that turn already did (files, commits, messages, anything sent or started) and verify anything uncertain, so nothing is done twice; then finish and report as usual. A restart alone is not a blocker."
    : n.restart === "cut" ? "Sagax restarted before your previous turn here finished, after it sent work to teammates. Check what that turn already did before repeating any of it." : "";
  // Only a rerun that completed is known to have finished; any other end
  // (never started, start refused, stopped or expired mid-run) may leave
  // part of it done, and its result says how it ended.
  const cut = children.filter(child => child.restarts > 0).map(child => `${nameOf(child)} (${
    child.outcome === "interrupted" ? "cut again while resuming, so not resumed a second time: it may be partly done"
      : child.status === "completed" ? "resumed once in place and told to check what it had already done"
      : `set to resume once but ended ${child.status} before finishing, so it may be partly done: see its result`})`);
  const teammates = cut.length ? `A restart cut these teammates' turns: ${cut.join("; ")}. Check their results as usual.` : "";
  return own || teammates ? `${[own, teammates].filter(Boolean).join(" ")}\n` : "";
}
