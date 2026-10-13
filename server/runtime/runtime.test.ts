// The runtime core over a scripted TurnRunner and a fake clock: dispatch,
// write-before-act, dedupe, typed refusals, budgets, the three clocks,
// restart reconciliation, cancel and stop, poll. checkInvariants runs after
// every scenario; the full scenario suite lives in scenarios.test.ts.
import { describe, expect, it } from "vitest";

import { checkInvariants } from "./invariants.ts";
import { Runtime, type BeginRequest } from "./runtime.ts";
import { openRuntimeStore, type RuntimeStore } from "./store.ts";
import { CUT_TWICE } from "./tree.ts";
import type { Assignment, Clock, EnqueueRequest, Limits, RunInput, RunResult, TurnRunner } from "./types.ts";

const flush = () => new Promise<void>(resolve => setImmediate(resolve));

interface FakeClock extends Clock { t: number; advance(ms: number): void }
const fakeClock = (start = 1_000_000): FakeClock => ({ t: start, now() { return this.t; }, monotonic() { return this.t; }, advance(ms) { this.t += ms; } });

type Script = (a: Assignment, input: RunInput) => RunResult | "hold" | undefined;

interface Fake extends TurnRunner {
  runs: Array<{ a: Assignment; input: RunInput; signal: AbortSignal }>;
  reports: Array<{ a: Assignment; parent?: Assignment }>;
  parks: Array<{ a: Assignment; question: string }>;
  changes: Assignment[][];
  held: Map<string, (result: RunResult) => void>;
  script: Script;
  canStartAnswer: true | false | string | (() => true | false | string);
  validateAnswer: string | undefined;
  reportThrows: number;
  release(id: string, result: RunResult): Promise<void>;
  live(): { running: Set<string>; parked: Set<string> };
}

function fakeRunner(script: Script = () => undefined): Fake {
  const fake: Fake = {
    runs: [], reports: [], parks: [], changes: [], held: new Map(), script, canStartAnswer: true, validateAnswer: undefined, reportThrows: 0,
    validate: () => fake.validateAnswer,
    canStart: () => typeof fake.canStartAnswer === "function" ? fake.canStartAnswer() : fake.canStartAnswer,
    run(a, input, signal) {
      fake.runs.push({ a, input, signal });
      const result = fake.script(a, input);
      if (result === "hold") return new Promise<RunResult>(resolve => fake.held.set(a.id, resolve));
      return Promise.resolve(result ?? { kind: "completed", text: `${a.assignee.botId} done` });
    },
    park: (a, question) => { fake.parks.push({ a, question }); },
    report(a, parent) {
      if (fake.reportThrows > 0) { fake.reportThrows -= 1; throw new Error("report failed"); }
      fake.reports.push({ a, ...(parent ? { parent } : {}) });
    },
    changed: rows => { fake.changes.push([...rows]); },
    names: a => ({ requester: a.requester.botId ?? "Milind", assignee: a.assignee.botId, person: "Milind" }),
    async release(id, result) {
      const resolve = fake.held.get(id);
      if (!resolve) throw new Error(`no held turn ${id}`);
      fake.held.delete(id);
      resolve(result);
      await flush();
    },
    live() {
      const running = new Set(fake.runs.filter(r => fake.held.has(r.a.id)).map(r => r.a.id));
      const parked = new Set(fake.parks.map(p => p.a.id));
      return { running, parked };
    },
  };
  return fake;
}

const chief = { botId: "chief", destination: { kind: "standing_thread" as const, threadId: "chief-chat" } };
const beginReq = (patch: Partial<BeginRequest> = {}): BeginRequest => ({
  origin: { kind: "person", source: "chat", quote: "Ship the CSV export" },
  requester: { kind: "person", threadId: "chief-chat", chief: true },
  assignee: chief, brief: "Ship the CSV export", level: "auto", ...patch,
});
const toBot = (botId: string, parentId: string, brief = `Build it, ${botId}`, patch: Partial<EnqueueRequest> = {}): EnqueueRequest => ({
  parentId, origin: { kind: "person", source: "chat" },
  requester: { kind: "bot_turn", botId: "chief", threadId: "chief-chat", chief: true },
  assignee: { botId, destination: { kind: "work_thread", threadId: `${botId}-work` } },
  brief, levels: { own: "ask", chief: "auto" }, driverKind: "claudeAgent", ...patch,
});

interface World { store: RuntimeStore; runner: Fake; clock: FakeClock; runtime: Runtime; logs: string[]; limits: Partial<Limits> }
function world(script?: Script, limits: Partial<Limits> = {}, store = openRuntimeStore(":memory:")): World {
  const runner = fakeRunner(script);
  const clock = fakeClock();
  const logs: string[] = [];
  const runtime = new Runtime(store, runner, { clock, limits, log: line => logs.push(line) });
  runtime.open();
  return { store, runner, clock, runtime, logs, limits };
}
const ok = (a: EnqueueResult): Assignment => { if (!a.ok) throw new Error(a.reason); return a.assignment; };
type EnqueueResult = ReturnType<Runtime["enqueue"]>;
const invariants = (w: World) => expect(checkInvariants(w.store, w.runner.live())).toEqual([]);

