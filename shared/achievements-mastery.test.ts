// The Mastery tier's measures (achievements-mastery.ts), one rule at a time:
// the counters, the conditions that reset them, the windows that span days,
// and the stored state read back.
import { describe, expect, it } from "vitest";
import {
  applyMasteryFact,
  cleanMasteryState,
  emptyMasteryState,
  looksFrench,
  masteryMetricValue,
  MASTERY_RULES,
  previousDay,
  reconcileMastery,
  type MasteryFact,
  type MasteryState,
} from "./achievements-mastery.ts";

const T0 = Date.parse("2026-10-01T15:00:00Z");
const DAY = 86_400_000;
const day = (n: number) => new Date(T0 + n * DAY).toISOString().slice(0, 10);

function run(state: MasteryState, facts: MasteryFact[], dayIndex = 0, at = T0 + dayIndex * DAY): void {
  for (const fact of facts) applyMasteryFact(state, fact, at, day(dayIndex));
}

const ok = (routineId: string, extra: Partial<Extract<MasteryFact, { kind: "routine.outcome" }>> = {}): MasteryFact => ({ kind: "routine.outcome", routineId, ok: true, botId: "b1", ...extra });
const fail = (routineId: string): MasteryFact => ({ kind: "routine.outcome", routineId, ok: false, botId: "b1" });
const done = (threadId: string, extra: Partial<Extract<MasteryFact, { kind: "turn.done" }>> = {}): MasteryFact => ({ kind: "turn.done", threadId, botId: "b1", ok: true, ...extra });

describe("Shiba: routines", () => {
  it("Hands Off counts completed runs in a row of one routine; a failure starts over", () => {
    const state = emptyMasteryState();
    run(state, Array.from({ length: 6 }, () => ok("r1")));
    run(state, [fail("r1")]);
    run(state, Array.from({ length: 4 }, () => ok("r1")));
    expect(masteryMetricValue(state, "routine.clean-streak")).toBe(6);
    run(state, Array.from({ length: 6 }, () => ok("r1")));
    expect(masteryMetricValue(state, "routine.clean-streak")).toBe(10);
    // another routine's runs never add to this one
    run(state, Array.from({ length: 3 }, () => ok("r2")));
    expect(state.routines.r1!.streak).toBe(10);
  });

  it("Second Wind needs a failure, then an edit, then three completed runs", () => {
    const state = emptyMasteryState();
    // completed runs after a failure without an edit do not count
    run(state, [fail("r1"), ok("r1"), ok("r1"), ok("r1")]);
    expect(masteryMetricValue(state, "routine.recovered")).toBe(0);
    // an edit of a routine that did not fail does nothing
    run(state, [{ kind: "routine.edited", routineId: "r2" }]);
    expect(state.routines.r2).toBeUndefined();
    run(state, [fail("r1"), { kind: "routine.edited", routineId: "r1" }, ok("r1"), ok("r1")]);
    expect(masteryMetricValue(state, "routine.recovered")).toBe(0);
    // a failure after the fix starts over
    run(state, [fail("r1"), ok("r1"), ok("r1"), ok("r1")]);
    expect(masteryMetricValue(state, "routine.recovered")).toBe(0);
    run(state, [{ kind: "routine.edited", routineId: "r1" }, ok("r1"), ok("r1"), ok("r1")]);
    expect(masteryMetricValue(state, "routine.recovered")).toBe(1);
    run(state, [fail("r3"), { kind: "routine.edited", routineId: "r3" }, ...Array.from({ length: MASTERY_RULES.recoveryRuns }, () => ok("r3"))]);
    expect(masteryMetricValue(state, "routine.recovered")).toBe(2);
  });

  it("Common Thread counts only runs of a routine that carries its last report", () => {
    const state = emptyMasteryState();
    run(state, Array.from({ length: 20 }, () => ok("plain")));
    expect(masteryMetricValue(state, "routine.continuity-runs")).toBe(0);
    run(state, Array.from({ length: 14 }, () => ok("carry", { continuity: true })));
    expect(masteryMetricValue(state, "routine.continuity-runs")).toBe(14);
  });

  it("Quiet Nights counts calendar days in a row with runs and no failure; a failed day or a missing day breaks it", () => {
    const state = emptyMasteryState();
    for (let n = 0; n < 12; n += 1) run(state, [ok("r1")], n);
    // today (day 11) is not over: eleven finished days
    expect(masteryMetricValue(state, "routine.quiet-days")).toBe(11);
    // a day with a failure (even after a success) breaks the run
    run(state, [ok("r1"), fail("r2")], 12);
    for (let n = 13; n < 20; n += 1) run(state, [ok("r1")], n);
    expect(masteryMetricValue(state, "routine.quiet-days")).toBe(12);
    // a day with no run at all breaks it too (day 20 skipped)
    for (let n = 21; n < 51; n += 1) run(state, [ok("r1")], n);
    expect(masteryMetricValue(state, "routine.quiet-days")).toBe(29);
    // the nightly pass of day 51 closes day 50
    reconcileMastery(state, day(51));
    expect(masteryMetricValue(state, "routine.quiet-days")).toBe(30);
  });

  it("Pack Leader counts bots with a routine of 20 completed runs", () => {
    const state = emptyMasteryState();
    for (const [routine, bot] of [["r1", "b1"], ["r2", "b1"], ["r3", "b2"]] as const) run(state, Array.from({ length: 20 }, () => ok(routine, { botId: bot })));
    expect(masteryMetricValue(state, "routine.pack")).toBe(2);
    run(state, Array.from({ length: 19 }, () => ok("r4", { botId: "b3" })));
    expect(masteryMetricValue(state, "routine.pack")).toBe(2);
    run(state, [ok("r4", { botId: "b3" })]);
    expect(masteryMetricValue(state, "routine.pack")).toBe(3);
  });
});

