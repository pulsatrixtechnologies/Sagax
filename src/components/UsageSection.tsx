// Settings > Usage (2026-10-14, redrawn): the signed-in person's own usage.
// Two simple cards on top, Plan (their subscriptions' allowance) and Cost
// (this month, its trend against the same days of last month, a 30-day
// sparkline), then one folded breakdown by bot and by model. Every figure
// comes from GET /api/me/usage, which keeps only the requester's turns
// (server/routes/usage.ts) and is open to every member (2026-10-15). Per-person tables, organization totals, budgets
// and sell prices belong to the organization's admin console, which an
// organization admin reaches from the link at the bottom.
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { canViewUsage } from "@/lib/viewer";
import { viewerIsOrgAdmin } from "@/lib/group-owner";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import {
  costOf,
  costTrend,
  dailyCosts,
  formatCost,
  personalUsagePeriods,
  rankedGroups,
  usageQuery,
  type PersonalUsageGroup,
  type PersonalUsageSummary,
} from "@/lib/usage-personal";
import { PlanUsage } from "./PlanUsage";
import { perspicaxConsoleUrl } from "./PerspicaxOrgSettings";
import { Card } from "./SettingsPrimitives";

export interface PersonalUsage {
  month: PersonalUsageSummary;
  previous: PersonalUsageSummary;
  days30: PersonalUsageSummary;
  byBot: PersonalUsageSummary;
  byModel: PersonalUsageSummary;
}

export async function loadPersonalUsage(now = new Date(), get: <T>(path: string) => Promise<T> = api): Promise<PersonalUsage> {
  const periods = personalUsagePeriods(now);
  const [month, previous, days30, byBot, byModel] = await Promise.all([
    get<PersonalUsageSummary>(usageQuery(periods.month, "day")),
    get<PersonalUsageSummary>(usageQuery(periods.previous, "day")),
    get<PersonalUsageSummary>(usageQuery(periods.days30, "day")),
    get<PersonalUsageSummary>(usageQuery(periods.month, "bot")),
    get<PersonalUsageSummary>(usageQuery(periods.month, "model")),
  ]);
  return { month, previous, days30, byBot, byModel };
}

/** Plan windows come from GET /api/plan-usage: a person's own on an
 * organization server, an admin read on a solo server (a paired device
 * without the admin scope would only meet a 403 there). */
export function planUsageShown(input: { organization: boolean; viewUsage: boolean }): boolean {
  return input.organization || input.viewUsage;
}

/** Every member sees this page (2026-10-15): it shows their own usage only. */
export function UsageSection() {
  const { state } = useStore();
  const org = usePerspicaxOrg();
  const [usage, setUsage] = useState<PersonalUsage | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let alive = true;
    loadPersonalUsage().then((next) => { if (alive) setUsage(next); }, () => { if (alive) setError(true); });
    return () => { alive = false; };
  }, []);
  return (
    <>
      {planUsageShown({ organization: org !== null, viewUsage: canViewUsage(state.config) }) && <PlanUsage />}
      <CostCard usage={usage} error={error} />
      {usage && <BreakdownCard usage={usage} />}
      {org && viewerIsOrgAdmin(state.config) && (
        <a
          href={perspicaxConsoleUrl(org.org.identity.issuer)}
          target="_blank"
          rel="noopener noreferrer"
          data-usage-org-link
          className="inline-flex w-fit items-center gap-1 text-[12.5px] text-ink-secondary hover:text-ink hover:underline"
        >
          {t("usage.personal.manageOrg")}
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      )}
    </>
  );
}

