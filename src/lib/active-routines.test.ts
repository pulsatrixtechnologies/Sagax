import { describe, expect, it } from "vitest";
import { activeRoutineCount, isActiveRoutine } from "./active-routines";

const routine = (over: Partial<{ botId: string; enabled: boolean; suspended: { reason: "person_out"; at: number }; nextRunAt: number | null }> = {}) => ({
  botId: "mine",
  enabled: true,
  nextRunAt: 1_000 as number | null,
  ...over,
});

describe("active routines", () => {
  it("counts a routine whose Active switch is on, not paused and with a next run", () => {
    expect(isActiveRoutine(routine())).toBe(true);
    expect(isActiveRoutine(routine({ enabled: false }))).toBe(false);
    expect(isActiveRoutine(routine({ suspended: { reason: "person_out", at: 1 } }))).toBe(false);
    // a one-time routine that already ran, or an interval past its end date
    expect(isActiveRoutine(routine({ nextRunAt: null }))).toBe(false);
  });

  it("counts only the viewer's own bots", () => {
    const bots = [{ id: "mine", ownerUserId: "ada" }, { id: "shared", ownerUserId: "bob" }, { id: "legacy" }];
    const routines = [
      routine(),
      routine({ botId: "mine", enabled: false }),
      routine({ botId: "shared" }),
      routine({ botId: "legacy" }),
      routine({ botId: "gone" }),
    ];
    expect(activeRoutineCount(routines, bots, "ada")).toBe(2);
    expect(activeRoutineCount(routines, bots, "bob")).toBe(2);
  });

  it("is zero with nothing on", () => {
    expect(activeRoutineCount([], [{ id: "mine" }], "ada")).toBe(0);
    expect(activeRoutineCount([routine({ enabled: false }), routine({ nextRunAt: null })], [{ id: "mine" }], "ada")).toBe(0);
  });
});
