// The runtime store: rows, events, the inbox lane, pruning and nested
// transactions over node:sqlite, in memory and on disk.
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { openRuntimeStore, type RuntimeStore } from "./store.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import type { Assignment } from "./types.ts";

function assignment(id: string, patch: Partial<Assignment> = {}): Assignment {
  return {
    id, rootId: id, depth: 0,
    origin: { kind: "person", source: "chat", quote: "Ship it" },
    requester: { kind: "person", threadId: "chief-chat" },
    assignee: { botId: "chief", destination: { kind: "standing_thread", threadId: "chief-chat" } },
    mode: "work", reply: "resume", brief: "Ship it", status: "queued", level: "ask", levelSource: "own",
    executions: 0, restarts: 0, createdAt: 1_000, lastActivityAt: 1_000, result: "", rework: false, version: 1,
    ...patch,
  };
}

const child = (id: string, parent: Assignment, patch: Partial<Assignment> = {}) =>
  assignment(id, { rootId: parent.rootId, parentId: parent.id, depth: parent.depth + 1,
    requester: { kind: "bot_turn", botId: parent.assignee.botId, threadId: parent.assignee.destination.threadId },
    assignee: { botId: "builder", destination: { kind: "work_thread", threadId: `${id}-thread` } }, ...patch });

const stores: RuntimeStore[] = [];
const open = (path = ":memory:") => { const s = openRuntimeStore(path); stores.push(s); return s; };
afterEach(() => { for (const s of stores.splice(0)) s.close(); });

