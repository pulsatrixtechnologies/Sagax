// Settings > Usage (2026-10-14): the signed-in person's own usage. Cost then
// Plan on top (2026-10-15), one folded breakdown by bot and model, nothing about other
// people. Every figure is asked of GET /api/me/usage (2026-10-15: open to every member).
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

import { ApiError } from "@/state/store";
import { CostCard, loadPersonalUsage, PersonalUsageUnavailable, planUsageShown, UsageLayout, type PersonalUsage } from "./UsageSection";
import { PlanUsageView, renewalDate } from "./PlanUsage";

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
    for (const path of paths) expect(path).toContain("/api/me/usage?");
    expect(paths).toContain("/api/me/usage?from=2026-10-01&to=2026-10-14&groupBy=day");
    expect(paths).toContain("/api/me/usage?from=2026-09-01&to=2026-09-14&groupBy=day");
    expect(paths).toContain("/api/me/usage?from=2026-09-15&to=2026-10-14&groupBy=day");
    expect(paths).toContain("/api/me/usage?from=2026-10-01&to=2026-10-14&groupBy=bot");
    expect(paths).toContain("/api/me/usage?from=2026-10-01&to=2026-10-14&groupBy=model");
    expect(paths.some((path) => path.includes("groupBy=user"))).toBe(false);
  });

  // 2026-10-15: the desktop 0.5.4 read GET /api/me/usage from a 0.5.3 server
  // (GOX), which does not know it: the Cost card said "try again later".
  it("falls back once to GET /api/usage?mine=1 when the server does not know /api/me/usage (404)", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.startsWith("/api/me/usage")) throw new ApiError("not found", 404, { error: "not found" });
      return summary(2, 1);
    });
    const usage = await loadPersonalUsage(NOW, get as never);
    const paths = get.mock.calls.map(([path]) => path);
    expect(paths.filter((path) => path.startsWith("/api/me/usage"))).toHaveLength(1);
    const legacy = paths.filter((path) => path.startsWith("/api/usage?mine=1&"));
    expect(legacy).toHaveLength(5);
    expect(legacy).toContain("/api/usage?mine=1&from=2026-10-01&to=2026-10-14&groupBy=day");
    expect(usage.month.total.costUsd).toBe(2);
  });

  it("falls back too when a member's session meets the admin scope an older server asks of an unknown route", async () => {
    const get = vi.fn(async (path: string) => {
      if (path.startsWith("/api/me/usage")) throw new ApiError("forbidden", 403, { error: "forbidden: this session lacks the admin scope" });
      return summary(0, 0);
    });
    await loadPersonalUsage(NOW, get as never);
    expect(get.mock.calls.filter(([path]) => path.startsWith("/api/usage?mine=1&"))).toHaveLength(5);
  });

  it("says the server is too old when the fallback is refused too, and keeps other failures as failures", async () => {
    const refused = vi.fn(async (path: string) => {
      throw path.startsWith("/api/me/usage") ? new ApiError("not found", 404, { error: "not found" }) : new ApiError("forbidden", 403, { error: "usage.view" });
    });
    await expect(loadPersonalUsage(NOW, refused as never)).rejects.toBeInstanceOf(PersonalUsageUnavailable);
    expect(refused.mock.calls).toHaveLength(2);
    const broken = vi.fn(async () => { throw new ApiError("boom", 500, { error: "boom" }); });
    await expect(loadPersonalUsage(NOW, broken as never)).rejects.toMatchObject({ status: 500 });
    expect(broken.mock.calls).toHaveLength(1);
  });

  it("compares with the same days of a shorter last month", () => {
    expect(personalUsagePeriods(new Date("2026-03-31T12:00:00Z")).previous).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(usageQuery({ from: "2026-10-01", to: "2026-10-14" }, "bot")).toBe("/api/me/usage?from=2026-10-01&to=2026-10-14&groupBy=bot");
  });
});

