import { describe, expect, it } from "vitest";

import { daysChoice, daysFromChoice, defaultSelection, maintenanceSummary, type MaintenanceView } from "./ComputerCareSettings";

const view = (over: Partial<MaintenanceView> = {}): MaintenanceView => ({
  schedule: { enabled: true, days: [0], hour: 3, windowHours: 2, timeZone: "UTC" },
  nextWindowAt: Date.UTC(2026, 9, 18, 3),
  running: false,
  ...over,
});

describe("computer care settings", () => {
  it("maps the day choice both ways", () => {
    expect(daysChoice([0, 1, 2, 3, 4, 5, 6])).toBe("daily");
    expect(daysChoice([3])).toBe("3");
    expect(daysFromChoice("daily")).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(daysFromChoice("5")).toEqual([5]);
  });

  it("never pre-selects the person's own files or empty categories", () => {
    const selection = defaultSelection({
      computerRunning: true,
      totalBytes: 30,
      items: [
        { id: "packageCaches", bytes: 10, userFiles: false },
        { id: "browserCache", bytes: 0, userFiles: false },
        { id: "trash", bytes: 20, userFiles: true },
      ],
    });
    expect([...selection]).toEqual(["packageCaches"]);
  });

  it("says when the next window is and what happened last", () => {
    expect(maintenanceSummary(view())).toMatch(/Next window/);
    expect(maintenanceSummary(view({ schedule: { ...view().schedule, enabled: false }, nextWindowAt: null }))).toMatch(/^Off/);
    expect(maintenanceSummary(view({ lastResult: { at: 1, outcome: "postponed" } }))).toMatch(/Postponed/);
    expect(maintenanceSummary(view({ lastResult: { at: 1, outcome: "failed", detail: "pull failed" } }))).toMatch(/pull failed/);
    expect(maintenanceSummary(view({ running: true }))).toMatch(/Updating now/);
  });
});
