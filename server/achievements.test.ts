// The achievement engine (server/achievements.ts) and its routes
// (server/routes/achievements.ts): idempotent unlocks, progress, anti-spam,
// grandfathering, the Trombi command, privacy.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  achievementFrameAllowed,
  achievementRequestEvents,
  achievementSendEvents,
  activityEvents,
  createAchievementStore,
  MIN_PEOPLE_FOR_PERCENT,
  routineRunEvents,
  slashCommandName,
} from "./achievements.ts";
import { ACHIEVEMENTS_PATH, createAchievementRoutes } from "./routes/achievements.ts";
import { PASS } from "./routes/table.ts";
import { CLIENT_ALLOW } from "./request-auth.ts";

const ADA = "pr_11111111-1111-4111-8111-111111111111";
const BOB = "pr_22222222-2222-4222-8222-222222222222";
const DAY = 86_400_000;

function setup(options: { grandfather?: (person: string) => string[]; start?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-achievements-"));
  let clock = options.start ?? Date.parse("2026-10-01T15:00:00Z");
  const store = createAchievementStore({ dataDir: dir, now: () => clock, persistDelayMs: 0, grandfather: options.grandfather });
  return { dir, store, tick: (ms: number) => (clock += ms), now: () => clock };
}

describe("achievement engine", () => {
  it("unlocks once, however often the event is replayed", () => {
    const { store, tick } = setup();
    const first = store.record(ADA, [{ type: "message.sent" }], "server");
    expect(first.unlocked.map((item) => item.id)).toEqual(["first-words"]);
    expect(store.snapshot(ADA).points).toBe(5);
    tick(5_000);
    expect(store.record(ADA, [{ type: "message.sent" }], "server").unlocked).toEqual([]);
    // an event with an id counts once
    store.record(ADA, [{ type: "routine.ran", id: "run-1" }], "server");
    store.record(ADA, [{ type: "routine.ran", id: "run-1" }], "server");
    const item = store.snapshot(ADA).items.find((candidate) => candidate.id === "well-oiled")!;
    expect(item).toMatchObject({ current: 1, target: 50 });
    expect(store.snapshot(ADA).unlockedCount).toBe(1);
  });

  it("tracks progress, distinct keys, maxima and days", () => {
    const { store, tick } = setup();
    for (const command of ["compact", "goal", "goal", "learn"]) {
      store.record(ADA, [{ type: "message.slash", key: command }], "server");
      tick(1_000);
    }
    const snapshot = store.snapshot(ADA);
    expect(snapshot.items.find((item) => item.id === "command-collector")).toMatchObject({ current: 3, target: 5 });
    expect(snapshot.items.find((item) => item.id === "slash-and-learn")?.unlockedAt).toBeTypeOf("number");
    store.record(ADA, [{ type: "voice.minutes", value: 4 }, { type: "voice.minutes", value: 11 }], "server");
    expect(store.snapshot(ADA).items.find((item) => item.id === "long-call")?.unlockedAt).toBeTypeOf("number");
    for (let day = 0; day < 7; day += 1) {
      store.record(ADA, [{ type: "routine.ran", id: `run-${day}` }], "server");
      tick(DAY);
    }
    expect(store.snapshot(ADA).items.find((item) => item.id === "clockwork")?.unlockedAt).toBeTypeOf("number");
    // seven active days in a row also earned the streaks
    expect(store.snapshot(ADA).items.find((item) => item.id === "week-streak")?.unlockedAt).toBeTypeOf("number");
  });

  it("unlocks a points tier in the same pass that crosses it", () => {
    const { store } = setup();
    const events = ["message.sent", "bot.created", "bot.customized", "bot.primary", "routine.created", "approval.answered", "message.slash", "message.attachment", "message.zip", "message.parallel", "subagent.used", "computer.control", "computer.auto", "voice.call", "bot.shared", "group.mixed", "dm.sent"] as const;
    const result = store.record(ADA, events.map((type) => ({ type, ...(type === "voice.call" ? { key: "c1" } : {}) })), "server");
    expect(result.unlocked.map((item) => item.id)).toContain("bronze");
    expect(result.unlocked.map((item) => item.id)).not.toContain("platinum");
  });

  it("refuses server events from the app and rate limits client events", () => {
    const { store, tick } = setup();
    expect(store.record(ADA, [{ type: "message.sent" }, { type: "bot.created" }], "client")).toEqual({ accepted: 0, unlocked: [] });
    expect(store.record(ADA, [{ type: "nonsense" as never }], "server").accepted).toBe(0);
    // petting faster than the limit counts once
    expect(store.record(ADA, Array.from({ length: 10 }, () => ({ type: "mascot.pet" as const })), "client").accepted).toBe(1);
    for (let i = 0; i < 60; i += 1) {
      tick(300);
      store.record(ADA, [{ type: "mascot.pet" }], "client");
    }
    expect(store.snapshot(ADA).items.find((item) => item.id === "good-bot")?.unlockedAt).toBeTypeOf("number");
    // a day's cap holds
    for (let i = 0; i < 500; i += 1) {
      tick(300);
      store.record(ADA, [{ type: "mascot.pet" }], "client");
    }
    expect(store.snapshot(ADA).items.find((item) => item.id === "best-friends")).toMatchObject({ current: 400, target: 500 });
  });

  it("unlocks Trombi for good with its command", () => {
    const { dir, store } = setup();
    expect(store.snapshot(ADA).rewards).not.toContain("character:trombi");
    const result = store.record(ADA, [{ type: "trombi.summoned" }], "client");
    expect(result.unlocked).toEqual([expect.objectContaining({ id: "trombi-summoned", points: 20 })]);
    const again = createAchievementStore({ dataDir: dir, persistDelayMs: 0 });
    expect(again.snapshot(ADA).rewards).toContain("character:trombi");
  });

  it("grandfathers what a person's bots already wear, once", () => {
    let calls = 0;
    const { store } = setup({ grandfather: () => (calls++, ["character:bunbu", "skin:owl:galaxy"]) });
    expect(store.snapshot(ADA).rewards).toEqual(["character:bunbu", "skin:owl:galaxy"]);
    store.snapshot(ADA);
    expect(calls).toBe(1);
    expect(store.snapshot(ADA).points).toBe(0);
  });

  it("keeps each person private, settings validated, points public only by choice", () => {
    const { dir, store } = setup();
    store.record(ADA, [{ type: "message.sent" }], "server");
    expect(store.snapshot(BOB).points).toBe(0);
    expect(store.publicPoints([ADA, BOB])).toEqual({});
    expect(store.updateSettings(ADA, { public: true, showPoints: false, title: "rookie", tzOffset: -240, junk: 1 })).toEqual({ showPoints: false, toasts: true, native: false, public: true, title: "rookie", tzOffset: -240 });
    // a title not unlocked is refused
    expect(store.updateSettings(BOB, { title: "platinum" }).title).toBeUndefined();
    expect(store.publicPoints([ADA, BOB])).toEqual({ [ADA]: { points: 5, level: 1 } });
    expect(readFileSync(join(dir, "achievements.json"), "utf8")).toContain(ADA);
    store.remove(ADA);
    expect(readFileSync(join(dir, "achievements.json"), "utf8")).not.toContain(ADA);
    expect(() => store.snapshot("../etc")).toThrow(/not a person/);
  });

  it("shows unlock percentages only with enough people", () => {
    const { store } = setup();
    store.record(ADA, [{ type: "message.sent" }], "server");
    expect(store.snapshot(ADA).items[0]!.percent).toBeUndefined();
    for (let i = 0; i < MIN_PEOPLE_FOR_PERCENT; i += 1) store.snapshot(`pr_person-${i}`);
    expect(store.snapshot(ADA).items.find((item) => item.id === "first-words")?.percent).toBe(17);
  });
});

describe("server events", () => {
  const lookups = { group: (id: string) => (id === "dm" ? { peopleDm: true, humans: 2, bots: 0 } : id === "mix" ? { peopleDm: false, humans: 2, bots: 2 } : null) };

  it("reads a successful request's method and path", () => {
    const ok = (method: string, path: string) => achievementRequestEvents({ method, path, status: 200 }, lookups).map((event) => event.type);
    expect(ok("POST", "/api/bots")).toEqual(["bot.created"]);
    expect(achievementRequestEvents({ method: "POST", path: "/api/bots", status: 403 }, lookups)).toEqual([]);
    expect(ok("POST", "/api/bots/b1/primary")).toEqual(["bot.primary"]);
    expect(ok("POST", "/api/routines")).toEqual(["routine.created"]);
    expect(ok("PATCH", "/api/bots/b1/cards/c1")).toEqual(["approval.answered"]);
    expect(ok("POST", "/api/bots/b1/computer/control")).toEqual(["computer.control"]);
    expect(ok("PUT", "/api/bots/b1/grants")).toEqual(["bot.shared"]);
    expect(ok("POST", "/api/groups/dm/messages")).toEqual(["dm.sent"]);
    expect(ok("POST", "/api/groups/mix/messages")).toEqual(["group.message", "message.sent", "group.mixed"]);
    expect(ok("GET", "/api/bots")).toEqual([]);
  });

  it("reads a message: slash command, attachment, zip, parallel and the voice call", () => {
    const starts = new Map<string, number>();
    const t0 = 1_000_000;
    expect(slashCommandName("/compact please")).toBe("compact");
    expect(slashCommandName("a /path")).toBeNull();
    const types = (events: ReturnType<typeof achievementSendEvents>) => events.map((event) => event.type);
    expect(types(achievementSendEvents({ text: "/goal ship", parallel: true }, starts, t0))).toEqual(["message.sent", "message.slash", "message.parallel"]);
    expect(types(achievementSendEvents({ text: 'see <attached-file path="a/b.zip" name="b.zip">', parallel: false }, starts, t0))).toEqual(["message.sent", "message.attachment", "message.zip"]);
    achievementSendEvents({ text: "hi", parallel: false, voiceCall: { callId: "call-1" } }, starts, t0);
    const later = achievementSendEvents({ text: "and", parallel: false, voiceCall: { callId: "call-1", interrupted: true } }, starts, t0 + 11 * 60_000);
    expect(later).toContainEqual({ type: "voice.minutes", value: 11 });
    expect(later).toContainEqual({ type: "voice.interrupt" });
    expect(later).toContainEqual({ type: "voice.call", key: "call-1", id: "call-1" });
  });

  it("reads live frames: completed routine runs, sub-agents and Auto", () => {
    expect(routineRunEvents({ id: "r1", status: "completed" })).toEqual([{ type: "routine.ran", id: "r1" }]);
    expect(routineRunEvents({ id: "r1", status: "running" })).toEqual([]);
    expect(activityEvents({ kind: "activity", tool: { name: "Task", parentItemId: "p1" } })).toEqual([{ type: "subagent.used", id: "p1" }]);
    expect(activityEvents({ kind: "activity", tool: { name: "mcp__sagax-computer__computer_select", itemId: "i1" } })).toEqual([{ type: "computer.auto", id: "i1" }]);
    expect(activityEvents({ kind: "text" })).toEqual([]);
  });

  it("sends an unlock frame to its person's streams only", () => {
    const frame = { kind: "achievements", audience: ADA };
    expect(achievementFrameAllowed(frame, ADA, "local")).toBe(true);
    expect(achievementFrameAllowed(frame, BOB, "local")).toBe(false);
    expect(achievementFrameAllowed({ kind: "achievements", audience: "local" }, undefined, "local")).toBe(true);
    expect(achievementFrameAllowed({ kind: "message" }, BOB, "local")).toBe(true);
  });
});

type Answer = { status: number; body: unknown };
function call(route: ReturnType<typeof createAchievementRoutes>, input: { method: string; person?: string | null; body?: unknown; path?: string; type?: string }) {
  let answer: Answer | null = null;
  const path = input.path ?? ACHIEVEMENTS_PATH;
  return route({
    req: { headers: { "content-type": input.type ?? "application/json" } } as never,
    res: { setHeader: () => undefined } as never,
    url: new URL(`http://x${path}`),
    path: path.split("?")[0]!,
    method: input.method,
    auth: { person: input.person } as never,
    json: ((_res: unknown, status: number, body: unknown) => { answer = { status, body }; }) as never,
    readBody: (async () => input.body) as never,
  }).then((out) => (out === PASS ? "PASS" : answer));
}

describe("/api/me/achievements", () => {
  it("answers the caller's own record and takes client events only", async () => {
    const { store } = setup();
    const told: string[] = [];
    const route = createAchievementRoutes({ store, person: (auth) => (auth as unknown as { person?: string | null }).person ?? null, unlocked: (person, unlocks) => told.push(`${person}:${unlocks.map((item) => item.id).join(",")}`) });
    expect(await call(route, { method: "GET", path: "/api/me/preferences", person: ADA })).toBe("PASS");
    expect(await call(route, { method: "GET", person: null })).toMatchObject({ status: 404 });
    expect(await call(route, { method: "GET", person: ADA })).toMatchObject({ status: 200, body: { points: 0, count: expect.any(Number) } });
    const posted = await call(route, { method: "POST", path: `${ACHIEVEMENTS_PATH}/events`, person: ADA, body: { events: [{ type: "trombi.summoned" }, { type: "bot.created" }] } });
    expect(posted).toMatchObject({ status: 200, body: { accepted: 1, unlocked: [{ id: "trombi-summoned" }] } });
    expect(told).toEqual([`${ADA}:trombi-summoned`]);
    expect(await call(route, { method: "POST", path: `${ACHIEVEMENTS_PATH}/events`, person: ADA, body: { events: "x" } })).toMatchObject({ status: 400 });
    expect(await call(route, { method: "PUT", path: `${ACHIEVEMENTS_PATH}/settings`, person: ADA, body: { settings: { toasts: false } } })).toMatchObject({ status: 200, body: { settings: { toasts: false } } });
    expect(await call(route, { method: "PUT", path: `${ACHIEVEMENTS_PATH}/settings`, person: ADA, type: "text/plain", body: { settings: {} } })).toMatchObject({ status: 415 });
    expect(await call(route, { method: "GET", path: `/api/achievements/public?ids=${ADA}`, person: BOB })).toMatchObject({ status: 200, body: { points: {} } });
  });

  it("is a member's own route (client scope)", () => {
    for (const [method, path] of [["GET", ACHIEVEMENTS_PATH], ["POST", `${ACHIEVEMENTS_PATH}/events`], ["PUT", `${ACHIEVEMENTS_PATH}/settings`], ["GET", "/api/achievements/public"]] as const) {
      const rule = CLIENT_ALLOW.find((entry) => entry.path.test(path));
      expect(rule?.methods).toContain(method);
    }
  });
});