describe("Grump: approvals and corrections", () => {
  it("Reviewer counts a denied write approval followed by a completed turn, once per denial", () => {
    const state = emptyMasteryState();
    // a denied read, an allowed write: nothing
    run(state, [{ kind: "approval.answered", threadId: "t1", allow: false, write: false }, done("t1")]);
    run(state, [{ kind: "approval.answered", threadId: "t1", allow: true, write: true }, done("t1")]);
    expect(masteryMetricValue(state, "approval.denied-then-done")).toBe(0);
    // a denied write, then the turn fails: nothing, and the denial is spent
    run(state, [{ kind: "approval.answered", threadId: "t1", allow: false, write: true }, done("t1", { ok: false }), done("t1")]);
    expect(masteryMetricValue(state, "approval.denied-then-done")).toBe(0);
    run(state, [{ kind: "approval.answered", threadId: "t1", allow: false, write: true }, done("t1"), done("t1")]);
    expect(masteryMetricValue(state, "approval.denied-then-done")).toBe(1);
  });

  it("Prompter counts a correction steered into a running turn that then completes", () => {
    const state = emptyMasteryState();
    run(state, [{ kind: "message.sent", threadId: "t1", french: false }, done("t1")]);
    run(state, [{ kind: "message.sent", threadId: "t1", french: false, steered: true }, done("t1", { ok: false })]);
    expect(masteryMetricValue(state, "turn.steered-then-done")).toBe(0);
    run(state, [{ kind: "message.sent", threadId: "t1", french: false, steered: true }, { kind: "message.sent", threadId: "t1", french: false, steered: true }, done("t1")]);
    expect(masteryMetricValue(state, "turn.steered-then-done")).toBe(1);
  });

  it("Red Pen counts days a revision was followed by five completed turns of that bot", () => {
    const state = emptyMasteryState();
    run(state, [{ kind: "persona.saved", botId: "b1" }, ...Array.from({ length: 4 }, () => done("t1"))], 0);
    expect(masteryMetricValue(state, "persona.revised")).toBe(0);
    run(state, [done("t2", { botId: "b2" })], 0);
    expect(masteryMetricValue(state, "persona.revised")).toBe(0);
    run(state, [done("t1")], 0);
    expect(masteryMetricValue(state, "persona.revised")).toBe(1);
    // the same day again does not count twice
    run(state, [{ kind: "persona.saved", botId: "b1" }, ...Array.from({ length: 5 }, () => done("t1"))], 0);
    expect(masteryMetricValue(state, "persona.revised")).toBe(1);
    run(state, [{ kind: "persona.saved", botId: "b1" }, ...Array.from({ length: 5 }, () => done("t1"))], 1);
    expect(masteryMetricValue(state, "persona.revised")).toBe(2);
  });

  it("Not So Fast counts a stop followed by a completed turn of that bot", () => {
    const state = emptyMasteryState();
    run(state, [{ kind: "bot.stopped", botId: "b1" }, done("t1", { botId: "b2" })]);
    expect(masteryMetricValue(state, "turn.stopped-then-done")).toBe(0);
    run(state, [done("t1", { ok: false }), done("t1"), done("t1")]);
    expect(masteryMetricValue(state, "turn.stopped-then-done")).toBe(1);
  });

  it("Justice of the Peace needs denials and enough answers: one denial per five answers", () => {
    const state = emptyMasteryState();
    run(state, Array.from({ length: 20 }, () => ({ kind: "approval.answered", allow: false, write: false }) as MasteryFact));
    // 20 denials in 20 answers: only 4 count
    expect(masteryMetricValue(state, "approval.judgment")).toBe(4);
    run(state, Array.from({ length: 80 }, () => ({ kind: "approval.answered", allow: true, write: false }) as MasteryFact));
    expect(masteryMetricValue(state, "approval.judgment")).toBe(20);
  });
});