describe("Runtime: one tree, one lane", () => {
  it("runs a child, reports it once, then wakes the root with the settled children in one resume turn", async () => {
    const w = world();
    const root = w.runtime.begin(beginReq());
    expect(root.status).toBe("running");
    expect(root.executions).toBe(1);
    const child = ok(w.runtime.enqueue(toBot("builder", root.id)));
    expect(child).toMatchObject({ status: "queued", depth: 1, rootId: root.id, parentId: root.id, level: "auto", levelSource: "chief" });
    expect(w.runtime.liveEdges()).toEqual([{ sourceBotId: "chief", targetBotId: "builder", state: "queued", threadId: "builder-work" }]);
    w.runtime.tick();
    expect(w.runner.runs).toHaveLength(1);
    expect(w.runner.runs[0]!.input).toMatchObject({ resumed: false, restartNote: "", level: "auto", mode: "work" });
    expect(w.runner.runs[0]!.input.envelope).toContain(child.id);
    expect(w.store.get(child.id)?.status).toBe("running");
    await flush();
    expect(w.store.get(child.id)).toMatchObject({ status: "completed", outcome: "done", result: "builder done" });
    expect(w.runner.reports).toHaveLength(1);
    expect(w.runner.reports[0]).toMatchObject({ a: { id: child.id }, parent: { id: root.id } });
    const inbox = w.store.inbox({ botId: "chief", threadId: "chief-chat" });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ assignmentId: child.id, kind: "settled" });
    expect(inbox[0]?.deliveredAt).toBeUndefined();
    expect(w.runtime.outstanding({ threadId: "chief-chat" })).toEqual([]);
    // the requesting turn ends: it waits, the tick owes it a resume turn
    w.runtime.end(root.id, { ok: true, text: "Handed to builder" });
    expect(w.store.get(root.id)?.status).toBe("waiting");
    w.runtime.tick();
    expect(w.runner.runs).toHaveLength(2);
    const resume = w.runner.runs[1]!;
    expect(resume.a.id).toBe(root.id);
    expect(resume.input.resumed).toBe(true);
    expect(resume.input.settled?.map(s => s.id)).toEqual([child.id]);
    expect(w.store.inbox({ botId: "chief", threadId: "chief-chat" })[0]?.deliveredAt).toBe(w.clock.t);
    await flush();
    const done = w.store.get(root.id)!;
    expect(done).toMatchObject({ status: "completed", outcome: "done", result: "chief done", executions: 2 });
    // a root its own turn ended is not reported into itself, yet counts as reported; it writes no item of its own
    expect(w.runner.reports).toHaveLength(1);
    expect(done.reportedAt).toBeDefined();
    expect(w.store.inbox({ threadId: "chief-chat" }).map(i => i.assignmentId)).toEqual([child.id]);
    expect(w.store.events(root.id).map(e => e.kind)).toEqual(["enqueued", "started", "waiting", "resume_due", "admitted", "started", "settled", "reported"]);
    invariants(w);
  });

  it("writes running before it runs, and a failed write starts nothing", async () => {
    const inner = openRuntimeStore(":memory:");
    let failOnce = true;
    const flaky: RuntimeStore = { ...inner, update(a, event) {
      if (event?.kind === "started" && a.parentId && failOnce) { failOnce = false; throw new Error("disk full"); }
      inner.update(a, event);
    } };
    const w = world(undefined, {}, flaky);
    const root = w.runtime.begin(beginReq());
    const child = ok(w.runtime.enqueue(toBot("builder", root.id)));
    w.runtime.tick();
    expect(w.runner.runs).toHaveLength(0);
    expect(w.logs.some(l => /not written, nothing started/.test(l))).toBe(true);
    const row = inner.get(child.id)!;
    expect(row).toMatchObject({ status: "queued", executions: 0 });
    expect(inner.events(child.id).map(e => e.kind)).toEqual(["enqueued"]);
    expect(inner.get(root.id)?.budgets?.executions).toBe(1);
    w.runtime.tick();
    expect(w.runner.runs).toHaveLength(1);
    // the row said running (with its event) before run() saw it
    expect(w.runner.runs[0]!.a.status).toBe("running");
    expect(inner.events(child.id).map(e => e.kind)).toEqual(["enqueued", "admitted", "started"]);
    await flush();
    invariants(w);
  });

  it("dedupes the same brief under one parent and runs it again only with rework", async () => {
    const w = world();
    const root = w.runtime.begin(beginReq());
    const first = ok(w.runtime.enqueue(toBot("builder", root.id)));
    const again = w.runtime.enqueue(toBot("builder", root.id));
    expect(again).toMatchObject({ ok: true, duplicate: true, assignment: { id: first.id } });
    expect(w.store.get(root.id)?.budgets?.requests).toBe(1);
    w.runtime.tick(); await flush();
    expect(w.store.get(first.id)?.status).toBe("completed");
    expect(w.runtime.enqueue(toBot("builder", root.id))).toMatchObject({ ok: true, duplicate: true, assignment: { id: first.id } });
    const rework = ok(w.runtime.enqueue(toBot("builder", root.id, undefined, { rework: true })));
    expect(rework.id).not.toBe(first.id);
    expect(rework.rework).toBe(true);
    // a different place for the same words is different work
    const elsewhere = ok(w.runtime.enqueue(toBot("builder", root.id, undefined,
      { assignee: { botId: "builder", destination: { kind: "room_thread", threadId: "room-1", groupId: "g1" } } })));
    expect(elsewhere.id).not.toBe(rework.id);
    w.runtime.tick(); await flush();
    invariants(w);
  });

  it("refuses with typed reasons: a parent that is not running, an ancestor, depth, the request budget, the host", () => {
    const w = world(undefined, { depth: 2, requests: 3 });
    const root = w.runtime.begin(beginReq());
    expect(w.runtime.enqueue(toBot("builder", "nope"))).toMatchObject({ ok: false, outcome: "refused", reason: /no longer exists/ });
    expect(w.runtime.enqueue(toBot("chief", root.id))).toMatchObject({ ok: false, outcome: "refused", reason: /ancestor/ });
    const lead = ok(w.runtime.enqueue(toBot("lead", root.id)));
    expect(w.runtime.enqueue(toBot("builder", lead.id))).toMatchObject({ ok: false, outcome: "refused", reason: /not running/ });
    w.runtime.tick();
    expect(w.store.get(lead.id)?.status).toBe("running");
    const deep = ok(w.runtime.enqueue({ ...toBot("builder", lead.id), requester: { kind: "bot_turn", botId: "lead", threadId: "lead-work" } }));
    expect(deep.depth).toBe(2);
    expect(w.runtime.enqueue({ ...toBot("tester", deep.id), requester: { kind: "bot_turn", botId: "builder", threadId: "builder-work" } }))
      .toMatchObject({ ok: false, outcome: "refused", reason: /not running/ });
    w.runtime.tick();
    expect(w.runtime.enqueue({ ...toBot("tester", deep.id), requester: { kind: "bot_turn", botId: "builder", threadId: "builder-work" } }))
      .toMatchObject({ ok: false, outcome: "refused", reason: /depth/ });
    w.runner.validateAnswer = "No route to that bot";
    expect(w.runtime.enqueue(toBot("ops", root.id))).toMatchObject({ ok: false, outcome: "refused", reason: "No route to that bot" });
    w.runner.validateAnswer = undefined;
    expect(w.runtime.enqueue(toBot("reviewer", root.id)).ok).toBe(true);
    expect(w.runtime.enqueue(toBot("writer", root.id))).toMatchObject({ ok: false, outcome: "budget", reason: /Request budget/ });
    expect(w.store.events(root.id).some(e => e.kind === "budget")).toBe(true);
    expect(w.store.all()).toHaveLength(4);
  });

  it("renews the root's budgets on progress, and never refuses the owed resume turn", async () => {
    const w = world(undefined, { requests: 2, executions: 2 });
    const root = w.runtime.begin(beginReq());
    const a = ok(w.runtime.enqueue(toBot("a", root.id)));
    const b = ok(w.runtime.enqueue(toBot("b", root.id)));
    expect(w.runtime.enqueue(toBot("c", root.id))).toMatchObject({ ok: false, outcome: "budget" });
    w.runtime.tick();
    // executions: the root's own turn plus one child; the second child is over
    expect(w.store.get(a.id)?.status).toBe("running");
    expect(w.store.get(b.id)).toMatchObject({ status: "failed", outcome: "budget" });
    await flush();
    // a settlement renewed every window
    expect(w.store.get(root.id)?.budgets).toMatchObject({ requests: 0, executions: 0, wakes: 1 });
    expect(w.runtime.enqueue(toBot("c", root.id)).ok).toBe(true);
    w.runtime.end(root.id, { ok: true, text: "waiting" });
    w.runtime.tick(); await flush(); w.runtime.tick();
    expect(w.store.get(root.id)?.status).toBe("running");
    expect(w.runner.runs.at(-1)?.a.id).toBe(root.id);
    await flush();
    expect(w.store.get(root.id)?.status).toBe("completed");
    invariants(w);
  });

  it("expires a queue entry that never started and a question nobody answered, never as completed", async () => {
    const w = world(undefined, { queueMs: 1_000, inputWaitMs: 5_000 });
    const root = w.runtime.begin(beginReq());
    w.runner.canStartAnswer = "builder is busy on another thread";
    const stuck = ok(w.runtime.enqueue(toBot("builder", root.id)));
    w.runtime.tick(); w.runtime.tick();
    expect(w.store.events(stuck.id).filter(e => e.kind === "admitted")).toHaveLength(1);
    expect(w.store.events(stuck.id).at(-1)?.detail).toBe("waiting: builder is busy on another thread");
    w.clock.advance(1_001);
    w.runtime.tick();
    expect(w.store.get(stuck.id)).toMatchObject({ status: "failed", outcome: "expired", outcomeDetail: "never started" });
    expect(w.runner.reports.map(r => r.a.id)).toEqual([stuck.id]);
    w.runner.canStartAnswer = true;
    w.runner.script = () => ({ kind: "needs_input", question: "Which bucket?" });
    const asks = ok(w.runtime.enqueue(toBot("ops", root.id)));
    w.runtime.tick(); await flush();
    expect(w.store.get(asks.id)).toMatchObject({ status: "needs_input", question: "Which bucket?" });
    expect(w.runner.parks).toEqual([{ a: expect.objectContaining({ id: asks.id }), question: "Which bucket?" }]);
    expect(w.store.inbox({ threadId: "chief-chat" }).map(i => [i.assignmentId, i.kind])).toEqual([[stuck.id, "settled"], [asks.id, "needs_input"]]);
    // parked time is charged to no stall window, only to the input wait
    w.clock.advance(4_999);
    w.runtime.tick();
    expect(w.store.get(asks.id)?.status).toBe("needs_input");
    w.clock.advance(2);
    w.runtime.tick();
    expect(w.store.get(asks.id)).toMatchObject({ status: "failed", outcome: "expired", outcomeDetail: "the person did not answer" });
    expect(w.runner.reports.map(r => r.a.id)).toEqual([stuck.id, asks.id]);
    w.runtime.end(root.id, { ok: true, text: "" });
    w.runtime.tick(); await flush();
    invariants(w);
  });

  it("answers a parked question into the next turn and delivers what settled meanwhile", async () => {
    const w = world();
    let helperId = "";
    // the lead's turn hands out work, then asks the person
    w.runner.script = a => {
      if (a.assignee.botId !== "lead" || a.executions > 1) return undefined;
      helperId = ok(w.runtime.enqueue({ ...toBot("helper", a.id), requester: { kind: "bot_turn", botId: "lead", threadId: "lead-work" } })).id;
      return { kind: "needs_input", question: "Prod or staging?" };
    };
    const root = w.runtime.begin(beginReq());
    const lead = ok(w.runtime.enqueue(toBot("lead", root.id)));
    w.runtime.tick(); await flush();
    expect(w.store.get(lead.id)?.status).toBe("needs_input");
    expect(w.runtime.answer("nope", "x")).toBe(false);
    // the lead's own teammate finishes while the lead is parked
    w.runtime.tick(); await flush();
    expect(w.store.get(helperId)?.status).toBe("completed");
    expect(w.store.get(lead.id)?.status).toBe("needs_input");
    expect(w.runtime.answer(lead.id, "Staging")).toBe(true);
    expect(w.store.get(lead.id)).toMatchObject({ status: "queued", answer: "Staging" });
    expect(w.store.get(lead.id)?.question).toBeUndefined();
    w.runtime.tick();
    const turn = w.runner.runs.find(r => r.a.id === lead.id && r.input.answer === "Staging")!;
    expect(turn.input.envelope).toContain("Staging");
    expect(turn.input.settled?.map(s => s.id)).toEqual([helperId]);
    expect(w.store.inbox({ botId: "lead", threadId: "lead-work" }).map(i => i.deliveredAt !== undefined)).toEqual([true]);
    await flush();
    expect(w.store.get(lead.id)).toMatchObject({ status: "completed", executions: 2 });
    expect(w.store.get(lead.id)?.answer).toBeUndefined();
    invariants(w);
  });

  it("stalls a turn with no activity on the monotonic clock, and a tree with no progress, but never a parked tree", async () => {
    const w = world(() => "hold", { turnStallMs: 1_000, stallMs: 10_000 });
    const root = w.runtime.begin(beginReq());
    const a = ok(w.runtime.enqueue(toBot("a", root.id)));
    w.runtime.tick();
    const signal = w.runner.runs[0]!.signal;
    w.clock.advance(900);
    w.runtime.progress(a.id);
    w.clock.advance(900);
    w.runtime.tick();
    expect(w.store.get(a.id)?.status).toBe("running");
    w.clock.advance(200);
    w.runtime.tick();
    expect(w.store.get(a.id)).toMatchObject({ status: "failed", outcome: "stalled" });
    expect(signal.aborted).toBe(true);
    expect(w.store.inbox({ threadId: "chief-chat" }).map(i => i.kind)).toEqual(["stalled"]);
    // the late result of an aborted turn changes nothing
    await w.runner.release(a.id, { kind: "completed", text: "too late" });
    expect(w.store.get(a.id)?.result).not.toBe("too late");
    // a tree parked on the person never stalls; one with nothing happening does
    w.runner.script = () => ({ kind: "needs_input", question: "?" });
    const b = ok(w.runtime.enqueue(toBot("b", root.id)));
    w.runtime.tick(); await flush();
    w.runtime.end(root.id, { ok: true, text: "" });
    w.clock.advance(10_001);
    w.runtime.tick();
    expect(w.store.get(root.id)?.status).toBe("waiting");
    w.runtime.answer(b.id, "yes");
    w.runner.canStartAnswer = false;
    w.clock.advance(10_001);
    w.runtime.tick();
    expect(w.store.get(root.id)).toMatchObject({ status: "failed", outcome: "stalled" });
    expect(w.store.get(b.id)).toMatchObject({ status: "failed", outcome: "stalled" });
    expect(w.store.events(root.id).some(e => e.kind === "stalled")).toBe(true);
    // the root ended alone: reported into its own conversation
    expect(w.runner.reports.map(r => r.a.id)).toEqual([a.id, b.id, root.id]);
    invariants(w);
  });

  it("reconciles a restart from stored data: rerun once, cut after handing out work, re-park, fail a rerun cut again", async () => {
    const store = openRuntimeStore(":memory:");
    const first = world(() => "hold", {}, store);
    const root = first.runtime.begin(beginReq());
    const solo = ok(first.runtime.enqueue(toBot("solo", root.id)));
    const lead = ok(first.runtime.enqueue(toBot("lead", root.id)));
    const asker = ok(first.runtime.enqueue(toBot("asker", root.id)));
    first.runtime.tick();
    expect(first.runner.runs).toHaveLength(3);
    // the lead handed out work before the cut; the asker is parked
    const helper = ok(first.runtime.enqueue({ ...toBot("helper", lead.id), requester: { kind: "bot_turn", botId: "lead", threadId: "lead-work" } }));
    await first.runner.release(asker.id, { kind: "needs_input", question: "Region?" });
    first.runtime.close();
    first.runtime.tick();
    // a failure during teardown is left for the next boot to find cut
    await first.runner.release(lead.id, { kind: "failed", outcome: "provider_error", text: "killed" });
    expect(store.get(lead.id)?.status).toBe("running");

    const second = world(undefined, {}, store);
    expect(store.get(solo.id)).toMatchObject({ status: "queued", restart: "rerun", restarts: 1 });
    expect(store.get(lead.id)).toMatchObject({ status: "waiting", restart: "cut", restarts: 0 });
    expect(store.get(asker.id)?.status).toBe("needs_input");
    expect(second.runner.parks).toEqual([{ a: expect.objectContaining({ id: asker.id }), question: "Region?" }]);
    // the host's own root turn was cut too, after handing out work
    expect(store.get(root.id)).toMatchObject({ status: "waiting", restart: "cut", restarts: 0 });
    expect(store.get(helper.id)?.status).toBe("queued");
    expect(store.events(solo.id).at(-1)).toMatchObject({ kind: "restart_reconciled", detail: "queued: rerun 1" });
    expect(store.events(lead.id).at(-1)).toMatchObject({ kind: "restart_reconciled", detail: expect.stringMatching(/^waiting: cut/) });
    second.runtime.tick();
    const rerun = second.runner.runs.find(r => r.a.id === solo.id)!;
    expect(rerun.input.resumed).toBe(true);
    expect(rerun.input.restartNote).toMatch(/restarted while your previous turn/);
    await flush();
    expect(store.get(solo.id)?.status).toBe("completed");
    expect(store.get(solo.id)?.restart).toBeUndefined();
    second.runtime.tick(); await flush();
    expect(store.get(helper.id)?.status).toBe("completed");
    second.runtime.tick();
    const leadResume = second.runner.runs.find(r => r.a.id === lead.id)!;
    expect(leadResume.input.restartNote).toMatch(/restarted before your previous turn here finished/);
    expect(leadResume.input.settled?.map(s => s.id)).toEqual([helper.id]);
    await flush();
    second.runtime.answer(asker.id, "eu");
    second.runtime.tick(); await flush();
    second.runtime.tick();
    const rootResume = second.runner.runs.find(r => r.a.id === root.id)!;
    expect(rootResume.input.resumed).toBe(true);
    expect(rootResume.input.settled?.map(s => s.id)).toEqual([solo.id, lead.id, asker.id]);
    expect(rootResume.input.restartNote).toMatch(/restarted before your previous turn here finished.*A restart cut these teammates' turns: solo \(resumed once in place/);
    await flush();
    expect(store.get(root.id)?.status).toBe("completed");
    invariants(second);

    // a rerun cut a second time ends failed(interrupted) and is reported
    const third = world(() => "hold", {}, store);
    const root2 = third.runtime.begin(beginReq());
    const twice = ok(third.runtime.enqueue(toBot("twice", root2.id)));
    third.runtime.tick();
    third.runtime.close();
    const fourth = world(() => "hold", {}, store);
    expect(store.get(twice.id)).toMatchObject({ status: "queued", restarts: 1 });
    fourth.runtime.tick();
    fourth.runtime.close();
    const fifth = world(undefined, {}, store);
    expect(store.get(twice.id)).toMatchObject({ status: "failed", outcome: "interrupted", restarts: 1, result: CUT_TWICE });
    expect(fifth.runner.reports.map(r => r.a.id)).toEqual([twice.id]);
    // the host's root turn was cut after handing out work: its resume says so
    expect(store.get(root2.id)).toMatchObject({ status: "waiting", restart: "cut", restarts: 0 });
    fifth.runtime.tick();
    expect(fifth.runner.runs[0]!.input.restartNote).toMatch(/cut again while resuming/);
    await flush();
    expect(store.get(root2.id)?.status).toBe("completed");
    invariants(fifth);
    store.close();
  });

  it("cancels down the tree, aborts running turns and reports each stop", async () => {
    const w = world(() => "hold");
    const root = w.runtime.begin(beginReq());
    const lead = ok(w.runtime.enqueue(toBot("lead", root.id)));
    w.runtime.tick();
    const helper = ok(w.runtime.enqueue({ ...toBot("helper", lead.id), requester: { kind: "bot_turn", botId: "lead", threadId: "lead-work" } }));
    w.runtime.tick();
    const signals = w.runner.runs.map(r => r.signal);
    w.runtime.cancel(lead.id);
    expect(w.store.get(helper.id)).toMatchObject({ status: "cancelled", outcome: "stopped", outcomeDetail: "Stopped by user" });
    expect(w.store.get(lead.id)).toMatchObject({ status: "cancelled", outcome: "stopped" });
    expect(signals.every(s => s.aborted)).toBe(true);
    expect(w.runner.reports.map(r => r.a.id)).toEqual([helper.id, lead.id]);
    expect(w.runtime.liveEdges()).toEqual([]);
    // a harness stop is a failure with its own cause, never the person's Stop
    const other = ok(w.runtime.enqueue(toBot("other", root.id)));
    w.runtime.cancel(other.id, "Provider reloaded", "failed");
    expect(w.store.get(other.id)).toMatchObject({ status: "failed", outcome: "interrupted", outcomeDetail: "Provider reloaded" });
    w.runtime.cancel(root.id);
    expect(w.store.get(root.id)?.status).toBe("cancelled");
    expect(w.runner.reports.at(-1)?.a.id).toBe(root.id);
    invariants(w);
  });

  it("stops awaiting: queued work is dropped, a teammate mid-turn keeps its process and still reports", async () => {
    const w = world(() => "hold");
    const root = w.runtime.begin(beginReq());
    const running = ok(w.runtime.enqueue(toBot("running", root.id)));
    w.runtime.tick();
    w.runner.canStartAnswer = false;
    const queued = ok(w.runtime.enqueue(toBot("queued", root.id)));
    w.runtime.tick();
    const left = w.runtime.stopRequester({ threadId: "chief-chat" });
    expect(left.map(a => a.id)).toEqual([running.id]);
    expect(w.store.get(queued.id)).toMatchObject({ status: "cancelled", outcomeDetail: "Stopped before it started" });
    expect(w.store.get(root.id)).toMatchObject({ status: "cancelled", outcome: "stopped" });
    expect(w.runner.runs[0]!.signal.aborted).toBe(false);
    await w.runner.release(running.id, { kind: "completed", text: "finished anyway" });
    expect(w.store.get(running.id)).toMatchObject({ status: "completed", result: "finished anyway" });
    expect(w.runner.reports.map(r => r.a.id)).toEqual([queued.id, root.id, running.id]);
    w.runtime.tick();
    expect(w.store.get(root.id)?.status).toBe("cancelled");
    expect(w.runner.runs).toHaveLength(1);
    expect(w.runtime.stopRequester({ threadId: "chief-chat" })).toEqual([]);
    invariants(w);
  });

  it("completes a poll root without a turn and hands its children's lane to poll()", async () => {
    const w = world();
    const ext = { kind: "external_runtime" as const, runId: "run-1" };
    const root = w.runtime.begin(beginReq({ requester: ext, origin: { kind: "outside", source: "external_runtime" }, reply: "poll" }));
    const a = ok(w.runtime.enqueue(toBot("a", root.id, "Do A", { requester: ext, reply: "poll" })));
    const b = ok(w.runtime.enqueue(toBot("b", root.id, "Do B", { requester: ext, reply: "poll" })));
    // outside lineage: the origin is copied down and nothing is inherited
    expect([a.origin.kind, b.level, b.levelSource]).toEqual(["outside", "ask", "own"]);
    expect(w.runtime.outstanding({ runId: "run-1" }).map(x => x.id)).toEqual([root.id]);
    w.runtime.end(root.id, { ok: true, text: "started two" });
    w.runtime.tick(); await flush(); w.runtime.tick();
    expect(w.store.get(root.id)).toMatchObject({ status: "completed", outcome: "done" });
    expect(w.runner.runs.map(r => r.a.id).sort()).toEqual([a.id, b.id].sort());
    // the root ended without a turn of its own: reported, like one a restart ended
    expect(w.runner.reports.map(r => r.a.id)).toEqual([a.id, b.id, root.id]);
    expect(w.runtime.outstanding({ runId: "run-1" })).toEqual([]);
    const polled = w.runtime.poll({ runId: "run-1" });
    expect(polled.items.map(i => [i.assignmentId, i.kind])).toEqual([[a.id, "settled"], [b.id, "settled"]]);
    expect(polled.assignments.map(x => x.id)).toEqual([a.id, b.id]);
    expect(w.runtime.poll({ runId: "run-1" }).items).toEqual([]);
    expect(w.runtime.status(root.id)?.inbox.map(i => i.deliveredAt !== undefined)).toEqual([true, true]);
    invariants(w);
  });

  it("reads a host that throws as not now, and reports exactly once after a report that failed", async () => {
    const w = world();
    const root = w.runtime.begin(beginReq());
    const a = ok(w.runtime.enqueue(toBot("a", root.id)));
    w.runner.canStartAnswer = () => { throw new Error("slots unavailable"); };
    w.runtime.tick();
    expect(w.store.get(a.id)?.status).toBe("queued");
    expect(w.logs.some(l => /canStart threw/.test(l))).toBe(true);
    w.runner.canStartAnswer = true;
    w.runner.reportThrows = 1;
    w.runtime.tick(); await flush();
    expect(w.store.get(a.id)?.status).toBe("completed");
    expect(w.store.get(a.id)?.reportedAt).toBeUndefined();
    expect(w.store.inbox({ threadId: "chief-chat" })).toEqual([]);
    w.runtime.tick();
    expect(w.runner.reports.map(r => r.a.id)).toEqual([a.id]);
    expect(w.store.get(a.id)?.reportedAt).toBeDefined();
    expect(w.store.inbox({ threadId: "chief-chat" })).toHaveLength(1);
    w.runtime.tick();
    expect(w.runner.reports).toHaveLength(1);
    // a run that throws is a failed turn, not a hang
    w.runner.script = () => { throw new Error("engine gone"); };
    const b = ok(w.runtime.enqueue(toBot("b", root.id)));
    w.runtime.tick(); await flush();
    expect(w.store.get(b.id)).toMatchObject({ status: "failed", outcome: "provider_error", result: "Error: engine gone" });
    w.runtime.end(root.id, { ok: true, text: "" });
    w.runner.script = () => undefined;
    w.runtime.tick(); await flush();
    invariants(w);
  });

  it("never overlaps turns in one conversation, waits on a running same-room speaker, and batches change notices per tick", async () => {
    const w = world(() => "hold");
    const root = w.runtime.begin(beginReq());
    const sameThread = { botId: "builder", destination: { kind: "work_thread" as const, threadId: "builder-work" } };
    const one = ok(w.runtime.enqueue(toBot("builder", root.id, "One", { assignee: sameThread })));
    const two = ok(w.runtime.enqueue(toBot("builder", root.id, "Two", { assignee: sameThread })));
    const notice = ok(w.runtime.enqueue(toBot("ops", root.id, "FYI", { mode: "notify" })));
    expect(notice.reply).toBe("none");
    const before = w.runner.changes.length;
    w.runtime.tick();
    expect(w.runner.changes.length - before).toBe(1);
    expect(w.runner.runs.map(r => r.a.id)).toEqual([one.id, notice.id]);
    await w.runner.release(one.id, { kind: "completed", text: "one" });
    w.runtime.tick();
    expect(w.runner.runs.map(r => r.a.id)).toEqual([one.id, notice.id, two.id]);
    // a one-way notice neither holds its requester nor comes back to it
    await w.runner.release(two.id, { kind: "completed", text: "two" });
    w.runtime.end(root.id, { ok: true, text: "" });
    w.runtime.tick();
    expect(w.store.get(root.id)?.status).toBe("running");
    expect(w.runner.runs.at(-1)?.input.settled?.map(s => s.id)).toEqual([one.id, two.id]);
    await w.runner.release(root.id, { kind: "completed", text: "synth" });
    expect(w.store.get(root.id)?.status).toBe("completed");
    await w.runner.release(notice.id, { kind: "completed", text: "noted" });
    expect(w.store.inbox({ botId: "chief", threadId: "chief-chat" }).map(i => i.assignmentId)).toEqual([one.id, two.id]);
    invariants(w);
  });
});

