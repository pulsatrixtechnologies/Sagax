import { describe, expect, it } from "vitest";
import { requiredScope } from "./request-auth.ts";
import { turnDestination } from "./turn-route.ts";
import {
  cancelQueued,
  channelTurnGate,
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
      queued: [{ messageId: "m1", deviceId: "laptop", authorId: "", started: false }],
      fleetIds: [],
      status: "machine-offline",
    });
  });

  it("starts a fleet bot when no worker is online", () => {
    const queued = [{ messageId: "kept", deviceId: "studio", authorId: "p", started: false }];
    expect(channelTurnGate({
      bots: [{ id: "aurora", host: { kind: "fleet" } }],
      workers: [],
      messageId: "m9",
      queued,
    })).toEqual({ queued, fleetIds: ["aurora"], status: null });
  });

  it("lets an online worker pull its message once and does not call the fleet runner", () => {
    const queued = [{ messageId: "older", deviceId: "studio", authorId: "p", started: false }];
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
    const pulled = takeQueued("laptop", gate.queued);
    expect(pulled.ids).toEqual(["m1"]);
    expect(takeQueued("laptop", pulled.queued).ids).toEqual([]);
    expect(takeQueued("studio", pulled.queued).ids).toEqual(["older"]);
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
    const pulled = takeQueued("laptop", gate.queued);
    expect(pulled.ids).toEqual(["m1"]);
    expect(pulled.started).toEqual([{ messageId: "m1", deviceId: "laptop", authorId: "p_zach", started: true }]);
    expect(takeQueued("laptop", pulled.queued).ids).toEqual([]);
    expect(takeQueued("studio", gate.queued).ids).toEqual([]);
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
      { messageId: "m1", deviceId: "laptop", authorId: "p_zach", started: false },
      { messageId: "m1", deviceId: "studio", authorId: "p_zach", started: false },
    ]);
    expect(gate.status).toBe("machine-offline");
  });

  it("lets only the owning session pull, and registering does not take the queue", () => {
    const queued = [{ messageId: "m1", deviceId: "laptop", authorId: "p_zach", started: false }];
    const registered = registerWorkerBody({ workers: [], userId: "zachary@example.test", body: { deviceId: "laptop" } });
    expect(registered.status).toBe(200);
    expect(queued).toEqual([{ messageId: "m1", deviceId: "laptop", authorId: "p_zach", started: false }]);
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

  it("drops a queued message only when its author cancels", () => {
    const queued = [{ messageId: "m1", deviceId: "laptop", authorId: "p_zach", started: false }];
    expect(cancelQueued("m1", "ada", queued)).toEqual(queued);
    expect(cancelQueued("m1", "", queued)).toEqual(queued);
    expect(cancelQueued("m1", "p_zach", queued)).toEqual([]);
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
