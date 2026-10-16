// Settings → Usage: remaining subscription allowance. This is not the token
// ledger below it — each provider reports its own 5-hour and weekly windows.
//
// One row per connected provider (server/plan-usage.ts): its windows or "No
// plan windows". Since 2026-10-15 a provider in error or not signed in is not
// shown at all (no message, no Connect here), and with no connected provider
// left the card itself is not drawn. On an organization server the card ends
// with the link to the person's keys in Perspicax.
import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { perspicaxKeysUrl, usePerspicaxOrg } from "@/lib/perspicax-org";
import { connectedPlanRows, formatResetDistance, planRows, type PlanRow, type PlanUsageReport, type PlanWindow } from "@/lib/plan-usage";
import { usageLocale } from "@/lib/usage-personal";
import { CompactRow, PILL, SettingsGroup } from "./SettingsPrimitives";

function dueResetDeadlines(report: PlanUsageReport, now: number, seen: Set<string>): string[] {
  const due: string[] = [];
  for (const provider of planRows(report)) {
    if (provider.state !== "windows") continue;
    const stamps = [
      provider.fiveHour.available ? provider.fiveHour.resetsAt : null,
      provider.weekly.available ? provider.weekly.resetsAt : null,
      ...provider.extra.map((extra) => extra.resetsAt),
      ...provider.models.flatMap((model) => model.windows.map((entry) => entry.resetsAt)),
    ];
    for (const resetsAt of stamps) {
      if (!resetsAt || seen.has(resetsAt) || due.includes(resetsAt)) continue;
      const at = Date.parse(resetsAt);
      if (Number.isFinite(at) && at <= now) due.push(resetsAt);
    }
  }
  return due;
}

function usageTone(used: number): string {
  if (used >= 90) return "bg-danger";
  if (used >= 70) return "bg-warning";
  return "bg-accent";
}

function windowLabel(label: string): string {
  if (label === "5-hour") return t("planUsage.fiveHour");
  if (label === "Weekly") return t("planUsage.weekly");
  return label;
}

function WindowRow({
  label,
  window,
  now,
  usedHeadline = false,
}: {
  label: string;
  window: PlanWindow;
  now: number;
  usedHeadline?: boolean;
}) {
  const when = window.available ? formatResetDistance(window.resetsAt, now) : null;
  const used = window.usedPercent ?? 0;
  const headline = usedHeadline
    ? window.usedPercent == null ? null : t("planUsage.used", { used: Math.round(window.usedPercent) })
    : window.remainingPercent == null ? null : t("planUsage.left", { remaining: Math.round(window.remainingPercent) });
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
      <div className="text-[12px] text-ink-secondary">{label}</div>
      {window.available && headline ? (
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-ink">
            <span className="tabular-nums">{headline}</span>
            {when && <span className="text-[12px] text-ink-secondary">{t("planUsage.resetsIn", { when })}</span>}
          </div>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-inset"
            role="meter"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(100, Math.max(0, used)))}
          >
            <div className={cn("h-full rounded-full", usageTone(used))} style={{ width: `${Math.min(100, Math.max(0, used))}%` }} />
          </div>
        </div>
      ) : (
        <div className="text-[12px] text-ink-secondary">{t("planUsage.notReported")}</div>
      )}
    </div>
  );
}