describe("runtime store", () => {
  it("round-trips a row with its event, and reads children in createdAt order", () => {
    const store = open();
    const root = assignment("root", { status: "running", startedAt: 1_000, budgets: { since: 1_000, requests: 0, executions: 1, wakes: 0 } });
    store.insert(root, { kind: "enqueued", at: 1_000, detail: "queued" });
    expect(store.get("root")).toEqual(root);
    const late = child("late", root, { createdAt: 3_000 });
    const early = child("early", root, { createdAt: 2_000 });
    store.insert(late, { kind: "enqueued", at: 3_000 });
    store.insert(early, { kind: "enqueued", at: 2_000 });
    expect(store.children("root").map(c => c.id)).toEqual(["early", "late"]);
    expect(store.root("late")?.id).toBe("root");
    expect(store.root("missing")).toBeUndefined();
    // update rewrites the whole row and (optionally) appends an event
    early.status = "running"; early.startedAt = 2_500; early.executions = 1;
    store.update(early, { kind: "started", at: 2_500, detail: "running: turn 1" });
    expect(store.get("early")).toEqual(early);
    delete early.startedAt;
    store.update(early);
    expect(store.get("early")?.startedAt).toBeUndefined();
    expect(store.events("early").map(e => [e.kind, e.detail])).toEqual([["enqueued", undefined], ["started", "running: turn 1"]]);
    expect(store.events("early").every(e => e.assignmentId === "early" && e.at > 0)).toBe(true);
    expect(() => store.update(assignment("ghost"))).toThrow(/does not exist/);
  });

  it("filters all() by tree, liveness and requester thread", () => {
    const store = open();
    const a = assignment("a", { status: "completed", outcome: "done", finishedAt: 5_000 });
    const b = assignment("b", { requester: { kind: "person", threadId: "other-chat" }, createdAt: 2_000 });
    store.insert(a, { kind: "enqueued" });
    store.insert(b, { kind: "enqueued" });
    store.insert(child("a1", a, { status: "running" }), { kind: "enqueued" });
    expect(store.all().map(x => x.id)).toEqual(["a", "a1", "b"]);
    expect(store.all({ rootId: "a" }).map(x => x.id)).toEqual(["a", "a1"]);
    expect(store.all({ nonTerminal: true }).map(x => x.id)).toEqual(["a1", "b"]);
    expect(store.all({ ownerThreadId: "other-chat" }).map(x => x.id)).toEqual(["b"]);
    expect(store.all({ rootId: "a", nonTerminal: true }).map(x => x.id)).toEqual(["a1"]);
  });

  it("joins nested transactions and rolls an inner failure back to its savepoint", () => {
    const store = open();
    const root = assignment("root");
    store.transaction(() => {
      store.insert(root, { kind: "enqueued" });
      expect(() => store.transaction(() => {
        store.insert(child("c", root), { kind: "enqueued" });
        throw new Error("inner");
      })).toThrow("inner");
      // the inner savepoint is gone, the outer transaction goes on
      store.insert(child("d", root), { kind: "enqueued" });
    });
    expect(store.all().map(x => x.id)).toEqual(["root", "d"]);
    // an outer failure takes everything with it, including nested joins
    expect(() => store.transaction(() => {
      store.insert(child("e", root), { kind: "enqueued" });
      store.transaction(() => store.insert(child("f", root), { kind: "enqueued" }));
      throw new Error("outer");
    })).toThrow("outer");
    expect(store.all().map(x => x.id)).toEqual(["root", "d"]);
    expect(store.events("e")).toEqual([]);
    // a failed insert leaves neither the row nor its event behind
    expect(() => store.insert(root, { kind: "enqueued" })).toThrow();
    expect(store.events("root")).toHaveLength(1);
  });

  it("keeps the inbox per owner and marks delivery once", () => {
    const store = open();
    store.addInbox({ id: "i1", ownerBotId: "chief", ownerThreadId: "chief-chat", assignmentId: "a", kind: "settled", createdAt: 1 });
    store.addInbox({ id: "i2", ownerThreadId: "chief-chat", assignmentId: "b", kind: "needs_input", createdAt: 2 });
    store.addInbox({ id: "i3", ownerRunId: "run-9", assignmentId: "c", kind: "settled", createdAt: 3 });
    expect(store.inbox({ threadId: "chief-chat" }).map(i => i.id)).toEqual(["i1", "i2"]);
    expect(store.inbox({ botId: "chief", threadId: "chief-chat" }).map(i => i.id)).toEqual(["i1"]);
    expect(store.inbox({ runId: "run-9" })).toEqual([{ id: "i3", ownerRunId: "run-9", assignmentId: "c", kind: "settled", createdAt: 3 }]);
    expect(store.inbox({})).toEqual([]);
    store.markDelivered(["i1"], 10);
    store.markDelivered(["i1"], 20);
    expect(store.inbox({ threadId: "chief-chat" }).map(i => i.deliveredAt)).toEqual([10, undefined]);
    expect(store.inbox({ threadId: "chief-chat" }, true).map(i => i.id)).toEqual(["i2"]);
    store.markDelivered([], 30);
  });

  it("prunes only whole trees that settled before the cutoff", () => {
    const store = open();
    const old = assignment("old", { status: "completed", outcome: "done", finishedAt: 100 });
    const live = assignment("live", { status: "completed", outcome: "done", finishedAt: 100 });
    const recent = assignment("recent", { status: "failed", outcome: "expired", finishedAt: 900 });
    store.insert(old, { kind: "enqueued" });
    store.insert(child("old1", old, { status: "cancelled", outcome: "stopped", finishedAt: 90 }), { kind: "enqueued" });
    store.insert(live, { kind: "enqueued" });
    store.insert(child("live1", live, { status: "running" }), { kind: "enqueued" });
    store.insert(recent, { kind: "enqueued" });
    store.addInbox({ id: "i-old", ownerThreadId: "chief-chat", assignmentId: "old1", kind: "settled", createdAt: 95 });
    store.addInbox({ id: "i-live", ownerThreadId: "chief-chat", assignmentId: "live", kind: "settled", createdAt: 95 });
    expect(store.prune(500)).toBe(2);
    expect(store.all().map(x => x.id).sort()).toEqual(["live", "live1", "recent"]);
    expect(store.events("old")).toEqual([]);
    expect(store.inbox({ threadId: "chief-chat" }).map(i => i.id)).toEqual(["i-live"]);
    expect(store.prune(500)).toBe(0);
  });

  it("refuses a row that no longer matches the record schema", () => {
    const store = open();
    store.insert(assignment("ok"), { kind: "enqueued" });
    // a row written with a status this build does not know
    const broken = { ...assignment("bad"), status: "sleeping" } as unknown as Assignment;
    store.insert(broken, { kind: "enqueued" });
    expect(() => store.get("bad")).toThrow(/record schema/);
    expect(store.get("ok")?.id).toBe("ok");
  });

  it("creates the file owner-only in WAL mode and reopens the same data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "runtime-store-"));
    try {
      const path = join(dir, "nested", "runtime.db");
      const store = openRuntimeStore(path);
      expect(store.path).toBe(path);
      store.insert(assignment("root"), { kind: "enqueued" });
      store.close();
      if (process.platform !== "win32") {
        expect(statSync(path).mode & 0o777).toBe(0o600);
        expect(statSync(join(dir, "nested")).mode & 0o777).toBe(0o700);
      }
      const probe = new DatabaseSync(path);
      expect((probe.prepare("PRAGMA journal_mode").get() as { journal_mode: string }).journal_mode).toBe("wal");
      probe.close();
      const again = openRuntimeStore(path);
      expect(again.get("root")?.brief).toBe("Ship it");
      again.close();
    } finally {
      await removeTempDir(dir);
    }
  });
});

describe("runtime store: request marks", () => {
  it("round-trips approved and batchKey, and refuses the wrong types", () => {
    const store = open();
    const root = assignment("root", { status: "running" });
    store.insert(root, { kind: "enqueued", at: 1_000 });
    const marked = child("marked", root, { approved: true, batchKey: "batch-1" });
    store.insert(marked, { kind: "enqueued", at: 2_000 });
    expect(store.get("marked")).toEqual(marked);
    expect(store.get("marked")).toMatchObject({ approved: true, batchKey: "batch-1" });
    const plain = child("plain", root);
    store.insert(plain, { kind: "enqueued", at: 3_000 });
    expect("approved" in store.get("plain")!).toBe(false);
    expect("batchKey" in store.get("plain")!).toBe(false);
    store.insert(child("bad", root, { approved: "yes" as unknown as boolean }), { kind: "enqueued", at: 4_000 });
    expect(() => store.get("bad")).toThrow(/does not match the record schema/);
  });
});
