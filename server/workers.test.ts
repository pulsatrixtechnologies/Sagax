import { describe, expect, it } from "vitest";
import { requiredScope } from "./request-auth.ts";
import { turnDestination } from "./turn-route.ts";
import { channelTurnGate, queueTurn, registerWorker, registerWorkerBody } from "./workers.ts";

describe("workers", () => {
  it("does not start a turn for an offline machine", () => {
    const destination = turnDestination({
      host: { kind: "machine", userId: "zachary@example.test", deviceId: "laptop" },
      workerOnline: false,
    });
    expect(queueTurn({ destination, messageId: "m1", queued: [] })).toEqual({ queued: ["m1"], started: false });
  });

  it("starts a fleet or online worker turn without changing the queue", () => {
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
    })).toEqual({ queued: ["m1"], startedIds: [], status: "machine-offline" });
  });

  it("starts a fleet bot when no worker is online", () => {
    const queued = ["kept"];
    expect(channelTurnGate({
      bots: [{ id: "aurora", host: { kind: "fleet" } }],
      workers: [],
      messageId: "m9",
      queued,
    })).toEqual({ queued, startedIds: ["aurora"], status: null });
  });

  it("starts the registered machine and leaves the queue", () => {
    const queued = ["older"];
    expect(channelTurnGate({
      bots: [{ id: "desk", host: { kind: "machine", userId: "zachary@example.test", deviceId: "laptop" } }],
      workers: [{ deviceId: "laptop", userId: "zachary@example.test", online: true }],
      messageId: "m1",
      queued,
    })).toEqual({ queued, startedIds: ["desk"], status: null });
  });

  it("queues once when one bot is offline and still starts the others", () => {
    const gate = channelTurnGate({
      bots: [
        { id: "fleet-bot", host: { kind: "fleet" } },
        { id: "desk", host: { kind: "machine", userId: "zachary@example.test", deviceId: "laptop" } },
        { id: "other", host: { kind: "machine", userId: "ada@example.test", deviceId: "studio" } },
      ],
      workers: [{ deviceId: "laptop", userId: "jc@example.test", online: true }],
      messageId: "m1",
      queued: [],
    });
    expect(gate.startedIds).toEqual(["fleet-bot"]);
    expect(gate.queued).toEqual(["m1"]);
    expect(gate.status).toBe("machine-offline");
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

  it("lets a session register a worker at client scope", () => {
    expect(requiredScope("POST", "/api/workers")).toBe("client");
  });
});
