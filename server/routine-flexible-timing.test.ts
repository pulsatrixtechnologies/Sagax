import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scheduleText } from "./routine-requests.ts";
import { nextOccurrence, RoutineManager, type RoutineScheduleInput } from "./routines.ts";
import { zonedParts, zonedTimeToUtc } from "../shared/zoned-time.ts";

const MINUTE = 60_000;
const DAYS = [0, 1, 2, 3, 4, 5, 6];

function harness(start = new Date(2026, 7, 17, 8, 0, 0, 0).getTime()) {
  const dir = mkdtempSync(join(tmpdir(), "routine-timing-"));
  const file = join(dir, "routines.json");
  let now = start;
  const manager = new RoutineManager({
    file,
    now: () => now,
    startTurn: async () => {},
  });
  return {
    file,
    manager,
    get now() { return now; },
    setNow(at: number) { now = at; },
    stop() {
      manager.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const open: { stop: () => void }[] = [];
afterEach(() => {
  while (open.length) open.pop()!.stop();
});

function daily(extra: Record<string, unknown> = {}) {
  return { type: "daily" as const, time: "09:00", weekdays: DAYS, ...extra };
}

describe("flexible routine timing", () => {
  it("keeps exact timing on the old schedule and the old next run", () => {
    const h = harness();
    open.push(h);
    const schedule = daily();
    const routine = h.manager.create({ name: "Morning", prompt: "Check the list", botId: "b1", schedule });
    expect(routine.schedule).toEqual(schedule);
    expect(routine.nominalRunAt).toBeUndefined();
    expect(routine.nextRunAt).toBe(nextOccurrence(schedule, h.now));
    const disk = JSON.parse(readFileSync(h.file, "utf8")) as { routines: Array<{ schedule: object; nominalRunAt?: number }> };
    expect(disk.routines[0]!.schedule).toEqual(schedule);
    expect(disk.routines[0]!.nominalRunAt).toBeUndefined();
    const saved = routine.nextRunAt;
    h.manager.stop();
    const again = new RoutineManager({ file: h.file, now: () => h.now, startTurn: async () => {} });
    open.push({ stop: () => again.stop() });
    again.start();
    expect(again.listRoutines()[0]!.nextRunAt).toBe(saved);
    again.stop();
  });

  it("starts inside the window, caps it, and keeps that start across a restart", () => {
    const h = harness();
    open.push(h);
    let routine = h.manager.create({
      name: "Window",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 }),
    });
    for (let index = 0; index < 6 && routine.nextRunAt === routine.nominalRunAt; index++) {
      routine = h.manager.create({
        name: `Window ${index}`,
        prompt: "Check the list",
        botId: "b1",
        schedule: daily({ timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 }),
      });
    }
    const nominal = routine.nominalRunAt!;
    const start = routine.nextRunAt!;
    expect(start).not.toBe(nominal);
    expect(start).toBeGreaterThanOrEqual(nominal - 15 * MINUTE);
    expect(start).toBeLessThanOrEqual(nominal + 15 * MINUTE);
    expect(routine.schedule).toMatchObject({ timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 });

    h.manager.stop();
    const again = new RoutineManager({ file: h.file, now: () => h.now, startTurn: async () => {} });
    open.push({ stop: () => again.stop() });
    again.start();
    const reloaded = again.listRoutines().find((item) => item.id === routine.id)!;
    expect(reloaded.nextRunAt).toBe(start);
    expect(reloaded.nominalRunAt).toBe(nominal);
    again.stop();
  });

  it("caps a short interval and a cron at half the gap, and a late window of 0 stays on time", () => {
    const h = harness();
    open.push(h);
    const interval = h.manager.create({
      name: "Often",
      prompt: "Check the list",
      botId: "b1",
      schedule: {
        type: "interval",
        everyMinutes: 10,
        anchorAt: h.now,
        timing: "flexible",
        windowEarlyMinutes: 15,
        windowLateMinutes: 15,
      },
    });
    expect(interval.schedule.windowEarlyMinutes! + interval.schedule.windowLateMinutes!).toBe(5);
    expect(interval.nextRunAt).toBeGreaterThanOrEqual(interval.nominalRunAt! - interval.schedule.windowEarlyMinutes! * MINUTE);
    expect(interval.nextRunAt).toBeLessThanOrEqual(interval.nominalRunAt! + interval.schedule.windowLateMinutes! * MINUTE);

    const cron = h.manager.create({
      name: "Clock",
      prompt: "Check the list",
      botId: "b1",
      schedule: {
        type: "cron",
        expression: "*/10 * * * *",
        timeZone: "UTC",
        timing: "flexible",
        windowEarlyMinutes: 15,
        windowLateMinutes: 15,
      },
    });
    expect(cron.schedule.windowEarlyMinutes! + cron.schedule.windowLateMinutes!).toBe(5);

    const onTime = h.manager.create({
      name: "Ready",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ timing: "flexible", windowEarlyMinutes: 20, windowLateMinutes: 0 }),
    });
    expect(onTime.schedule).toMatchObject({ windowEarlyMinutes: 20, windowLateMinutes: 0 });
    expect(onTime.nextRunAt).toBeLessThanOrEqual(onTime.nominalRunAt!);
    expect(onTime.nextRunAt).toBeGreaterThanOrEqual(onTime.nominalRunAt! - 20 * MINUTE);
  });

  it("uses 15 minutes on each side when a flexible routine names no window", () => {
    const h = harness();
    open.push(h);
    const routine = h.manager.create({
      name: "Default",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ timing: "flexible" }),
    });
    expect(routine.schedule).toMatchObject({ timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 });
  });

  it("rejects timing on a one-time routine and a window on exact timing", () => {
    const h = harness();
    open.push(h);
    expect(() => h.manager.create({
      name: "Once",
      prompt: "Check the list",
      botId: "b1",
      schedule: { type: "once", at: h.now + MINUTE, timing: "flexible" } as RoutineScheduleInput,
    })).toThrow(/one-time/i);
    expect(() => h.manager.create({
      name: "Exact",
      prompt: "Check the list",
      botId: "b1",
      schedule: { ...daily(), timing: "exact", windowEarlyMinutes: 5 },
    })).toThrow(/window/i);
  });

  it("advances from the nominal slot, so an early start does not run that slot again", async () => {
    const h = harness();
    open.push(h);
    const routine = h.manager.create({
      name: "Steady",
      prompt: "Check the list",
      botId: "b1",
      schedule: {
        type: "interval",
        everyMinutes: 30,
        anchorAt: h.now,
        timing: "flexible",
        windowEarlyMinutes: 10,
        windowLateMinutes: 10,
      },
    });
    const firstNominal = routine.nominalRunAt!;
    h.setNow(routine.nextRunAt!);
    await h.manager.tick();
    const after = h.manager.getRoutine(routine.id)!;
    expect(after.nominalRunAt).toBe(nextOccurrence(routine.schedule, firstNominal));
    expect(after.nominalRunAt).not.toBe(firstNominal);
    expect(h.manager.listRuns().filter((run) => run.routineId === routine.id)).toHaveLength(1);

    const kept = h.manager.update(routine.id, { name: "Steady renamed" });
    expect(kept?.schedule).toMatchObject({ timing: "flexible", windowEarlyMinutes: 10, windowLateMinutes: 10 });
    expect(kept?.nominalRunAt).toBe(after.nominalRunAt);
    expect(kept?.nextRunAt).toBe(after.nextRunAt);

    const exact = h.manager.update(routine.id, {
      schedule: { type: "interval", everyMinutes: 30, anchorAt: h.now, timing: "exact" },
    });
    expect(exact?.schedule.timing).toBeUndefined();
    expect(exact?.nominalRunAt).toBeUndefined();
    expect(exact?.nextRunAt).toBe(nextOccurrence(exact!.schedule, h.now));
  });

  it("keeps flexible timing when an interval update does not mention it", () => {
    const h = harness();
    open.push(h);
    const anchorAt = h.now;
    const routine = h.manager.create({
      name: "Kept",
      prompt: "Check the list",
      botId: "b1",
      schedule: { type: "interval", everyMinutes: 30, anchorAt, timing: "flexible", windowEarlyMinutes: 10, windowLateMinutes: 5 },
    });
    const updated = h.manager.update(routine.id, { schedule: { type: "interval", everyMinutes: 20, anchorAt } });
    expect(updated?.schedule).toMatchObject({ timing: "flexible", windowEarlyMinutes: 10, windowLateMinutes: 5, everyMinutes: 20 });
    expect(updated?.nominalRunAt).toBeTypeOf("number");
  });

  it("describes a flexible daily schedule with its window", () => {
    expect(scheduleText({
      type: "daily",
      time: "09:00",
      weekdays: [1, 2, 3, 4, 5],
      timing: "flexible",
      windowEarlyMinutes: 15,
      windowLateMinutes: 0,
    }, "UTC")).toContain("around 09:00 (-15/+0 min)");
  });

  it("keeps a start around midnight and around a daylight-saving change inside the window", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const h = harness(Date.parse("2026-06-01T22:00:00Z"));
      open.push(h);
      const routine = h.manager.create({
        name: "Midnight",
        prompt: "Check the list",
        botId: "b1",
        schedule: { type: "daily", time: "00:10", weekdays: DAYS, timing: "flexible", windowEarlyMinutes: 30, windowLateMinutes: 15 },
      });
      const nominal = Date.parse("2026-06-02T00:10:00Z");
      expect(routine.nominalRunAt).toBe(nominal);
      expect(routine.nextRunAt).toBeGreaterThanOrEqual(nominal - 30 * MINUTE);
      expect(routine.nextRunAt).toBeLessThanOrEqual(nominal + 15 * MINUTE);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }

    const zone = "America/New_York";
    const saved = process.env.TZ;
    try {
      process.env.TZ = zone;
      const spring = harness(new Date(2026, 2, 7, 12, 0, 0, 0).getTime());
      open.push(spring);
      const sprung = spring.manager.create({
        name: "Spring",
        prompt: "Check the list",
        botId: "b1",
        schedule: { type: "daily", time: "02:30", weekdays: DAYS, timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 },
      });
      expect(zonedParts(sprung.nominalRunAt!, zone)).toMatchObject({ month: 3, day: 8, hour: 3, minute: 30 });
      expect(sprung.nextRunAt).toBeGreaterThanOrEqual(sprung.nominalRunAt! - 15 * MINUTE);
      expect(sprung.nextRunAt).toBeLessThanOrEqual(sprung.nominalRunAt! + 15 * MINUTE);

      const fall = harness(new Date(2026, 9, 31, 12, 0, 0, 0).getTime());
      open.push(fall);
      const fallen = fall.manager.create({
        name: "Fall",
        prompt: "Check the list",
        botId: "b1",
        schedule: { type: "daily", time: "01:30", weekdays: DAYS, timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 },
      });
      const first = zonedTimeToUtc(2026, 11, 1, 1, 30, zone);
      expect(zonedParts(fallen.nominalRunAt!, zone)).toMatchObject({ month: 11, day: 1, hour: 1, minute: 30 });
      expect(Math.abs(fallen.nextRunAt! - fallen.nominalRunAt!)).toBeLessThanOrEqual(15 * MINUTE);
      expect(Math.abs(fallen.nextRunAt! - (fallen.nominalRunAt === first ? first + 60 * MINUTE : first))).toBeGreaterThan(15 * MINUTE);
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});
