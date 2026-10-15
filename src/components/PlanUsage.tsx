// Settings → Usage: remaining subscription allowance. This is not the token
// ledger below it — each provider reports its own 5-hour and weekly windows.
//
// One row per provider (server/plan-usage.ts): its windows, "No plan
// windows", "Not signed in" with Connect, or the real error with Try again.
// On an organization server the server reads the person's own subscription
// logins and Connect is their own engine card's (EngineConnect); in solo it
// opens Settings > Model providers.
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { api, useStore } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { openSettings } from "@/lib/settings-link";
import { reloadMyEngines, useMyEngines, usePerspicaxOrg, type MyEngine } from "@/lib/perspicax-org";
import { planRows, type PlanRow, type PlanUsageReport, type PlanWindow } from "@/lib/plan-usage";
import { usageLocale } from "@/lib/usage-personal";
import { EngineConnect } from "./EngineConnect";

function formatResetDistance(resetsAt: string | null, now: number): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at) || at <= now) return null;
  const minutes = Math.floor((at - now) / 60_000);
  if (minutes < 1) return "less than a minute";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

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
  error: string;
  now: number;
  onRefresh: () => void;
  /** Organization server: the person's own engines (GET /api/me/engines),
   * whose card carries Connect. null in solo. */
  myEngines: MyEngine[] | null;
  issuer: string;
  /** Solo: open Settings > Model providers to sign in. */
  onOpenEngines: () => void;
}

function SignedOut({ provider, myEngines, issuer, onOpenEngines, onRefresh }: { provider: PlanRow } & Pick<PlanUsageViewProps, "myEngines" | "issuer" | "onOpenEngines" | "onRefresh">) {
  const mine = myEngines?.find((engine) => engine.instanceId === provider.instanceId);
  return (
    <div data-plan-state="signed-out" className="flex flex-col gap-2">
      <p className="text-[13px] text-ink-secondary">{t("planUsage.notSignedIn")}</p>
      {mine ? (
        <EngineConnect engine={mine} issuer={issuer} onChanged={async () => { await reloadMyEngines(); onRefresh(); }} />
      ) : (
        <button
          type="button"
          data-plan-connect={provider.instanceId ?? provider.id}
          onClick={onOpenEngines}
          className="w-fit rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-ink hover:brightness-110"
        >
          {t("planUsage.connect", { name: provider.name })}
        </button>
      )}
    </div>
  );
}

/** The window a plan is read by: the week when the provider reports one,
 * else the 5-hour window. */
export function mainWindow(provider: PlanRow): { kind: "weekly" | "fiveHour"; window: PlanWindow } | null {
  if (provider.weekly.available && provider.weekly.usedPercent != null) return { kind: "weekly", window: provider.weekly };
  if (provider.fiveHour.available && provider.fiveHour.usedPercent != null) return { kind: "fiveHour", window: provider.fiveHour };
  return null;
}

