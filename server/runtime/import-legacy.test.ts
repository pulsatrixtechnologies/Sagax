import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { importLegacyHandoffs } from "./import-legacy.ts";
import { openRuntimeStore } from "./store.ts";
import { Runtime } from "./runtime.ts";
import type { TurnRunner } from "./types.ts";

const T0 = 1_700_000_000_000;
const legacy = [
  { id: "gen-1", rootId: "gen-1", threadId: "chief-chat", botId: "chief", key: "root", text: "Ship it", createdAt: T0, status: "source",
    result: "", reported: true, executions: 0, approvalGranted: false, kind: "work", origin: { kind: "user", request: "Ship it" }, restarts: 0 },
  { id: "c-run", rootId: "gen-1", parentId: "gen-1", threadId: "builder-work", botId: "builder", key: "builder", text: "Build it", createdAt: T0 + 1,
    status: "running", result: "", reported: false, executions: 1, startedAt: T0 + 2, approvalGranted: true, kind: "work", restarts: 0 },
  { id: "c-done", rootId: "gen-1", parentId: "gen-1", threadId: "tester-work", botId: "tester", key: "tester", text: "Test it", createdAt: T0 + 3,
    status: "completed", result: "All green", reported: true, executions: 1, lastProgressAt: T0 + 9, approvalGranted: false, kind: "work", restarts: 0 },
  { id: "c-queued", rootId: "gen-1", parentId: "gen-1", groupId: "g1", threadId: "room-1", botId: "writer", key: "writer", text: "Write it", createdAt: T0 + 4,
    status: "queued", result: "", reported: false, executions: 0, approvalGranted: false, kind: "work", requestBatchKey: "b1", restarts: 0 },
];

const idleRunner: TurnRunner = {
  validate: () => undefined, canStart: () => false, run: async () => ({ kind: "completed", text: "" }),
  park: () => {}, report: () => {}, changed: () => {}, names: (a) => ({ requester: "Chief", assignee: a.assignee.botId }),
};

describe("importLegacyHandoffs", () => {
  it("brings a room-handoff tree over once, keeps ids and lineage, and renames the file", () => {
    const dir = mkdtempSync(join(tmpdir(), "legacy-import-"));
    const file = join(dir, "room-handoffs.json");
    writeFileSync(file, JSON.stringify(legacy));
    const store = openRuntimeStore(":memory:");
    expect(importLegacyHandoffs(store, file, T0 + 100)).toBe(4);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(`${file}.migrated`)).toBe(true);
    const root = store.get("gen-1")!;
    expect(root).toMatchObject({ status: "running", depth: 0, executions: 1, origin: { kind: "person", quote: "Ship it" },
      requester: { kind: "person", threadId: "chief-chat" }, assignee: { destination: { kind: "standing_thread", threadId: "chief-chat" } } });
    expect(store.get("c-run")).toMatchObject({ status: "running", depth: 1, parentId: "gen-1", approved: true, brief: "Build it",
      requester: { kind: "bot_turn", botId: "chief", threadId: "chief-chat" }, assignee: { destination: { kind: "work_thread" } } });
    expect(store.get("c-done")).toMatchObject({ status: "completed", outcome: "done", result: "All green" });
    expect(store.get("c-done")!.reportedAt).toBeDefined();
    expect(store.get("c-queued")).toMatchObject({ status: "queued", batchKey: "b1", assignee: { destination: { kind: "room_thread", groupId: "g1" } } });
    expect(store.events("c-run").map((e) => e.kind)).toEqual(["enqueued", "started"]);
    // A second import is a no-op: nothing to read, nothing rewritten.
    expect(importLegacyHandoffs(store, file, T0 + 200)).toBe(0);
    // The restart policy then treats the cut turns as any other: the root
    // handed out work, so it waits; the running child reruns once.
    const runtime = new Runtime(store, idleRunner, { clock: { now: () => T0 + 300, monotonic: () => 0 } });
    runtime.open();
    expect(store.get("gen-1")).toMatchObject({ status: "waiting", restart: "cut" });
    expect(store.get("c-run")).toMatchObject({ status: "queued", restart: "rerun", restarts: 1 });
    store.close();
  });

  it("does nothing without a file", () => {
    const store = openRuntimeStore(":memory:");
    expect(importLegacyHandoffs(store, join(tmpdir(), "nope", "room-handoffs.json"), T0)).toBe(0);
    store.close();
  });
});
