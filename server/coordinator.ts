// The seam between the server and the coordinator that runs teammate work:
// the job runtime (server/runtime/, docs/runtime-contract.md), reached
// through RuntimeCoordinator. index.ts talks to this interface only; the
// room-handoff tree it replaced is gone, and its node shape survives here
// as the read model (HandoffView) the server's call sites were written
// against. The view goes once those sites read Assignment rows directly.
import { RuntimeCoordinator } from "./runtime-coordinator.ts";
import type { WorkOrigin } from "./peer-provenance.ts";
import type { EnvelopeNames, Level, Limits } from "./runtime/types.ts";

export type HandoffStatus = "source" | "queued" | "running" | "waiting" | "resume" | "completed" | "failed" | "cancelled";

/** A coordinated turn as the server reads it: who runs it where, what it
 * was asked, how far it got. Projected from an Assignment row. */
export interface HandoffView {
  id: string;
  rootId: string;
  parentId?: string;
  groupId?: string;
  threadId: string;
  botId: string;
  key: string;
  text: string;
  createdAt: number;
  requestBatchKey?: string;
  status: HandoffStatus;
  result: string;
  reported: boolean;
  executions: number;
  startedAt?: number;
  lastProgressAt?: number;
  approvalGranted: boolean;
  kind: "work" | "assignment";
  /** On a root: where the tree's work started (peer-provenance.ts); absent is outside. */
  origin?: WorkOrigin;
  /** Turns of this node a restart cut and ran again in place. */
  restarts: number;
  /** Its next turn, or the one running now, follows a restart (runtime types.ts). */
  restart?: "rerun" | "cut" | "teammates";
}

export type RoomAddress = Pick<HandoffView, "groupId" | "threadId" | "botId">;

/** The turn text the runtime composed (one envelope, one report), run by
 * the host as it is. `note` is the same without the brief, for a room
 * whose transcript already carries the words; `restartNote` is what a
 * restart did to this turn ("" when nothing), already at the front of `text`. */
export interface ComposedTurn {
  text: string;
  note: string;
  restartNote: string;
}

export interface LiveHandoffEdge {
  sourceBotId: string;
  targetBotId: string;
  state: "queued" | "running";
  threadId: string;
  groupId?: string;
}

/** What the server gives the coordinator. Every method may throw; the
 * runtime logs and reads a throw as "not now". */
export interface CoordinatorHost {
  /** Recheck addresses and route permission immediately before every dispatch. */
  validate(node: HandoffView, parent?: HandoffView): string | undefined;
  /** The assignee cannot take a turn now (slot-aware admission). */
  busy(node: HandoffView): boolean;
  /** Run one turn of the assignee with the composed text; resolves when the engine settles. */
  run(node: HandoffView, resumed: boolean, signal: AbortSignal, composed: ComposedTurn): Promise<{ ok: boolean; text: string }>;
  /** A settled child, to its requester; a root the runtime ended, alone. */
  report(child: HandoffView, parent?: HandoffView): void;
  changed(groupIds: ReadonlySet<string>, directThreadIds: ReadonlySet<string>): void;
  /** Display names for the envelope of a turn. */
  names(node: HandoffView, parent?: HandoffView): EnvelopeNames;
  /** A teammate ended its turn on a question for the person: show it where
   * the work was asked for (and again after a restart). */
  park(node: HandoffView, question: string): void;
  /** The permission level the target thread will actually run with, after
   * the host applied any delegated level, and its engine kind. Recorded on
   * the assignment so the envelope states the truth (invariant I6). */
  levelOf(target: RoomAddress): { level: Level; driverKind?: string };
  /** The conversation is a Chief of Staff's. */
  chiefOf(address: RoomAddress): boolean;
}

export interface Coordinator {
  node(id: string): HandoffView | undefined;
  has(id: string): boolean;
  all(): HandoffView[];
  children(id: string): HandoffView[];
  /** Throws an Error whose message is the typed refusal the caller shows the model. */
  enqueue(source: RoomAddress, generation: string, parentId: string | undefined, target: RoomAddress, key: string, text: string,
    approvalGranted?: boolean, rework?: boolean, sourceText?: string, requestBatchKey?: string, origin?: WorkOrigin): { node: HandoffView; duplicate: boolean };
  sharedRequest(node: HandoffView): { id: string; botIds: string[] };
  sourceSettled(generation: string, ok: boolean): void;
  cancelRoom(groupId: string, threadId?: string, reason?: string, status?: "failed" | "cancelled"): void;
  cancelDirect(threadId: string, reason?: string): void;
  activeDirect(threadId: string): boolean;
  assignerOf(threadId: string): HandoffView | undefined;
  outstandingDirect(threadId: string): HandoffView[];
  liveEdges(): LiveHandoffEdge[];
  stopAwaitingDirect(threadId: string, reason?: string): HandoffView[];
  continuesAfterRestart(threadId: string): boolean;
  /** The note a request arrived under (its envelope without the brief), for
   * a replay of that request line; undefined when the row is gone. */
  note(id: string): string | undefined;
  tick(): void;
  close(): void;
  /** The host saw activity on a coordinated turn in this thread (an engine event). */
  progress(threadId: string): void;
  /** The person wrote in a thread whose assignment is parked on a question:
   * true when the assignment took the text as its answer and the host must
   * not start an ordinary turn. */
  answer(threadId: string, text: string): boolean;
}

export interface CoordinatorOptions {
  dataDir: string;
  host: CoordinatorHost;
  now?: () => number;
  runtimeLimits?: Partial<Limits>;
  log?: (line: string) => void;
}

export function createCoordinator(options: CoordinatorOptions): Coordinator {
  return new RuntimeCoordinator(options);
}