describe("Runtime: host-named roots and request marks", () => {
  it("begins a root under the id the host names, or a fresh uuid", () => {
    const w = world();
    const named = w.runtime.begin(beginReq({ id: "gen-1" }));
    expect(named).toMatchObject({ id: "gen-1", rootId: "gen-1", status: "running" });
    expect(w.store.get("gen-1")?.id).toBe("gen-1");
    const fresh = w.runtime.begin(beginReq());
    expect(fresh.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fresh.rootId).toBe(fresh.id);
  });

  it("copies approved and batchKey onto the row and keeps them through the store", async () => {
    const w = world();
    const root = w.runtime.begin(beginReq({ id: "gen-2" }));
    const marked = ok(w.runtime.enqueue(toBot("builder", root.id, undefined, { approved: true, batchKey: "batch-1" })));
    expect(marked).toMatchObject({ approved: true, batchKey: "batch-1" });
    expect(w.store.get(marked.id)).toMatchObject({ approved: true, batchKey: "batch-1" });
    const plain = ok(w.runtime.enqueue(toBot("tester", root.id)));
    expect(plain.approved).toBeUndefined();
    expect(plain.batchKey).toBeUndefined();
    expect("approved" in w.store.get(plain.id)!).toBe(false);
    w.runtime.tick(); await flush();
    expect(w.store.get(marked.id)).toMatchObject({ status: "completed", approved: true, batchKey: "batch-1" });
    invariants(w);
  });
});

