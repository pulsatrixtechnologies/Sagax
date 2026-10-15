// Settings > Usage (2026-10-14): the signed-in person's own usage. Plan and
// Cost on top, one folded breakdown by bot and model, nothing about other
// people. Every figure is asked of GET /api/usage?mine=1.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { costTrend, dailyCosts, formatCost, personalUsagePeriods, rankedGroups, usageQuery, type PersonalUsageSummary } from "@/lib/usage-personal";
import type { PlanProvider } from "@/lib/plan-usage";

vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  api: vi.fn(() => new Promise(() => {})),
  useStore: () => ({ state: { instances: [], bots: [], config: {} }, dispatch: () => {} }),
}));

import { CostCard, loadPersonalUsage, type PersonalUsage } from "./UsageSection";
import { PlanUsageView } from "./PlanUsage";

const NOW = new Date("2026-10-14T15:00:00Z");
const summary = (cost: number, turns: number, groups: PersonalUsageSummary["groups"] = []): PersonalUsageSummary => ({
  groups,
  total: { key: "total", label: "Total", turns, costUsd: cost },
});

beforeEach(() => {
  setLocale("en");
  vi.stubGlobal("window", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  setLocale("en");
});

describe("what Settings > Usage asks the server", () => {
  it("asks only for the person's own usage: this month, the same days last month, 30 days, by bot, by model", async () => {
    const get = vi.fn(async (_path: string) => summary(0, 0));
    await loadPersonalUsage(NOW, get as never);
    const paths = get.mock.calls.map(([path]) => path);
    expect(paths).toHaveLength(5);
    for (const path of paths) expect(path).toContain("/api/usage?mine=1&");
    expect(paths).toContain("/api/usage?mine=1&from=2026-10-01&to=2026-10-14&groupBy=day");
    expect(paths).toContain("/api/usage?mine=1&from=2026-09-01&to=2026-09-14&groupBy=day");
    expect(paths).toContain("/api/usage?mine=1&from=2026-09-15&to=2026-10-14&groupBy=day");
    expect(paths).toContain("/api/usage?mine=1&from=2026-10-01&to=2026-10-14&groupBy=bot");
    expect(paths).toContain("/api/usage?mine=1&from=2026-10-01&to=2026-10-14&groupBy=model");
    expect(paths.some((path) => path.includes("groupBy=user"))).toBe(false);
  });

  it("compares with the same days of a shorter last month", () => {
    expect(personalUsagePeriods(new Date("2026-03-31T12:00:00Z")).previous).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(usageQuery({ from: "2026-10-01", to: "2026-10-14" }, "bot")).toBe("/api/usage?mine=1&from=2026-10-01&to=2026-10-14&groupBy=bot");
  });
});

describe("cost helpers", () => {
  it("fills every day of the sparkline, oldest first", () => {
    const days = dailyCosts(summary(3, 2, [
      { key: "day:2026-10-12", label: "2026-10-12", turns: 1, costUsd: 1 },
      { key: "day:2026-10-14", label: "2026-10-14", turns: 1, costUsd: 2 },
    ]), { from: "2026-10-12", to: "2026-10-14" });
    expect(days).toEqual([1, 0, 2]);
  });

  it("says the trend against last month, or nothing when last month was empty", () => {
    expect(costTrend(12, 10)).toBe(20);
    expect(costTrend(5, 10)).toBe(-50);
    expect(costTrend(5, 0)).toBeNull();
  });

  it("ranks by cost, then turns", () => {
    const ranked = rankedGroups(summary(0, 0, [
      { key: "a", label: "A", turns: 9, costUsd: 1 },
      { key: "b", label: "B", turns: 1, costUsd: 5 },
      { key: "c", label: "C", turns: 3, costUsd: null },
    ]));
    expect(ranked.map((group) => group.key)).toEqual(["b", "a", "c"]);
  });

  it("writes money the Quebec way in French", () => {
    setLocale("fr");
    expect(formatCost(12.5).replace(/\s/g, " ")).toMatch(/^12,50 \$( US)?$/);
  });
});

describe("Cost card", () => {
  const usage = (month: number, previous: number): PersonalUsage => ({
    month: summary(month, 4),
    previous: summary(previous, 3),
    days30: summary(month, 4, [{ key: "day:2026-10-13", label: "2026-10-13", turns: 4, costUsd: month }]),
    byBot: summary(month, 4),
    byModel: summary(month, 4),
  });

  it("shows this month's cost, the trend and a 30-day sparkline", () => {
    const html = renderToStaticMarkup(createElement(CostCard, { usage: usage(12, 10), error: false }));
    expect(html).toContain("data-usage-cost");
    expect(html).toContain("$12.00");
    expect(html).toContain("20% more than last month");
    expect(html).toContain("data-usage-sparkline");
    expect(html).not.toMatch(/[–—]/);
  });

  it("says so plainly when nothing was spent, in French", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(CostCard, { usage: { ...usage(0, 0), month: summary(0, 0), days30: summary(0, 0) }, error: false }));
    expect(html).toContain("data-usage-empty");
    expect(html).toContain("Rien de dépensé pour l&#x27;instant.");
  });
});

describe("Plan card", () => {
  const provider = (patch: Partial<PlanProvider>): PlanProvider => ({
    id: "claude", name: "Claude", driver: "claude", plan: "Max", ok: true, error: null, access: "subscription", instanceId: "claude", failure: null,
    state: "windows", fiveHour: { available: true, remainingPercent: 90, usedPercent: 10, resetsAt: null },
    weekly: { available: true, remainingPercent: 60, usedPercent: 40, resetsAt: "2026-10-16T13:00:00Z" }, extra: [], models: [], ...patch,
  });

  it("reads the plan by the week: one gauge, one sentence with the renewal, the rest under Details", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(PlanUsageView, {
      report: { providers: [provider({})] }, loading: false, error: "", now: NOW.getTime(),
      onRefresh: () => {}, myEngines: null, issuer: "", onOpenEngines: () => {},
    }));
    expect(html).toContain('data-plan-main="weekly"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain("40 % du forfait de la semaine utilisé, il vous reste 60 %.");
    expect(html).toContain("Renouvellement le");
    expect(html).toContain(">Détails<");
    expect(html).toContain(">Forfait<");
  });
});
