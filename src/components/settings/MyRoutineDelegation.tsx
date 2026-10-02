// Settings > Organization > Routines in my name, on a server signed in with
// Perspicax (slice 6): whether my routines may act in my name while I am
// away, and how many of them are paused for lack of it. Read-only since
// 2026-10-01: the delegation is allowed by default (its consent starts once
// on its own, after the first routine: src/lib/routine-delegation.ts) and
// revoked in the Perspicax console ("Gérer dans Perspicax"). The outcome of
// a consent comes back on the address and is shown here once.
import { useEffect, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import {
  consumePendingRoutineDelegationReturn,
  loadRoutineDelegation,
  routineDelegationReturnText,
  type RoutineDelegationReturn,
  type RoutineDelegationStatus,
} from "@/lib/routine-delegation";
import { Card } from "../SettingsPrimitives";

function formatDate(ms: number | undefined): string {
  if (ms === undefined) return "";
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

export function MyRoutineDelegation({ initial = null, issuer }: {
  initial?: RoutineDelegationStatus | null;
  /** The Perspicax issuer: the console's address when the server names no
   * page of its own. */
  issuer?: string;
}) {
  const [status, setStatus] = useState<RoutineDelegationStatus | null>(initial);
  const [outcome] = useState<RoutineDelegationReturn | null>(() => consumePendingRoutineDelegationReturn());

  useEffect(() => {
    if (initial) return;
    let alive = true;
    void loadRoutineDelegation().then(
      (next) => { if (alive) setStatus(next); },
      () => { if (alive) setStatus({ state: "none", suspended: 0 }); },
    );
    return () => { alive = false; };
  }, []);

  const active = status?.state === "active";
  const manageUrl = status?.manageUrl ?? (issuer ? `${issuer.replace(/\/+$/, "")}/console/` : null);
  return (
    <Card cardId="organization.routineDelegation" title={t("org.routineDelegation.title")}>
      <div className="flex flex-col gap-3 text-[13px]" data-routine-delegation={status?.state ?? "loading"}>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("org.routineDelegation.helpDefault")}</p>
        {outcome && (
          <p role={outcome.ok ? "status" : "alert"} className={outcome.ok ? "text-ink" : "text-danger"}>{routineDelegationReturnText(outcome)}</p>
        )}
        {!status ? (
          <Loader2 size={14} aria-hidden="true" className="animate-spin text-ink-secondary" />
        ) : (
          <>
            <p role="status" className="text-ink">
              {active
                ? t("org.routineDelegation.active", { date: formatDate(status.consentedAt), renewed: formatDate(status.renewedAt) })
                : t("org.routineDelegation.pending")}
            </p>
            {status.suspended > 0 && (
              <p className="text-[12px] text-warning">{t("org.routineDelegation.suspended", { count: status.suspended })}</p>
            )}
          </>
        )}
        {manageUrl && (
          <a href={manageUrl} target="_blank" rel="noreferrer noopener" className="ui-button flex w-fit items-center gap-1.5" data-routine-delegation-manage>
            <ExternalLink size={13} aria-hidden="true" />
            {t("org.routineDelegation.manage")}
          </a>
        )}
      </div>
    </Card>
  );
}
