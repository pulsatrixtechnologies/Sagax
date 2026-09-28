import { describe, expect, it } from "vitest";
import { requiredScope } from "./request-auth.ts";
import { turnDestination } from "./turn-route.ts";
import {
  bindWorkerSocket,
  cancelQueued,
  channelTurnGate,
  failTurn,
  failTurnOnMembershipRemoval,
  failTurnOnWorkerClose,
  invokeFleetRunner,
  pullQueuedForSession,
  queueTurn,
  registerWorker,
  registerWorkerBody,
  takeQueued,
} from "./workers.ts";

describe("workers", () => {
  it("does not start a turn for an offline machine", () => {
    const destination = turnDestination({
      host: { kind: "machine", userId: "zachary@example.test", deviceId: "laptop" },
      workerOnline: false,
    });
    expect(queueTurn({ destination, messageId: "m1", queued: [] })).toEqual({ queued: ["m1"], started: false });
  });

  it("leaves the queue unchanged for a fleet or online worker destination", () => {
    const queued = ["earlier"];
    const fleet = turnDestination({ host: { kind: "fleet" }, workerOnline: false });
    const worker = turnDestination({
      host: { kind: "machine", userId: "zachary@example.test", deviceId: "laptop" },
      workerOnline: true,
    });
    expect(queueTurn({ destination: fleet, messageId: "m2", queued })).toEqual({ queued, started: true });
    expect(queueTurn({ destination: worker, messageId: "m2", queued })).toEqual({ queued, started: true });
    expect(queueTurn({ destination: fleet, messageId: "m2", queued }).queued).toBe(queued);
    expect(queued).toEqual(["earlier"]);
    const calls: string[] = [];
    expect(invokeFleetRunner({ destination: worker, run: () => calls.push("worker") })).toBe(false);
    expect(invokeFleetRunner({ destination: { kind: "queued" }, run: () => calls.push("queued") })).toBe(false);
    expect(invokeFleetRunner({ destination: fleet, run: () => calls.push("fleet") })).toBe(true);
    expect(calls).toEqual(["fleet"]);
  });

  it("replaces the worker with the same deviceId", () => {
    const first = registerWorker([], { deviceId: "laptop", userId: "zachary@example.test", online: true });
    const replaced = registerWorker(first, { deviceId: "laptop", userId: "jc@example.test", online: false });
    expect(replaced).toEqual([{ deviceId: "laptop", userId: "jc@example.test", online: false }]);
    expect(first).toEqual([{ deviceId: "laptop", userId: "zachary@example.test", online: true }]);
    expect(registerWorker(replaced, { deviceId: "studio", userId: "jc@example.test", online: true })).toEqual([
      { deviceId: "laptop", userId: "jc@example.test", online: false },
      { deviceId: "studio", userId: "jc@example.test", online: true },
    ]);
  });

  it("keeps an offline machine queued and does not send it to the fleet", () => {
    expect(channelTurnGate({
      bots: [{ id: "desk", host: { kind: "machine", userId: "zachary@example.test", deviceId: "laptop" } }],
      workers: [{ deviceId: "laptop", userId: "zachary@example.test", online: false }],
      messageId: "m1",
      queued: [],
    })).toEqual({
      queued: [{ messageId: "m1", deviceId: "laptop", userId: "zachary@example.test", authorId: "", started: false }],
      fleetIds: [],
      status: "machine-offline",
    });
  });

  it("starts a fleet bot when no worker is online", () => {
    const queued = [{ messageId: "kept", deviceId: "studio", userId: "p", authorId: "p", started: false }];
    expect(channelTurnGate({
      bots: [{ id: "aurora", host: { kind: "fleet" } }],
      workers: [],
      messageId: "m9",
      queued,
    })).toEqual({ queued, fleetIds: ["aurora"], status: null });
  });

  it("lets an online worker pull its message once and does not call the fleet runner", () => {
    const queued = [{ messageId: "older", deviceId: "studio", userId: "studio-owner", authorId: "p", started: false }];
    const destination = turnDestination({
      host: { kind: "machine", userId: "zachary@example.test", deviceId: "laptop" },
      workerOnline: true,
    });
    expect(destination).toEqual({ kind: "worker", deviceId: "laptop" });
    const calls: string[] = [];
    expect(invokeFleetRunner({ destination, run: () => calls.push("fleet") })).toBe(false);
    expect(calls).toEqual([]);
    const gate = channelTurnGate({
      bots: [{ id: "desk", host: { kind: "machine", userId: "zachary@example.test", deviceId: "laptop" } }],
      workers: [{ deviceId: "laptop", userId: "zachary@example.test", online: true }],
      messageId: "m1",
      authorId: "p_zach",
      queued,
    });
    expect(gate.fleetIds).toEqual([]);
    expect(gate.status).toBeNull();
    const pulled = takeQueued("laptop", gate.queued, "zachary@example.test");
    expect(pulled.ids).toEqual(["m1"]);
    expect(takeQueued("laptop", pulled.queued, "zachary@example.test").ids).toEqual([]);
    expect(takeQueued("laptop", gate.queued, "ada@example.test").ids).toEqual([]);
    expect(takeQueued("studio", pulled.queued, "studio-owner").ids).toEqual(["older"]);
  });

  it("queues an offline machine until that device pulls it, and does not call the fleet runner", () => {
    const destination = turnDestination({
      host: { kind: "machine", userId: "zachary@example.test", deviceId: "laptop" },
      workerOnline: false,
    });
    expect(queueTurn({ destination, messageId: "m1", queued: [] })).toEqual({ queued: ["m1"], started: false });
    const calls: string[] = [];
    expect(invokeFleetRunner({ destination, run: () => calls.push("fleet") })).toBe(false);
    expect(calls).toEqual([]);
    const gate = channelTurnGate({
      bots: [{ id: "desk", host: { kind: "machine", userId: "zachary@example.test", deviceId: "laptop" } }],
      workers: [],
      messageId: "m1",
      authorId: "p_zach",
      queued: [],
    });
    expect(gate.fleetIds).toEqual([]);
    expect(gate.status).toBe("machine-offline");
    const pulled = takeQueued("laptop", gate.queued, "zachary@example.test");
    expect(pulled.ids).toEqual(["m1"]);
    expect(pulled.started).toEqual([{ messageId: "m1", deviceId: "laptop", userId: "zachary@example.test", authorId: "p_zach", started: true }]);
    expect(takeQueued("laptop", pulled.queued, "zachary@example.test").ids).toEqual([]);
    expect(takeQueued("studio", gate.queued, "zachary@example.test").ids).toEqual([]);
  });

  it("queues each offline device once and still runs a fleet bot", () => {
    const gate = channelTurnGate({
      bots: [
        { id: "fleet-bot", host: { kind: "fleet" } },
        { id: "desk", host: { kind: "machine", userId: "zachary@example.test", deviceId: "laptop" } },
        { id: "other", host: { kind: "machine", userId: "ada@example.test", deviceId: "studio" } },
      ],
      workers: [{ deviceId: "laptop", userId: "jc@example.test", online: true }],
      messageId: "m1",
      authorId: "p_zach",
      queued: [],
    });
    expect(gate.fleetIds).toEqual(["fleet-bot"]);
    expect(gate.queued).toEqual([
      { messageId: "m1", deviceId: "laptop", userId: "zachary@example.test", authorId: "p_zach", started: false },
      { messageId: "m1", deviceId: "studio", userId: "ada@example.test", authorId: "p_zach", started: false },
    ]);
    expect(gate.status).toBe("machine-offline");
  });

  it("lets only the owning session pull, and registering does not take the queue", () => {
    const queued = [{ messageId: "m1", deviceId: "laptop", userId: "zachary@example.test", authorId: "p_zach", started: false }];
    const registered = registerWorkerBody({ workers: [], userId: "zachary@example.test", body: { deviceId: "laptop" } });
    expect(registered.status).toBe(200);
    expect(queued).toEqual([{ messageId: "m1", deviceId: "laptop", userId: "zachary@example.test", authorId: "p_zach", started: false }]);
    if (registered.status !== 200) return;
    expect(pullQueuedForSession({
      deviceId: "laptop",
      userId: "ada@example.test",
      workers: registered.workers,
      queued,
    })).toEqual({ status: 403, error: "forbidden" });
    expect(pullQueuedForSession({
      deviceId: "laptop",
      userId: "zachary@example.test",
      workers: registered.workers,
      queued,
    })).toEqual({ status: 200, ids: ["m1"], queued: [] });
  });

  it("does not give a later registrant ids held for the previous owner", () => {
    const queued = [{ messageId: "m1", deviceId: "laptop", userId: "zachary@example.test", authorId: "p_zach", started: false }];
    const stolen = registerWorker([{ deviceId: "laptop", userId: "zachary@example.test", online: true }], {
      deviceId: "laptop",
      userId: "ada@example.test",
      online: true,
    });
    const ada = pullQueuedForSession({
      deviceId: "laptop",
      userId: "ada@example.test",
      workers: stolen,
      queued,
    });
    expect(ada).toEqual({ status: 200, ids: [], queued });
    expect(pullQueuedForSession({
      deviceId: "laptop",
      userId: "zachary@example.test",
      workers: stolen,
      queued,
    })).toEqual({ status: 403, error: "forbidden" });
    const restored = registerWorker(stolen, { deviceId: "laptop", userId: "zachary@example.test", online: true });
    const pulled = pullQueuedForSession({
      deviceId: "laptop",
      userId: "zachary@example.test",
      workers: restored,
      queued,
    });
    expect(pulled).toEqual({ status: 200, ids: ["m1"], queued: [] });
    if (pulled.status !== 200) return;
    expect(pullQueuedForSession({
      deviceId: "laptop",
      userId: "zachary@example.test",
      workers: restored,
      queued: pulled.queued,
    })).toEqual({ status: 200, ids: [], queued: [] });
  });

  it("drops a queued message only when its author cancels", () => {
    const queued = [{ messageId: "m1", deviceId: "laptop", userId: "zachary@example.test", authorId: "p_zach", started: false }];
    expect(cancelQueued("m1", "ada", queued)).toEqual(queued);
    expect(cancelQueued("m1", "", queued)).toEqual(queued);
    expect(cancelQueued("m1", "p_zach", queued)).toEqual([]);
  });

  it("keeps partial text and marks the turn failed when the worker drops", () => {
    expect(failTurn({ queued: ["m1"], messageId: "m1", partial: "début" })).toEqual({
      queued: [],
      status: "failed",
      partial: "début",
    });
  });

  it("marks the channel message failed when the worker socket closes mid-turn", () => {
    const partial = "début";
    const card = { tool: "Bash" };
    const earlier = { id: "earlier", text: "historique" };
    const open = { id: "m1", text: partial, card };
    const messages = [earlier, open];
    const result = failTurnOnWorkerClose({
      midTurn: true,
      queued: ["m0", "m1"],
      messageId: "m1",
      partial,
      messages,
    });
    expect(result).toEqual({
      queued: ["m0"],
      status: "failed",
      partial,
      messages: [earlier, { id: "m1", text: partial, card, status: "failed" }],
    });
    expect(result.messages[0]).toBe(earlier);
    expect(result.messages[1]?.card).toBe(card);
    expect(card).toEqual({ tool: "Bash" });
    expect(result.partial).toBe(partial);
    const queued = ["m1"];
    const waiting = failTurnOnWorkerClose({
      midTurn: false,
      queued,
      messageId: "m1",
      partial,
      messages,
    });
    expect(waiting).toEqual({ queued, status: null, partial, messages });
    expect(waiting.queued).toBe(queued);
    expect(waiting.messages).toBe(messages);
  });

  it("fails the same way when a human or a bot leaves during a turn, and keeps history", () => {
    const partial = "début";
    const earlier = { id: "earlier", text: "historique" };
    const open = { id: "m1", text: partial };
    const messages = [earlier, open];
    const shared = {
      queued: ["m1"],
      messageId: "m1",
      partial,
      messages,
    };
    const human = failTurnOnMembershipRemoval({
      beforeHumanIds: ["jc", "ada"],
      afterHumanIds: ["jc"],
      beforeMemberIds: ["bot"],
      afterMemberIds: ["bot"],
      inTurn: true,
      ...shared,
    });
    const bot = failTurnOnMembershipRemoval({
      beforeHumanIds: ["jc"],
      afterHumanIds: ["jc"],
      beforeMemberIds: ["bot", "other"],
      afterMemberIds: ["bot"],
      inTurn: true,
      ...shared,
    });
    expect(human.status).toBe("failed");
    expect(bot.status).toBe("failed");
    expect(human.partial).toBe(partial);
    expect(bot.partial).toBe(partial);
    expect(human.messages.map((message) => message.id)).toEqual(["earlier", "m1"]);
    expect(bot.messages.map((message) => message.id)).toEqual(["earlier", "m1"]);
    expect(human.messages[0]).toBe(earlier);
    expect(bot.messages[0]).toBe(earlier);
    expect(human.messages[1]?.status).toBe("failed");
    expect(human.messages[1]?.text).toBe(partial);
    const idle = failTurnOnMembershipRemoval({
      beforeHumanIds: ["jc", "ada"],
      afterHumanIds: ["jc"],
      beforeMemberIds: ["bot"],
      afterMemberIds: ["bot"],
      inTurn: false,
      ...shared,
    });
    expect(idle).toEqual({ queued: ["m1"], status: null, partial, messages });
    expect(idle.messages).toBe(messages);
    const added = failTurnOnMembershipRemoval({
      beforeHumanIds: ["jc"],
      afterHumanIds: ["jc", "ada"],
      beforeMemberIds: ["bot"],
      afterMemberIds: ["bot", "other"],
      inTurn: true,
      ...shared,
    });
    expect(added.status).toBeNull();
    expect(added.messages).toBe(messages);
  });

  it("treats a socket close during the turn as the drop, not the response finish", async () => {
    let close = () => {};
    let markFinished = () => {};
    const calls: string[] = [];
    bindWorkerSocket({
      socket: { once(_event, listener) { close = listener; } },
      onResponseFinished(mark) { markFinished = mark; },
      onClose() { calls.push("close"); },
    });
    markFinished();
    close();
    expect(calls).toEqual([]);
    let later = () => {};
    let markLater = () => {};
    bindWorkerSocket({
      socket: { once(_event, listener) { later = listener; } },
      onResponseFinished(mark) { markLater = mark; },
      onClose() { calls.push("close"); },
    });
    markLater();
    await new Promise((resolve) => setImmediate(resolve));
    later();
    expect(calls).toEqual(["close"]);
  });

  it("registers the session user for the posted deviceId and replaces that device", () => {
    expect(registerWorkerBody({
      workers: [{ deviceId: "laptop", userId: "old@example.test", online: false }],
      userId: "zachary@example.test",
      body: { deviceId: "laptop", userId: "jc@example.test" },
    })).toEqual({
      status: 200,
      worker: { deviceId: "laptop", userId: "zachary@example.test", online: true },
      workers: [{ deviceId: "laptop", userId: "zachary@example.test", online: true }],
    });
  });

  it("refuses a worker registration without a deviceId", () => {
    expect(registerWorkerBody({ workers: [], userId: "zachary@example.test", body: {} })).toEqual({
      status: 400,
      error: "deviceId is required",
    });
    expect(registerWorkerBody({ workers: [], userId: "zachary@example.test", body: { deviceId: "  " } }).status).toBe(400);
    expect(registerWorkerBody({ workers: [], userId: "zachary@example.test", body: null }).status).toBe(400);
  });

  it("lets a session register, pull, and cancel a worker queue at client scope", () => {
    expect(requiredScope("POST", "/api/workers")).toBe("client");
    expect(requiredScope("POST", "/api/workers/laptop/pull")).toBe("client");
    expect(requiredScope("POST", "/api/workers/queue/m1/cancel")).toBe("client");
  });
});