function RowWindows({ provider, now }: { provider: PlanRow; now: number }) {
  return (
    <div className="flex flex-col gap-2">
      <WindowRow label={t("planUsage.fiveHour")} window={provider.fiveHour} now={now} />
      <WindowRow label={t("planUsage.weekly")} window={provider.weekly} now={now} />
      {provider.extra.map((extra, index) => (
        <WindowRow
          key={`${extra.label}-${index}`}
          label={windowLabel(extra.label)}
          now={now}
          window={{ available: true, remainingPercent: extra.remainingPercent, usedPercent: extra.usedPercent, resetsAt: extra.resetsAt }}
        />
      ))}
      {provider.models.length > 0 && (
        <div className="mt-1 flex flex-col gap-2">
          <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-secondary">{t("planUsage.byModel")}</div>
          {provider.models.map((model) => (
            <div key={model.name} className="flex flex-col gap-1">
              <div className="truncate text-[13px] font-medium text-ink">{model.name}</div>
              {model.windows.map((entry, index) => (
                <WindowRow
                  key={`${model.name}-${entry.label}-${index}`}
                  label={windowLabel(entry.label)}
                  now={now}
                  usedHeadline
                  window={{ available: true, remainingPercent: entry.remainingPercent, usedPercent: entry.usedPercent, resetsAt: entry.resetsAt }}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface PlanUsageViewProps {
  report: PlanUsageReport | null;
  loading: boolean;
  now: number;
  onRefresh: () => void;
  /** Organization server: the Perspicax issuer, for "Manage my keys in
   * Perspicax". Empty in solo, where there is no such link. */
  issuer: string;
}

/** The window a plan is read by: the week when the provider reports one,
 * else the 5-hour window. */
export function mainWindow(provider: PlanRow): { kind: "weekly" | "fiveHour"; window: PlanWindow } | null {
  if (provider.weekly.available && provider.weekly.usedPercent != null) return { kind: "weekly", window: provider.weekly };
  if (provider.fiveHour.available && provider.fiveHour.usedPercent != null) return { kind: "fiveHour", window: provider.fiveHour };
  return null;
}

const NBSP = "\u00a0";

/** The renewal as a short date and time ("mer. 21 oct., 19 h 59", "Wed, Oct
 * 21, 7:59 PM"). Every space but the one after a comma is non-breaking, so
 * a narrow card never parts the day from its month or "19 h" from "59". */
export function renewalDate(resetsAt: string | null, locale = usageLocale(), timeZone?: string): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at)) return null;
  try {
    const parts = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone }).formatToParts(at);
    return parts.map((part) => part.type === "literal" && part.value.includes(",") ? part.value : part.value.replace(/ /g, NBSP)).join("");
  } catch {
    return null;
  }
}

/** One gauge per plan (2026-10-14); under it, since 2026-10-15, a short line
 * (used on the left, left on the right) and a smaller one naming the window
 * and its renewal. The 5-hour window, other windows and the per-model
 * detail fold under Details. */
function PlanSummary({ provider, now }: { provider: PlanRow; now: number }) {
  const main = mainWindow(provider);
  if (!main) return <RowWindows provider={provider} now={now} />;
  const used = Math.round(Math.min(100, Math.max(0, main.window.usedPercent ?? 0)));
  const renews = renewalDate(main.window.resetsAt);
  const hasDetail = (main.kind === "weekly" && provider.fiveHour.available) || provider.extra.length > 0 || provider.models.length > 0;
  return (
    <div className="flex flex-col gap-1.5" data-plan-main={main.kind}>
      <div
        className="h-1 overflow-hidden rounded-full bg-inset"
        role="meter"
        aria-label={t("usage.plan.meter", { name: provider.name })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
      >
        <div className={cn("h-full rounded-full", usageTone(used))} style={{ width: `${used}%` }} />
      </div>
      <div className="flex items-baseline justify-between gap-3 text-[13px] tabular-nums" data-plan-figures>
        <span className="text-ink">{t("planUsage.used", { used })}</span>
        <span className="text-ink-secondary">{t("planUsage.left", { remaining: 100 - used })}</span>
      </div>
      <p className="text-[12px] text-ink-secondary" data-plan-window>
        {t(main.kind === "weekly" ? "usage.plan.windowWeek" : "usage.plan.windowFiveHour")}
        {renews && <> · {t("usage.plan.renewsShort", { date: renews })}</>}
      </p>
      {hasDetail && (
        <details className="text-[12.5px]">
          <summary className="w-fit cursor-pointer rounded-md text-[12px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">{t("usage.plan.details")}</summary>
          <div className="mt-2"><RowWindows provider={provider} now={now} /></div>
        </details>
      )}
    </div>
  );
}

/** The card's body, without fetching: every state is drawn from props.
 * 2026-10-14: "Plan" on Settings > Usage, the person's own subscriptions.
 * 2026-10-15: only the connected providers; none, no card. */
export function PlanUsageView({ report, loading, now, onRefresh, issuer }: PlanUsageViewProps) {
  const rows = connectedPlanRows(report);
  if (rows.length === 0) return null;
  // 0.5.6: Grok Bot's usage meters, a grey heading outside one rounded card,
  // one block per plan (name, a 4 px gauge, its two lines).
  return (
    <div data-settings-card="usage.plan">
      <SettingsGroup
        title={t("usage.plan.title")}
        groupId="plan"
        accessory={(
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-busy={loading}
            aria-label={t("planUsage.refresh")}
            title={t("planUsage.refresh")}
            data-plan-refresh
            className="ml-auto flex size-7 items-center justify-center rounded-full text-ink-secondary hover:bg-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" data-plan-spinner /> : <RefreshCw size={13} />}
          </button>
        )}
      >
        {rows.map((provider) => (
          <div key={provider.id} data-plan-row={provider.id} className="px-3.5 py-2.5">
            <div className="mb-2 flex min-w-0 items-baseline gap-2">
              <span className="truncate text-[13px] leading-[18px] text-ink">{provider.name}</span>
              {provider.plan && <span className="truncate text-[12px] text-ink-secondary">{provider.plan}</span>}
            </div>
            {provider.state === "windows" && <PlanSummary provider={provider} now={now} />}
            {provider.state === "no-windows" && (
              <p data-plan-state="no-windows" className="text-[12px] text-ink-secondary">
                {provider.access === "api-key" ? t("planUsage.apiKeyNoWindows") : t("planUsage.noWindows")}
              </p>
            )}
          </div>
        ))}
        {issuer && (
          <CompactRow label={t("modelsVoice.keys.title")} rowId="keys">
            <a
              href={perspicaxKeysUrl(issuer)}
              target="_blank"
              rel="noreferrer noopener"
              data-plan-keys-link
              className={PILL}
            >
              {t("myEngines.manageKeys")} <ExternalLink size={12} aria-hidden="true" />
            </a>
          </CompactRow>
        )}
      </SettingsGroup>
    </div>
  );
}

export function PlanUsage() {
  const org = usePerspicaxOrg();
  const [report, setReport] = useState<PlanUsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const refreshedDeadlines = useRef(new Set<string>());

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const data = await api<PlanUsageReport>(refresh ? "/api/plan-usage?refresh=1" : "/api/plan-usage");
      setReport(data);
      setNow(Date.now());
    } catch {
      // A failed read shows nothing: the card keeps the last connected rows.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!report) return;
    const due = dueResetDeadlines(report, now, refreshedDeadlines.current);
    if (due.length === 0) return;
    for (const deadline of due) refreshedDeadlines.current.add(deadline);
    void load(true);
  }, [report, now, load]);

  return (
    <PlanUsageView
      report={report}
      loading={loading}
      now={now}
      onRefresh={() => void load(true)}
      issuer={org?.org.identity.issuer ?? ""}
    />
  );
}
