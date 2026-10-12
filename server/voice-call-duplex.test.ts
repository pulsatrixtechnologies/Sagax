import { describe, expect, it } from "vitest";

import {
  admitDuplexSend,
  dropCancelledVoiceEvent,
  DUPLEX_INTERRUPT_WAIT_MS,
  duplexEpoch,
  isStaleAssistantOutput,
  isThreadBusyError,
  pinVoiceInterrupt,
  waitForThreadIdle,
} from "./voice-call-duplex.ts";
import {
  discardSteeredQueue,
  hasQueuedSteeredMessages,
  queueSteeredMessage,
} from "./steer-queue.ts";

describe("admitDuplexSend", () => {
  it("never replaces when the flag is off", () => {
    expect(admitDuplexSend({ duplex: false, botBusy: true, stopping: true, queued: true })).toEqual({ action: "steer" });
    expect(admitDuplexSend({ duplex: false, botBusy: false, stopping: false, queued: false })).toEqual({ action: "start" });
  });

  it("starts when duplex is on and the thread is idle", () => {
    expect(admitDuplexSend({ duplex: true, botBusy: false, stopping: false, queued: false })).toEqual({ action: "start" });
  });

  it("replaces a busy or stopping turn and discards the queue", () => {
    expect(admitDuplexSend({ duplex: true, botBusy: true, stopping: false, queued: false }))
      .toEqual({ action: "replace", interrupt: true, discardQueue: true });
    expect(admitDuplexSend({ duplex: true, botBusy: false, stopping: true, queued: false }))
      .toEqual({ action: "replace", interrupt: true, discardQueue: true });
    expect(admitDuplexSend({ duplex: true, botBusy: true, stopping: true, queued: true }))
      .toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("discards a leftover queue on an idle thread without interrupting", () => {
    expect(admitDuplexSend({ duplex: true, botBusy: false, stopping: false, queued: true }))
      .toEqual({ action: "replace", interrupt: false, discardQueue: true });
  });

  it("a new topic while background work runs is parked as background, not replaced", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: true, newTopic: true,
    })).toEqual({ action: "background" });
  });

  it("a new topic while the call thread is only thinking forks, it does not replace", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: false, newTopic: true,
    })).toEqual({ action: "background" });
  });

  it("an explicit stop or correction still replaces a thinking turn", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: false, newTopic: false,
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("stop cancels the thinking turn and does not start a new one", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, intent: "stop",
    })).toEqual({ action: "stop", interrupt: true, discardQueue: true });
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: true, intent: "stop",
    })).toEqual({ action: "stop", interrupt: true, discardQueue: true });
  });

  it("a correction still replaces a thinking turn", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, intent: "correction",
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("stop or a correction still replaces, even with background work", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: true, newTopic: false,
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("a continues reissue replaces the speculative turn, it does not fork", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, newTopic: true, continues: true,
    })).toEqual({ action: "replace", interrupt: true, discardQueue: true });
  });

  it("a speculative send while background work runs is admitted, not deferred", () => {
    expect(admitDuplexSend({
      duplex: true, botBusy: true, stopping: false, queued: false, backgroundWork: true, newTopic: true, speculative: true,
    })).toEqual({ action: "background" });
    expect(admitDuplexSend({
      duplex: true, botBusy: false, stopping: false, queued: false, backgroundWork: true, newTopic: true, speculative: true,
    })).toEqual({ action: "start" });
  });
});

describe("pinVoiceInterrupt", () => {
  it("applies an unpinned Stop, and a pin that still owns the thread", () => {
    expect(pinVoiceInterrupt({})).toBe("apply");
    expect(pinVoiceInterrupt({ expectedUtteranceId: "utt-a" })).toBe("apply");
    expect(pinVoiceInterrupt({ expectedUtteranceId: "utt-a", liveUtteranceId: "utt-a" })).toBe("apply");
  });

  it("skips when a newer utterance already owns the thread", () => {
    expect(pinVoiceInterrupt({ expectedUtteranceId: "utt-a", liveUtteranceId: "utt-b" })).toBe("skip");
  });
});