describe("Ogre: orchestration", () => {
  it("Conductor counts a turn that completes after two different bots came back done", () => {
    const state = emptyMasteryState();
    const back = (toBotId: string, ok = true): MasteryFact => ({ kind: "delegation.done", threadId: "t1", toBotId, ok, crossModel: false });
    run(state, [back("b2"), back("b2"), done("t1")]);
    expect(masteryMetricValue(state, "delegation.conducted")).toBe(0);
    run(state, [back("b2"), back("b3", false), done("t1")]);
    expect(masteryMetricValue(state, "delegation.conducted")).toBe(0);
    run(state, [back("b2"), back("b3"), done("t1", { ok: false })]);
    expect(masteryMetricValue(state, "delegation.conducted")).toBe(0);
    run(state, [back("b2"), back("b3"), done("t1")]);
    expect(masteryMetricValue(state, "delegation.conducted")).toBe(1);
  });

  it("Ten Hands needs no stale conversation and five folders", () => {
    const state = emptyMasteryState();
    run(state, [{ kind: "threads.census", open: 12, folders: 5, stale: 1 }]);
    expect(masteryMetricValue(state, "threads.tidy")).toBe(9);
    run(state, [{ kind: "threads.census", open: 12, folders: 4, stale: 0 }]);
    expect(masteryMetricValue(state, "threads.tidy")).toBe(9);
    run(state, [{ kind: "threads.census", open: 10, folders: 5, stale: 0 }]);
    expect(masteryMetricValue(state, "threads.tidy")).toBe(10);
  });

  it("Plugged In counts different integrations within seven days, the window sliding", () => {
    const state = emptyMasteryState();
    run(state, [{ kind: "tool.used", threadId: "t1", integration: "perspicax:cw_psa" }, { kind: "tool.used", threadId: "t1", integration: "perspicax:cw_psa" }], 0);
    run(state, [{ kind: "tool.used", threadId: "t1", integration: "github" }], 1);
    expect(masteryMetricValue(state, "integrations.week")).toBe(2);
    // eight days later the first two have left the window
    run(state, [{ kind: "tool.used", threadId: "t1", integration: "linear" }], 9);
    expect(masteryMetricValue(state, "integrations.week")).toBe(2);
    run(state, [{ kind: "tool.used", threadId: "t1", integration: "notion" }, { kind: "tool.used", threadId: "t1", integration: "perspicax:sentinelone" }], 10);
    expect(masteryMetricValue(state, "integrations.week")).toBe(3);
  });

  it("Swarm counts different sub-agents in one completed turn, starting over each turn", () => {
    const state = emptyMasteryState();
    run(state, [{ kind: "tool.used", threadId: "t1", subagent: "a" }, { kind: "tool.used", threadId: "t1", subagent: "a" }, { kind: "tool.used", threadId: "t1", subagent: "b" }, done("t1")]);
    run(state, [{ kind: "tool.used", threadId: "t1", subagent: "c" }, done("t1")]);
    expect(masteryMetricValue(state, "subagents.turn")).toBe(2);
    run(state, ["d", "e", "f"].map((subagent) => ({ kind: "tool.used", threadId: "t1", subagent }) as MasteryFact));
    run(state, [done("t1", { ok: false })]);
    expect(masteryMetricValue(state, "subagents.turn")).toBe(2);
    run(state, [...["d", "e", "f"].map((subagent) => ({ kind: "tool.used", threadId: "t1", subagent }) as MasteryFact), done("t1")]);
    expect(masteryMetricValue(state, "subagents.turn")).toBe(3);
  });

  it("Full House counts bots at work together once all of them finished well", () => {
    const state = emptyMasteryState();
    const start = (threadId: string, botId: string): MasteryFact => ({ kind: "turn.started", threadId, botId });
    // three bots, one fails: nothing
    run(state, [start("t1", "b1"), start("t2", "b2"), start("t3", "b3"), done("t1"), done("t2", { ok: false }), done("t3")]);
    expect(masteryMetricValue(state, "bots.concurrent")).toBe(0);
    // two threads of one bot are one bot
    run(state, [start("t1", "b1"), start("t4", "b1"), start("t2", "b2"), done("t1"), done("t4"), done("t2")]);
    expect(masteryMetricValue(state, "bots.concurrent")).toBe(2);
    run(state, [start("t1", "b1"), start("t2", "b2"), start("t3", "b3"), done("t1"), done("t2"), done("t3")]);
    expect(masteryMetricValue(state, "bots.concurrent")).toBe(3);
  });

  it("forgets a turn stuck for hours rather than counting it as working alongside", () => {
    const state = emptyMasteryState();
    run(state, [{ kind: "turn.started", threadId: "stuck", botId: "b9" }], 0, T0);
    run(state, [{ kind: "turn.started", threadId: "t1", botId: "b1" }], 0, T0 + MASTERY_RULES.busyMs + 1);
    expect(Object.keys(state.busy)).toEqual(["t1"]);
  });
});

