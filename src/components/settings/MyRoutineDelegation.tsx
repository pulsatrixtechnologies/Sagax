// Settings > Organization > Routines in my name, on a server signed in with
// Perspicax (slice 6): whether my routines may act in my name while I am
// away, how many of them are paused for lack of it, and the buttons to
// allow (a consent at Perspicax) or revoke it. The outcome of a consent
// comes back on the address and is shown here once.
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import {
  consumePendingRoutineDelegationReturn,
  loadRoutineDelegation,
  revokeRoutineDelegation,
  routineDelegationReturnText,
  startRoutineDelegation,
  type RoutineDelegationReturn,
  type RoutineDelegationStatus,
} from "@/lib/routine-delegation";
import { Card } from "../SettingsPrimitives";

function formatDate(ms: number | undefined): string {
  if (ms === undefined) return "";
  return new Intl.DateTimeFormat(activeLocale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

export function MyRoutineDelegation({
  initial = null,
  go,
  confirm = (text: string) => window.confirm(text),
}: {
  initial?: RoutineDelegationStatus | null;
  /** Where the browser goes to consent (tests pass a recorder). */
  go?: (url: string) => void;
  confirm?: (text: string) => boolean;
}) {
  const [status, setStatus] = useState<RoutineDelegationStatus | null>(initial);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RoutineDelegationReturn | null>(() => consumePendingRoutineDelegationReturn());
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setStatus(await loadRoutineDelegation());
    } catch {
      setStatus({ state: "none", suspended: 0 });
    }
  };
  useEffect(() => { if (!initial) void load(); }, []);

  const allow = async () => {
    setBusy(true);
    setError("");
    setOutcome(null);
    try {
      await startRoutineDelegation(go);
    } catch {
      setError(t("org.routineDelegation.error.generic", { code: "unavailable" }));
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!confirm(t("org.routineDelegation.revoke.confirm"))) return;
    setBusy(true);
    setError("");
    setOutcome(null);
    try {
      await revokeRoutineDelegation();
    } catch {
      setError(t("org.routineDelegation.error.generic", { code: "revoke" }));
    } finally {
      setBusy(false);
      await load();
    }
  };

  const active = status?.state === "active";
  return (
    <Card cardId="organization.routineDelegation" title={t("org.routineDelegation.title")}>
      <div className="flex flex-col gap-3 text-[13px]" data-routine-delegation={status?.state ?? "loading"}>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("org.routineDelegation.help")}</p>
        {outcome && (
          <p role={outcome.ok ? "status" : "alert"} className={outcome.ok ? "text-ink" : "text-danger"}>{routineDelegationReturnText(outcome)}</p>
        )}
        {!status ? (
          <Loader2 size={14} aria-hidden="true" className="animate-spin text-ink-secondary" />
        ) : (
          <>
            <p role="status" className={active ? "text-ink" : "text-warning"}>
              {active
                ? t("org.routineDelegation.active", { date: formatDate(status.consentedAt), renewed: formatDate(status.renewedAt) })
                : t("org.routineDelegation.none")}
            </p>
            {status.suspended > 0 && (
              <p className="text-[12px] text-warning">{t("org.routineDelegation.suspended", { count: status.suspended })}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {active ? (
                <button type="button" className="ui-button min-h-[44px] text-danger md:min-h-0" disabled={busy} onClick={() => void revoke()}>
                  {t("org.routineDelegation.revoke")}
                </button>
              ) : (
                <button type="button" className="ui-button min-h-[44px] md:min-h-0" disabled={busy} onClick={() => void allow()}>
                  {t("org.routineDelegation.allow")}
                </button>
              )}
            </div>
          </>
        )}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}