function renewalDate(resetsAt: string | null): string | null {
  if (!resetsAt) return null;
  const at = Date.parse(resetsAt);
  if (!Number.isFinite(at)) return null;
  try {
    return new Intl.DateTimeFormat(usageLocale(), { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(at);
  } catch {
    return null;
  }
}

/** One gauge and one sentence per plan (2026-10-14); the 5-hour window,
 * other windows and the per-model detail fold under Details. */
function PlanSummary({ provider, now }: { provider: PlanRow; now: number }) {
  const main = mainWindow(provider);
  if (!main) return <RowWindows provider={provider} now={now} />;
  const used = Math.round(Math.min(100, Math.max(0, main.window.usedPercent ?? 0)));
  const renews = renewalDate(main.window.resetsAt);
  const hasDetail = (main.kind === "weekly" && provider.fiveHour.available) || provider.extra.length > 0 || provider.models.length > 0;
  return (
    <div className="flex flex-col gap-1.5" data-plan-main={main.kind}>
      <div
        className="h-2 overflow-hidden rounded-full bg-inset"
        role="meter"
        aria-label={t("usage.plan.meter", { name: provider.name })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used}
      >
        <div className={cn("h-full rounded-full", usageTone(used))} style={{ width: `${used}%` }} />
      </div>
      <p className="text-[13px] text-ink">
        {t(main.kind === "weekly" ? "usage.plan.weekSentence" : "usage.plan.fiveHourSentence", { used, remaining: 100 - used })}
        {renews && <> {t("usage.plan.renews", { date: renews })}</>}
      </p>
      {hasDetail && (
        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-ink-secondary hover:text-ink">{t("usage.plan.details")}</summary>
          <div className="mt-2"><RowWindows provider={provider} now={now} /></div>
        </details>
      )}
    </div>
  );
}

/** The card's body, without fetching: every state is drawn from props.
 * 2026-10-14: "Plan" on Settings > Usage, the person's own subscriptions. */
export function PlanUsageView({ report, loading, error, now, onRefresh, myEngines, issuer, onOpenEngines }: PlanUsageViewProps) {
  const rows = planRows(report);
  return (
    <section data-settings-card="usage.plan" className="rounded-[14px] border-[0.5px] border-border px-3.5 py-3">
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-medium text-ink">{t("usage.plan.title")}</h3>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-busy={loading}
          aria-label={t("planUsage.refresh")}
          title={t("planUsage.refresh")}
          data-plan-refresh
          className="ml-auto rounded-md p-1.5 text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" data-plan-spinner /> : <RefreshCw size={13} />}
        </button>
      </div>
      {loading && !report && <p role="status" className="mt-2 text-[13px] text-ink-secondary">{t("planUsage.loading")}</p>}
      {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
      {report && rows.length === 0 && (
        <p className="mt-2 text-[13px] text-ink-secondary">{t("planUsage.empty")}</p>
      )}
      {rows.length > 0 && (
        <div className="mt-2 flex flex-col gap-4">
          {rows.map((provider) => (
            <div key={provider.id} data-plan-row={provider.id} className="border-t border-hairline/30 pt-3 first:border-t-0 first:pt-0">
              <div className="mb-2 flex min-w-0 items-baseline gap-2">
                <span className="truncate text-[13px] font-medium text-ink">{provider.name}</span>
                {provider.plan && <span className="truncate text-[12px] text-ink-secondary">{provider.plan}</span>}
              </div>
              {provider.state === "windows" && <PlanSummary provider={provider} now={now} />}
              {provider.state === "no-windows" && (
                <p data-plan-state="no-windows" className="text-[13px] text-ink-secondary">
                  {provider.access === "api-key" ? t("planUsage.apiKeyNoWindows") : t("planUsage.noWindows")}
                </p>
              )}
              {provider.state === "signed-out" && (
                <SignedOut provider={provider} myEngines={myEngines} issuer={issuer} onOpenEngines={onOpenEngines} onRefresh={onRefresh} />
              )}
              {provider.state === "error" && (
                <div data-plan-state="error" className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="text-[13px] text-danger">{provider.message}</p>
                  <button
                    type="button"
                    onClick={onRefresh}
                    disabled={loading}
                    className="rounded-md px-2 py-0.5 text-[12px] text-ink-secondary hover:bg-control hover:text-ink disabled:opacity-50"
                  >
                    {t("planUsage.tryAgain")}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function PlanUsage() {
  const { dispatch } = useStore();
  const org = usePerspicaxOrg();
  const myEngines = useMyEngines();
  const [report, setReport] = useState<PlanUsageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const refreshedDeadlines = useRef(new Set<string>());

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError("");
    try {
      const data = await api<PlanUsageReport>(refresh ? "/api/plan-usage?refresh=1" : "/api/plan-usage");
      setReport(data);
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : t("planUsage.fetchError"));
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
      error={error}
      now={now}
      onRefresh={() => void load(true)}
      myEngines={org ? myEngines : null}
      issuer={org?.org.identity.issuer ?? ""}
      onOpenEngines={() => openSettings(dispatch, "engines", "engines.list")}
    />
  );
}
