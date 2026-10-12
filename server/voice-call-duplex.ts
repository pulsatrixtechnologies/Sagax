// Pure admit for a voice-call send when full-duplex is on (issue #292).
// Flag off: the caller keeps today's steer-or-queue path. Flag on: a new
// utterance replaces the in-flight turn and never enters the steer queue.

export type DuplexAdmit =
  | { action: "start" }
  | { action: "steer" }
  | { action: "queue" }
  | { action: "replace"; interrupt: boolean; discardQueue: boolean }
  | { action: "background" }
  | { action: "defer" }
  | { action: "stop"; interrupt: boolean; discardQueue: true };

export function admitDuplexSend(input: {
  duplex: boolean;
  botBusy: boolean;
  stopping: boolean;
  queued: boolean;
  backgroundWork?: boolean;
  newTopic?: boolean;
  speculative?: boolean;
  intent?: "stop" | "correction" | "new_topic";
  continues?: boolean;
}): DuplexAdmit {
  if (!input.duplex) {
    return input.botBusy || input.stopping || input.queued ? { action: "steer" } : { action: "start" };
  }
  // "stop" cancels the in-flight turn and does not start a new LLM turn.
  // A correction still replaces. A new topic forks even while thinking.
  if (input.intent === "stop" && (input.botBusy || input.stopping)) {
    return { action: "stop", interrupt: true, discardQueue: true };
  }
  // STT reissue of the same utterance (continues) is a correction of the
  // words, not a sibling topic.
  if (input.continues && (input.botBusy || input.stopping || input.queued)) {
    return { action: "replace", interrupt: input.botBusy || input.stopping, discardQueue: true };
  }
  if (input.newTopic && input.botBusy && !input.stopping) {
    return { action: "background" };
  }
  if (input.botBusy || input.stopping || input.queued) {
    return { action: "replace", interrupt: input.botBusy || input.stopping, discardQueue: true };
  }
  return { action: "start" };
}

/** How long a duplex send waits for the interrupted turn to settle before
 * starting the new one. Idle wait and thread_busy retry share this budget
 * after the abort is acknowledged. */
export const DUPLEX_INTERRUPT_WAIT_MS = 300;

/** One increasing token per thread: only the latest duplex replace starts. */
export function duplexEpoch(): { claim: () => number; isLatest: (token: number) => boolean } {
  let seq = 0;
  return {
    claim() {
      seq += 1;
      return seq;
    },
    isLatest(token: number) {
      return token === seq;
    },
  };
}

export function isThreadBusyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "thread_busy";
}

/** POST /interrupt pinned to the cancelled spoken utterance. An unpinned
 * Stop still applies. A pin for a turn that no longer owns the thread is
 * skipped so a newer send is not killed. */
export function pinVoiceInterrupt(input: {
  expectedUtteranceId?: string;
  liveUtteranceId?: string | null;
}): "apply" | "skip" {
  if (!input.expectedUtteranceId || !input.liveUtteranceId) return "apply";
  return input.expectedUtteranceId === input.liveUtteranceId ? "apply" : "skip";
}

/** A cancelled voice turn must not land LLM tokens, the completed answer,
 * or in-flight tool start/result. turn.completed still settles busy. */
export function dropCancelledVoiceEvent(
  stale: boolean,
  event: { type: string; streamKind?: string; itemType?: string },
): boolean {
  if (!stale) return false;
  if (event.type === "content.delta" && event.streamKind === "assistant_text") return true;
  if (event.type === "item.completed" && (event.itemType === "assistant_text" || event.itemType === "tool")) return true;
  if (event.type === "item.started" && event.itemType === "tool") return true;
  return false;
}

export function isStaleAssistantOutput(input: {
  eventTurnId?: string;
  cancelledTurnIds?: Iterable<string>;
  ownerStopped?: boolean;
  ownerTurnId?: string | null;
}): boolean {
  if (input.eventTurnId && input.cancelledTurnIds) {
    for (const id of input.cancelledTurnIds) {
      if (id === input.eventTurnId) return true;
    }
  }
  if (input.ownerStopped && (!input.eventTurnId || !input.ownerTurnId || input.eventTurnId !== input.ownerTurnId)) {
    return true;
  }
  if (input.eventTurnId && input.ownerTurnId && input.eventTurnId !== input.ownerTurnId) return true;
  return false;
}

export async function waitForThreadIdle(
  isBusy: () => boolean,
  opts?: {
    capMs?: number;
    stepMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<"idle" | "timeout"> {
  const capMs = opts?.capMs ?? DUPLEX_INTERRUPT_WAIT_MS;
  const stepMs = opts?.stepMs ?? 40;
  const now = opts?.now ?? Date.now;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + capMs;
  while (isBusy() && now() < deadline) await sleep(stepMs);
  return isBusy() ? "timeout" : "idle";
}
