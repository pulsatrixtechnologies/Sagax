// Connected apps > "Provided by Claude (your account)": the claude.ai
// connectors of the caller's own Claude account (server/harness-connectors.ts).
// Read-only here: people add, sign in to and remove them on claude.ai. An
// admin can turn them off for the whole server.
import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Plug, RefreshCw } from "lucide-react";
import { api } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { openExternalLink } from "@/lib/app-links";

type ConnectorStatus = "connected" | "needs_auth" | "failed" | "unknown";
type Unavailable = "disabled" | "managed_policy" | "no_engine" | "not_signed_in" | "not_operator" | "key" | "unknown";

export interface HarnessConnectorsAnswer {
  manageUrl: string;
  canManage: boolean;
  enabled: boolean;
  claude: { available: boolean; reason?: Unavailable; connectors: Array<{ name: string; status: ConnectorStatus }> };
  codex: { available: boolean; reason?: string };
}

const STATUS_KEY: Record<ConnectorStatus, LocaleKey> = {
  connected: "harnessConnectors.status.connected",
  needs_auth: "harnessConnectors.status.needsAuth",
  failed: "harnessConnectors.status.failed",
  unknown: "harnessConnectors.status.unknown",
};

const UNAVAILABLE_KEY: Record<Unavailable, LocaleKey> = {
  disabled: "harnessConnectors.unavailable.disabled",
  managed_policy: "harnessConnectors.unavailable.managedPolicy",
  no_engine: "harnessConnectors.unavailable.noEngine",
  not_signed_in: "harnessConnectors.unavailable.notSignedIn",
  not_operator: "harnessConnectors.unavailable.notOperator",
  key: "harnessConnectors.unavailable.key",
  unknown: "harnessConnectors.unavailable.unknown",
};

/** The sentence for a person whose turns get no Claude connectors. */
export function harnessUnavailableKey(reason: Unavailable | undefined): LocaleKey {
  return UNAVAILABLE_KEY[reason ?? "unknown"] ?? UNAVAILABLE_KEY.unknown;
}

export function HarnessConnectorsSection() {
  const [answer, setAnswer] = useState<HarnessConnectorsAnswer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setAnswer(await api<HarnessConnectorsAnswer>(`/api/me/harness-connectors${refresh ? "?refresh=1" : ""}`, { timeoutMs: 90_000 }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await api("/api/harness-connectors/settings", { method: "PUT", body: JSON.stringify({ claudeAi: next }) });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const claude = answer?.claude;
  return (
    <section aria-labelledby="harness-connectors-title" className="mx-6 mb-3 rounded-xl border border-border bg-inset px-4 py-3 sm:mx-8">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id="harness-connectors-title" className="text-[13px] font-semibold text-ink">{t("harnessConnectors.title")}</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">{t("harnessConnectors.body")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void load(true)}
            disabled={loading}
            className="ui-icon-button disabled:opacity-50"
            title={t("harnessConnectors.refresh")}
            aria-label={t("harnessConnectors.refresh")}
          >
            <RefreshCw size={15} className={cn(loading && "animate-spin")} />
          </button>
          <button
            type="button"
            onClick={() => void openExternalLink(answer?.manageUrl ?? "https://claude.ai/customize/connectors")}
            className="inline-flex items-center gap-1 rounded-full bg-control px-2.5 py-1 text-[11.5px] font-medium text-ink hover:bg-raised-hover"
          >
            <ExternalLink size={12} /> {t("harnessConnectors.manage")}
          </button>
        </div>
      </div>

      {loading && !answer ? (
        <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-secondary">
          <Loader2 size={13} className="animate-spin" /> {t("harnessConnectors.loading")}
        </div>
      ) : claude && !claude.available ? (
        <p role="status" className="mt-2 text-[12px] text-ink-secondary">{t(harnessUnavailableKey(claude.reason))}</p>
      ) : claude && claude.connectors.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-secondary">{t("harnessConnectors.empty")}</p>
      ) : claude ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {claude.connectors.map((connector) => (
            <li key={connector.name} className="flex items-center justify-between gap-3 rounded-lg bg-elevated px-3 py-2">
              <span className="flex min-w-0 items-center gap-2 text-[13px] text-ink">
                <Plug size={14} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                <span className="truncate">{connector.name}</span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  connector.status === "connected" ? "bg-success/10 text-success"
                    : connector.status === "needs_auth" ? "bg-warning/10 text-warning"
                      : "bg-hover text-ink-secondary",
                )}
              >
                {t(STATUS_KEY[connector.status] ?? STATUS_KEY.unknown)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {answer && !answer.codex.available && (
        <p className="mt-2 text-[11.5px] text-ink-tertiary">{t("harnessConnectors.codex")}</p>
      )}

      {answer?.canManage && (
        <label className="mt-3 flex items-center gap-2 text-[12px] text-ink-secondary">
          <input
            type="checkbox"
            checked={answer.enabled}
            disabled={saving}
            onChange={(event) => void toggle(event.target.checked)}
          />
          {t("harnessConnectors.adminToggle")}
        </label>
      )}

      {error && <div role="alert" className="mt-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{error}</div>}
    </section>
  );
}
