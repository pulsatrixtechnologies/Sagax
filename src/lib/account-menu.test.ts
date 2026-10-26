import { describe, expect, it } from "vitest";

import { accountChoices, businessAccount, CURRENT_ACCOUNT_ID, SAGAX_MOBILE_URL, switchTargets, usageLines, usagePercent } from "./account-menu";
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
      activeId: "acme",
      environments: [
        { id: "acme", kind: "remote", name: "Acme", org: true },
        { id: "local", kind: "local", name: "" },
        { id: "lab", kind: "remote", name: "Lab", org: false },
        { id: "gone", kind: "remote", name: "Gone", org: true, missing: true },
      ],
    }, "This computer (solo)");
    expect(targets).toEqual([
      { id: "local", name: "This computer (solo)", local: true, active: false },
      { id: "acme", name: "Acme", local: false, active: true },
    ]);
  });

  it("is empty where the app has no server list", () => {
    expect(switchTargets(null, "solo")).toEqual([]);
  });
});

const saved = [
  { id: "local", name: "This computer", local: true, active: false },
  { id: "north", name: "North office", local: false, active: true },
];

describe("the avatar menu's Switch account", () => {
  it("names the locked server, and otherwise the organization", () => {
    expect(businessAccount({ active: true, id: "north", name: " North office " }, "Other")).toEqual({
      id: "north", name: "North office", local: false,
    });
    expect(businessAccount({ active: false }, " North office ")).toEqual({
      id: CURRENT_ACCOUNT_ID, name: "North office", local: false,
    });
    expect(businessAccount(null, "  ")).toBeNull();
    expect(businessAccount({ active: true, id: " ", name: " " }, null)).toBeNull();
  });

  it("checks the account in use and keeps a saved personal account switchable", () => {
    expect(accountChoices(saved, { id: "north", name: "North office" })).toEqual([
      { id: "local", name: "This computer", local: true, active: false, switchable: true },
      { id: "north", name: "North office", local: false, active: true, switchable: true },
    ]);
  });

  it("still lists the current account when it is the only one", () => {
    expect(accountChoices([], { id: CURRENT_ACCOUNT_ID, name: "North office" })).toEqual([
      { id: CURRENT_ACCOUNT_ID, name: "North office", local: false, active: true, switchable: false },
    ]);
  });

  it("adds a current account the saved list does not name, and does not duplicate one it does", () => {
    expect(accountChoices(saved, { id: "east", name: "East office" })).toEqual([
      { id: "local", name: "This computer", local: true, active: false, switchable: true },
      { id: "north", name: "North office", local: false, active: false, switchable: true },
      { id: "east", name: "East office", local: false, active: true, switchable: false },
    ]);
    expect(accountChoices(saved, { id: CURRENT_ACCOUNT_ID, name: "north office" }).map((entry) => [entry.id, entry.active])).toEqual([
      ["local", false], ["north", true],
    ]);
    expect(accountChoices([], null)).toEqual([]);
  });
});

describe("Get Sagax on mobile", () => {
  it("stays hidden while Sagax has no public App Store or TestFlight link", () => {
    expect(SAGAX_MOBILE_URL).toBeNull();
  });
});