describe("access rechecked while work runs", () => {
  it("fails a running child whose route closes, drops its words, and the resume carries only the reason", async () => {
    const w = world(() => "hold");
    const root = w.runtime.begin(beginReq());
    const child = ok(w.runtime.enqueue(toBot("builder", root.id)));
    w.runtime.tick();
    expect(w.store.get(child.id)?.status).toBe("running");
    const signal = w.runner.runs[0]!.signal;
    // The route closes under the running turn: only this child is refused.
    w.runner.validate = a => a.id === child.id ? "Room work cannot cross the sender's section boundary" : undefined;
    w.runtime.tick();
    expect(w.store.get(child.id)).toMatchObject({ status: "failed", outcome: "refused", result: "Room work cannot cross the sender's section boundary" });
    expect(signal.aborted).toBe(true);
    // The late reply of the aborted turn changes nothing.
    await w.runner.release(child.id, { kind: "completed", text: "PRIVATE_RESULT" });
    expect(w.store.get(child.id)?.result).not.toContain("PRIVATE");
    w.runtime.end(root.id, { ok: true, text: "handed out" });
    w.runtime.tick();
    const resume = w.runner.runs.find(r => r.a.id === root.id && r.input.resumed);
    expect(resume?.input.settled?.map(s => s.result)).toEqual(["Room work cannot cross the sender's section boundary"]);
    invariants(w);
  });

  it("drops a reply that lands after the route closed, before any tick could notice", async () => {
    const w = world(() => "hold");
    const root = w.runtime.begin(beginReq());
    const child = ok(w.runtime.enqueue(toBot("builder", root.id)));
    w.runtime.tick();
    w.runner.validate = a => a.id === child.id ? "The recipient is not an allowed peer of the sender" : undefined;
    await w.runner.release(child.id, { kind: "completed", text: "PRIVATE_RESULT" });
    expect(w.store.get(child.id)).toMatchObject({ status: "failed", outcome: "refused", result: "The recipient is not an allowed peer of the sender" });
    expect(w.runner.reports.map(r => r.a.id)).toEqual([child.id]);
    invariants(w);
  });
});