describe("Frog: models and knowledge", () => {
  it("Polyglot counts providers within one conversation", () => {
    const state = emptyMasteryState();
    run(state, [done("t1", { provider: "anthropic" }), done("t2", { provider: "openai" }), done("t3", { provider: "xai" })]);
    expect(masteryMetricValue(state, "providers.thread")).toBe(1);
    run(state, [done("t1", { provider: "openai" }), done("t1", { provider: "Anthropic" }), done("t1", { provider: "xai" })]);
    expect(masteryMetricValue(state, "providers.thread")).toBe(3);
  });

  it("Thrifty needs 20 Auto turns in seven days with more than half cheaper", () => {
    const state = emptyMasteryState();
    // 20 Auto turns over a week, exactly half cheaper: not more than half
    for (let n = 0; n < 5; n += 1) run(state, [done("t1", { auto: { cheaper: true } }), done("t1", { auto: { cheaper: true } }), done("t1", { auto: { cheaper: false } }), done("t1", { auto: { cheaper: false } })], n);
    expect(masteryMetricValue(state, "auto.thrifty-weeks")).toBe(0);
    // turns spread over more than seven days do not add up
    const spread = emptyMasteryState();
    for (let n = 0; n < 20; n += 1) run(spread, [done("t1", { auto: { cheaper: true } })], n * 2);
    expect(masteryMetricValue(spread, "auto.thrifty-weeks")).toBe(0);
    run(state, [done("t1", { auto: { cheaper: true } })], 5);
    expect(masteryMetricValue(state, "auto.thrifty-weeks")).toBe(1);
  });

  it("Translator counts conversations of six turns where every message and answer was French", () => {
    const state = emptyMasteryState();
    const frenchTurn = (threadId: string): MasteryFact[] => [{ kind: "message.sent", threadId, french: true }, { kind: "reply", threadId, french: true }, done(threadId)];
    for (let n = 0; n < 6; n += 1) run(state, frenchTurn("t1"));
    expect(masteryMetricValue(state, "french.threads")).toBe(1);
    // more turns in the same conversation do not count it again
    run(state, frenchTurn("t1"));
    expect(masteryMetricValue(state, "french.threads")).toBe(1);
    // one English answer and the conversation is out for good
    for (let n = 0; n < 3; n += 1) run(state, frenchTurn("t2"));
    run(state, [{ kind: "reply", threadId: "t2", french: false }, done("t2")]);
    for (let n = 0; n < 4; n += 1) run(state, frenchTurn("t2"));
    expect(masteryMetricValue(state, "french.threads")).toBe(1);
  });

  it("Skill Smith counts uses of a skill learned from a conversation only", () => {
    const state = emptyMasteryState();
    run(state, Array.from({ length: 5 }, () => ({ kind: "tool.used", threadId: "t1", skill: "deploy" }) as MasteryFact));
    expect(masteryMetricValue(state, "skills.learned-uses")).toBe(0);
    run(state, [{ kind: "skill.learned", skill: "Deploy" }, ...Array.from({ length: 20 }, () => ({ kind: "tool.used", threadId: "t1", skill: "deploy" }) as MasteryFact)]);
    expect(masteryMetricValue(state, "skills.learned-uses")).toBe(20);
  });

  it("Total Recall counts different conversations where a memory the person wrote was recalled", () => {
    const state = emptyMasteryState();
    run(state, [{ kind: "memory.recalled", botId: "b1", threadId: "t1" }]);
    expect(masteryMetricValue(state, "memory.recall-threads")).toBe(0);
    run(state, [{ kind: "memory.written", botId: "b1" }]);
    for (let n = 0; n < 10; n += 1) run(state, [{ kind: "memory.recalled", botId: "b1", threadId: `t${n}` }, { kind: "memory.recalled", botId: "b1", threadId: `t${n}` }]);
    run(state, [{ kind: "memory.recalled", botId: "b2", threadId: "t99" }]);
    expect(masteryMetricValue(state, "memory.recall-threads")).toBe(10);
  });
});