describe("duplex replace slot", () => {
  it("only the latest claim is current, so a slower replace does not start", () => {
    const epoch = duplexEpoch();
    const first = epoch.claim();
    const second = epoch.claim();
    expect(epoch.isLatest(first)).toBe(false);
    expect(epoch.isLatest(second)).toBe(true);
  });

  it("a cancelled turn's assistant output is stale even after a new owner starts", () => {
    expect(isStaleAssistantOutput({ eventTurnId: "turn-a", cancelledTurnIds: ["turn-a"], ownerTurnId: "turn-b" })).toBe(true);
    expect(isStaleAssistantOutput({ eventTurnId: "turn-b", cancelledTurnIds: ["turn-a"], ownerTurnId: "turn-b" })).toBe(false);
    expect(isStaleAssistantOutput({ ownerStopped: true, eventTurnId: "turn-a" })).toBe(true);
    expect(isStaleAssistantOutput({ eventTurnId: "turn-a", ownerTurnId: "turn-b" })).toBe(true);
  });

  it("a cancelled turn drops the LLM stream, completed text, and in-flight tool events", () => {
    expect(dropCancelledVoiceEvent(true, { type: "content.delta", streamKind: "assistant_text" })).toBe(true);
    expect(dropCancelledVoiceEvent(true, { type: "item.completed", itemType: "assistant_text" })).toBe(true);
    expect(dropCancelledVoiceEvent(true, { type: "item.started", itemType: "tool" })).toBe(true);
    expect(dropCancelledVoiceEvent(true, { type: "item.completed", itemType: "tool" })).toBe(true);
    expect(dropCancelledVoiceEvent(true, { type: "turn.completed" })).toBe(false);
    expect(dropCancelledVoiceEvent(false, { type: "item.completed", itemType: "assistant_text" })).toBe(false);
    expect(dropCancelledVoiceEvent(false, { type: "item.completed", itemType: "tool" })).toBe(false);
  });

  it("thread_busy is retried until idle, then a timeout is reported", async () => {
    expect(isThreadBusyError(Object.assign(new Error("busy"), { code: "thread_busy" }))).toBe(true);
    expect(isThreadBusyError(new Error("nope"))).toBe(false);
    let busy = true;
    let now = 0;
    const sleeps: number[] = [];
    const idle = waitForThreadIdle(() => busy, {
      capMs: 100,
      stepMs: 40,
      now: () => now,
      sleep: async (ms) => {
        sleeps.push(ms);
        now += ms;
        busy = false;
      },
    });
    await expect(idle).resolves.toBe("idle");
    expect(sleeps).toEqual([40]);
    const timed = waitForThreadIdle(() => true, {
      capMs: 80,
      stepMs: 40,
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    await expect(timed).resolves.toBe("timeout");
  });

  it("default waitForThreadIdle times out at 300 ms after abort, not 2500", async () => {
    expect(DUPLEX_INTERRUPT_WAIT_MS).toBe(300);
    let now = 0;
    const timed = waitForThreadIdle(() => true, {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
    });
    await expect(timed).resolves.toBe("timeout");
    expect(now).toBeGreaterThanOrEqual(300);
    expect(now).toBeLessThan(400);
  });
});

describe("discardSteeredQueue", () => {
  it("empties a thread's queued follow-ups and leaves other threads", () => {
    queueSteeredMessage("bot-a", "thread-a", "stale A");
    queueSteeredMessage("bot-a", "thread-a", "stale B");
    queueSteeredMessage("bot-a", "thread-b", "keep me");
    expect(discardSteeredQueue("bot-a", "thread-a")).toBe(2);
    expect(hasQueuedSteeredMessages("bot-a", "thread-a")).toBe(false);
    expect(hasQueuedSteeredMessages("bot-a", "thread-b")).toBe(true);
    expect(discardSteeredQueue("bot-a", "thread-a")).toBe(0);
    expect(discardSteeredQueue("other", "thread-b")).toBe(0);
    expect(discardSteeredQueue("bot-a", "thread-b")).toBe(1);
  });
});