describe("a resume turn a restart cut", () => {
  it("runs again with the same settled results, as a rerun, not as a fresh resume", async () => {
    const store = openRuntimeStore(":memory:");
    const first = world(() => "hold", {}, store);
    const root = first.runtime.begin(beginReq());
    const child = ok(first.runtime.enqueue(toBot("builder", root.id)));
    first.runtime.tick();
    await first.runner.release(child.id, { kind: "completed", text: "built" });
    first.runtime.end(root.id, { ok: true, text: "handed out" });
    first.runtime.tick();
    const resume = first.runner.runs.find(r => r.a.id === root.id)!;
    expect(resume.input.turn).toBe("resume");
    expect(resume.input.settled?.map(s => s.id)).toEqual([child.id]);
    // The restart lands while the resume turn runs: it is run again, in
    // place, still returning the child's result, and marked as a rerun.
    first.runtime.close();
    const second = world(() => "hold", {}, store);
    expect(store.get(root.id)).toMatchObject({ status: "resume", restart: "rerun", restarts: 1 });
    second.runtime.tick();
    const rerun = second.runner.runs.find(r => r.a.id === root.id)!;
    expect(rerun.input.turn).toBe("resume");
    expect(rerun.input.settled?.map(s => s.id)).toEqual([child.id]);
    expect(rerun.input.restartNote).toContain("this turn continues it");
    await second.runner.release(root.id, { kind: "completed", text: "reviewed" });
    expect(store.get(root.id)).toMatchObject({ status: "completed", executions: 3 });
    invariants(second);
  });
});