describe("the hardest four", () => {
  it("Ferryman counts different people who imported one published bot", () => {
    const state = emptyMasteryState();
    run(state, [{ kind: "catalog.imported", botId: "b1", importer: "p1" }, { kind: "catalog.imported", botId: "b1", importer: "p1" }, { kind: "catalog.imported", botId: "b2", importer: "p2" }]);
    expect(masteryMetricValue(state, "catalog.imports")).toBe(1);
    run(state, [{ kind: "catalog.imported", botId: "b1", importer: "p2" }, { kind: "catalog.imported", botId: "b1", importer: "p3" }]);
    expect(masteryMetricValue(state, "catalog.imports")).toBe(3);
  });

  it("Second Opinion counts delegations to another model family that came back done", () => {
    const state = emptyMasteryState();
    run(state, [{ kind: "delegation.done", threadId: "t1", toBotId: "b2", ok: true, crossModel: false }, { kind: "delegation.done", threadId: "t1", toBotId: "b2", ok: false, crossModel: true }]);
    expect(masteryMetricValue(state, "delegation.cross-model")).toBe(0);
    run(state, [{ kind: "delegation.done", threadId: "t1", toBotId: "b2", ok: true, crossModel: true }]);
    expect(masteryMetricValue(state, "delegation.cross-model")).toBe(1);
  });

  it("Clean Slate counts finished days where every approval asked was answered and no routine failed", () => {
    const state = emptyMasteryState();
    run(state, [{ kind: "approval.requested" }, { kind: "approval.answered", allow: true, write: false }], 0);
    run(state, [{ kind: "approval.requested" }, { kind: "approval.requested" }, { kind: "approval.answered", allow: true, write: false }], 1);
    run(state, [{ kind: "approval.requested" }, { kind: "approval.answered", allow: false, write: false }, fail("r1")], 2);
    run(state, [{ kind: "approval.requested" }, { kind: "approval.answered", allow: true, write: false }], 3);
    // today (day 3) is not finished yet
    expect(masteryMetricValue(state, "approvals.clean-days")).toBe(1);
    // the nightly pass on the next day closes it
    reconcileMastery(state, day(4));
    expect(masteryMetricValue(state, "approvals.clean-days")).toBe(2);
  });
});

