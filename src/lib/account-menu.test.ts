import { describe, expect, it } from "vitest";

import { SAGAX_MOBILE_URL, switchTargets, usageLines, usagePercent } from "./account-menu";
import type { PlanRow, PlanWindow } from "./plan-usage";

const closed: PlanWindow = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
const open = (used: number, resetsAt: string | null = null): PlanWindow => ({ available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt });
const row = (patch: Partial<PlanRow>): PlanRow => ({
  id: "claude", name: "Claude", driver: "claude", plan: "Max", state: "windows", access: "subscription", instanceId: null,
  message: null, fiveHour: closed, weekly: closed, extra: [], models: [], ...patch,
});
const labels = { weekly: "Weekly", fiveHour: "5-hour", used: (n: number) => `${n}% used`, resetsIn: (when: string) => `resets in ${when}` };

describe("the avatar menu's Usage", () => {
  it("shows the most used weekly window of the person's plans", () => {
    expect(usagePercent([row({ weekly: open(12.4) }), row({ id: "codex", weekly: open(87.6) })])).toBe(88);
  });

  it("falls back to the 5-hour window, and has no percent without a plan window", () => {
    expect(usagePercent([row({ fiveHour: open(30) })])).toBe(30);
    expect(usagePercent([])).toBeNull();
    expect(usagePercent([row({ state: "no-windows" })])).toBeNull();
  });

  it("lists each window with its plan and its reset", () => {
    const now = Date.parse("2026-10-16T00:00:00Z");
    const lines = usageLines([row({ weekly: open(42, "2026-10-18T03:00:00Z"), fiveHour: open(5) })], labels, now);
    expect(lines).toEqual([
      { key: "claude:weekly", label: "Claude Max · Weekly", subtitle: "resets in 2d 3h", value: "42% used" },
      { key: "claude:five-hour", label: "Claude Max · 5-hour", subtitle: undefined, value: "5% used" },
    ]);
  });
});

describe("the avatar menu's Switch organization", () => {
  it("lists this computer first, then the saved organization servers, the active one checked", () => {
    const targets = switchTargets({
      activeId: "gox",
      environments: [
        { id: "gox", kind: "remote", name: "GOX", org: true },
        { id: "local", kind: "local", name: "" },
        { id: "lab", kind: "remote", name: "Lab", org: false },
        { id: "gone", kind: "remote", name: "Gone", org: true, missing: true },
      ],
    }, "This computer (solo)");
    expect(targets).toEqual([
      { id: "local", name: "This computer (solo)", local: true, active: false },
      { id: "gox", name: "GOX", local: false, active: true },
    ]);
  });

  it("is empty where the app has no server list", () => {
    expect(switchTargets(null, "solo")).toEqual([]);
  });
});

describe("Get Sagax on mobile", () => {
  it("stays hidden while Sagax has no public App Store or TestFlight link", () => {
    expect(SAGAX_MOBILE_URL).toBeNull();
  });
});