/** A tiny line of the last 30 days' cost, oldest at the left. */
export function Sparkline({ values }: { values: number[] }) {
  const width = 120;
  const height = 28;
  const max = Math.max(...values, 0);
  if (values.length < 2 || max <= 0) return <span aria-hidden="true" className="block h-7 w-[120px] border-b border-hairline/50" />;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" data-usage-sparkline className="text-accent">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function CostCard({ usage, error }: { usage: PersonalUsage | null; error: boolean }) {
  const periods = personalUsagePeriods();
  const current = costOf(usage?.month);
  const trend = usage ? costTrend(current, costOf(usage.previous)) : null;
  const estimated = (usage?.month.total.estimatedUsd ?? 0) > 0;
  return (
    <section data-settings-card="usage.cost" className="rounded-[14px] border-[0.5px] border-border px-3.5 py-3">
      <h3 className="text-[13px] font-medium text-ink">{t("usage.personal.costTitle")}</h3>
      {error ? (
        <p role="alert" className="mt-2 text-[13px] text-danger">{t("usage.personal.error")}</p>
      ) : !usage ? (
        <p role="status" className="mt-2 text-[13px] text-ink-secondary">{t("planUsage.loading")}</p>
      ) : usage.month.total.turns === 0 && usage.days30.total.turns === 0 ? (
        <p className="mt-2 text-[13px] text-ink-secondary" data-usage-empty>{t("usage.personal.empty")}</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[22px] font-semibold tabular-nums text-ink" data-usage-cost>{formatCost(current)}</div>
            <p className="text-[12.5px] text-ink-secondary">
              {t("usage.personal.thisMonth", { turns: usage.month.total.turns })}
              {trend !== null && (
                <> · <span data-usage-trend={trend} className={cn(trend > 0 ? "text-warning" : "text-success")}>
                  {t(trend > 0 ? "usage.personal.trendUp" : trend < 0 ? "usage.personal.trendDown" : "usage.personal.trendSame", { percent: Math.abs(trend) })}
                </span></>
              )}
            </p>
            {estimated && <p className="mt-0.5 text-[12px] text-ink-secondary">{t("usage.personal.estimated")}</p>}
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <Sparkline values={dailyCosts(usage.days30, periods.days30)} />
            <span className="text-[11.5px] text-ink-secondary">{t("usage.personal.last30")}</span>
          </div>
        </div>
      )}
    </section>
  );
}

const TOP = 5;

function GroupList({ title, groups, kind }: { title: string; groups: PersonalUsageGroup[]; kind: "bot" | "model" }) {
  const [all, setAll] = useState(false);
  const shown = all ? groups : groups.slice(0, TOP);
  return (
    <div data-usage-list={kind}>
      <div className="text-[12px] font-medium text-ink-secondary">{title}</div>
      {groups.length === 0 ? (
        <p className="mt-1 text-[13px] text-ink-secondary">{t("usage.personal.none")}</p>
      ) : (
        <ul className="mt-1 divide-y divide-hairline/30">
          {shown.map((group) => (
            <li key={group.key} className="flex items-center gap-3 py-1.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate text-ink" title={group.label}>{group.label}</span>
              <span className="shrink-0 tabular-nums text-ink-secondary">{t("usage.personal.turns", { turns: group.turns })}</span>
              <span className="w-20 shrink-0 text-right tabular-nums text-ink">{typeof group.costUsd === "number" ? formatCost(group.costUsd) : "·"}</span>
            </li>
          ))}
        </ul>
      )}
      {groups.length > TOP && (
        <button type="button" onClick={() => setAll((open) => !open)} className="mt-1 text-[12.5px] text-accent hover:underline">
          {all ? t("usage.personal.showLess") : t("usage.personal.showAll", { count: groups.length })}
        </button>
      )}
    </div>
  );
}

function BreakdownCard({ usage }: { usage: PersonalUsage }) {
  return (
    <Card collapsible cardId="usage.breakdown" defaultOpen={false} title={t("usage.personal.breakdown")} summary={t("usage.personal.breakdownSummary")}>
      <div className="flex flex-col gap-4">
        <GroupList kind="bot" title={t("usage.personal.byBot")} groups={rankedGroups(usage.byBot)} />
        <GroupList kind="model" title={t("usage.personal.byModel")} groups={rankedGroups(usage.byModel)} />
      </div>
    </Card>
  );
}