describe("the stored state", () => {
  it("never goes down: a best value stays when its run ends", () => {
    const state = emptyMasteryState();
    run(state, Array.from({ length: 8 }, () => ok("r1")));
    run(state, [fail("r1")]);
    expect(masteryMetricValue(state, "routine.clean-streak")).toBe(8);
  });

  it("reads back what it wrote and drops what it does not know", () => {
    const state = emptyMasteryState();
    run(state, [ok("r1"), fail("r1"), { kind: "routine.edited", routineId: "r1" }, { kind: "persona.saved", botId: "b1" }, { kind: "skill.learned", skill: "x" }, { kind: "memory.written", botId: "b1" }]);
    run(state, [{ kind: "turn.started", threadId: "t1", botId: "b1" }, { kind: "message.sent", threadId: "t1", french: true, steered: true }]);
    const copy = cleanMasteryState(JSON.parse(JSON.stringify(state)));
    expect(copy).toEqual(state);
    const junk = cleanMasteryState({ metrics: { "routine.clean-streak": -3, nonsense: 9, "routine.pack": "x" }, days: { "not-a-day": { runs: 1 } }, routines: "x", threads: [1, 2] });
    expect(junk).toEqual(emptyMasteryState());
  });

  it("stays bounded however many threads and days go by", () => {
    const state = emptyMasteryState();
    for (let n = 0; n < 500; n += 1) run(state, [done(`t${n}`)], n);
    expect(Object.keys(state.threads).length).toBeLessThanOrEqual(300);
    expect(Object.keys(state.days).length).toBeLessThanOrEqual(120);
    // the oldest days went first
    expect(Object.keys(state.days).sort()[0]).toBe(day(380));
    expect(previousDay(day(1))).toBe(day(0));
  });
});

describe("looksFrench", () => {
  it("tells French from English by their small words, and lets short texts pass", () => {
    expect(looksFrench("Peux-tu me faire un résumé de la réunion de ce matin avec les points à suivre?")).toBe(true);
    expect(looksFrench("Voici le rapport : les ventes sont en hausse et nous avons trois nouveaux clients.")).toBe(true);
    expect(looksFrench("Can you summarize the meeting from this morning with the action items?")).toBe(false);
    expect(looksFrench("ok merci")).toBe(true);
    expect(looksFrench("```ts\nconst the = is.and.you;\n```\nVoici le code que tu as demandé pour la page.")).toBe(true);
  });
});