describe("the page's order", () => {
  it("puts the Cost card on top, above the Plan card", () => {
    const html = renderToStaticMarkup(createElement(UsageLayout, {
      cost: createElement(CostCard, { usage: null, error: null }),
      plan: createElement(PlanUsageView, {
        report: { providers: [{ id: "claude", name: "Claude", driver: "claude", plan: null, ok: true, error: null, state: "no-windows" }] },
        loading: false, now: NOW.getTime(), onRefresh: () => {}, issuer: "",
      }),
      rest: createElement("div", { "data-rest": "" }),
    }));
    const cost = html.indexOf('data-settings-card="usage.cost"');
    const plan = html.indexOf('data-settings-card="usage.plan"');
    expect(cost).toBeGreaterThanOrEqual(0);
    expect(plan).toBeGreaterThan(cost);
    expect(html.indexOf("data-rest")).toBeGreaterThan(plan);
  });
});

describe("the plan card", () => {
  it("shows a member's own plan on an organization server, and the solo server's to its admins", () => {
    expect(planUsageShown({ organization: true, viewUsage: false })).toBe(true);
    expect(planUsageShown({ organization: false, viewUsage: true })).toBe(true);
    // a solo server's plan windows are an admin read
    expect(planUsageShown({ organization: false, viewUsage: false })).toBe(false);
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
    const html = renderToStaticMarkup(createElement(CostCard, { usage: usage(12, 10), error: null }));
    expect(html).toContain("data-usage-cost");
    expect(html).toContain("$12.00");
    expect(html).toContain("20% more than last month");
    expect(html).toContain("data-usage-sparkline");
    expect(html).not.toMatch(/[–—]/);
  });

  it("says honestly that an older server has no per-person cost, instead of try again later", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(CostCard, { usage: null, error: "unavailable" }));
    expect(html).toContain("data-usage-unavailable");
    expect(html).toContain("Ce serveur ne fournit pas encore le coût par personne.");
    expect(html).not.toContain("Réessayez plus tard");
    expect(renderToStaticMarkup(createElement(CostCard, { usage: null, error: "failed" }))).toContain("Réessayez plus tard");
  });

  it("says so plainly when nothing was spent, in French", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(CostCard, { usage: { ...usage(0, 0), month: summary(0, 0), days30: summary(0, 0) }, error: null }));
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

  it("reads the plan by the week: one gauge, a short line of figures, the window and renewal under it, the rest under Details", () => {
    setLocale("fr");
    const html = renderToStaticMarkup(createElement(PlanUsageView, {
      report: { providers: [provider({})] }, loading: false, now: NOW.getTime(),
      onRefresh: () => {}, issuer: "",
    }));
    expect(html).toContain('data-plan-main="weekly"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain("40\u00a0% utilisé");
    expect(html).toContain("60\u00a0% restant");
    expect(html).toMatch(/data-plan-figures[^>]*tabular-nums|tabular-nums[^>]*data-plan-figures/);
    expect(html).toContain("Semaine · se renouvelle ");
    expect(html).not.toContain("du forfait de la semaine");
    expect(html).toContain(">Détails<");
    expect(html).toContain(">Forfait<");
  });

  it("names the 5-hour session when the provider has no week, in English", () => {
    const html = renderToStaticMarkup(createElement(PlanUsageView, {
      report: { providers: [provider({ weekly: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null } })] },
      loading: false, now: NOW.getTime(), onRefresh: () => {}, issuer: "",
    }));
    expect(html).toContain('data-plan-main="fiveHour"');
    expect(html).toContain("10% used");
    expect(html).toContain("90% left");
    expect(html).toContain("5-hour session");
  });

  it("never breaks a renewal between the day and its month, or inside 19 h 59", () => {
    const fr = renewalDate("2026-10-21T23:59:00Z", "fr-CA", "America/New_York");
    expect(fr).toBe("mer.\u00a021\u00a0oct., 19\u00a0h\u00a059");
    const en = renewalDate("2026-10-21T23:59:00Z", "en", "America/New_York");
    expect(en).toMatch(/^Wed, Oct\u00a021, 7:59[\u00a0\u202f]PM$/);
    expect(renewalDate(null)).toBeNull();
  });
});
