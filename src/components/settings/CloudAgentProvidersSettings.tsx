// Settings > Models and voice, keys: per-person API keys for external cloud
// coding agents (Cursor, Claude Code, Codex). Under "More providers" until
// one is saved (src/components/EnginesSettings.tsx).
import { useCallback, useEffect, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import { readableErrorMessage } from "@/lib/readable-error";
import {
  loadCloudAgentProviders,
  removeCloudAgentProvider,
  saveCloudAgentProvider,
  testCloudAgentProvider,
  type CloudAgentProviderRow,
} from "@/lib/cloud-agent-providers";
import { Card } from "../SettingsPrimitives";

const inputClass = "w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none";

export interface CloudAgentProvidersState {
  rows: CloudAgentProviderRow[] | null;
  /** A sentence for the person, never the server's raw error. */
  error: string | null;
  refresh: () => Promise<void>;
}

/** The person's cloud agent keys, loaded once for the page. */
export function useCloudAgentProviders(): CloudAgentProvidersState {
  const [rows, setRows] = useState<CloudAgentProviderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setRows(await loadCloudAgentProviders(api));
      setError(null);
    } catch (failure) {
      // No person behind this session (the operator of a solo server with
      // no sign-in): there are no per-person keys to show, so no card.
      if ((failure as { status?: unknown } | null)?.status === 401) {
        setRows([]);
        setError(null);
        return;
      }
      // Whatever the server said, the person reads one plain sentence.
      setError(t("cloudAgentProviders.loadError"));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { rows, error, refresh };
}

export function CloudAgentProvidersSettings({ state }: { state: CloudAgentProvidersState }) {
  const { rows, error, refresh } = state;

  if (rows && rows.length === 0) return null;
  if (!rows) {
    return error
      ? <p role="alert" data-cloud-agent-providers-error className="text-[12.5px] text-danger">{error}</p>
      : <p className="text-[12.5px] text-ink-secondary">{t("cloudAgentProviders.loading")}</p>;
  }

  return (
    <Card
      collapsible
      cardId="connections.cloudAgents"
      defaultOpen={false}
      title={t("cloudAgentProviders.title")}
      subtitle={t("cloudAgentProviders.subtitle")}
      summary={rows.some((row) => row.configured) ? t("cloudAgentProviders.summary.configured") : t("cloudAgentProviders.summary.empty")}
    >
      <div className="flex flex-col gap-4" data-cloud-agent-providers>
        <p className="text-[13px] leading-relaxed text-ink-secondary">{t("cloudAgentProviders.intro")}</p>
        {rows.map((row) => (
          <ProviderRow key={row.provider} row={row} onChanged={refresh} />
        ))}
      </div>
    </Card>
  );
}

function ProviderRow({ row, onChanged }: { row: CloudAgentProviderRow; onChanged: () => Promise<void> }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState(!row.configured);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setNote(null);
    try {
      await work();
      await onChanged();
      setToken("");
      setEditing(false);
    } catch (failure) {
      setNote(readableErrorMessage(failure, t("cloudAgentProviders.actionError")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-hairline/40 bg-inset px-3 py-3" data-cloud-provider={row.provider}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-medium text-ink">{row.label}</div>
          {row.configured && !editing && (
            <p className="text-[12px] text-ink-secondary">
              {t("cloudAgentProviders.masked", { last4: row.last4 ?? "····" })}
            </p>
          )}
        </div>
        {row.configured && !editing && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md border border-hairline px-2.5 py-1 text-[12.5px] text-ink-secondary hover:text-ink"
              disabled={busy}
              onClick={() => void run(async () => { await testCloudAgentProvider(api, row.provider); setNote(t("cloudAgentProviders.test.ok")); })}
            >
              {t("cloudAgentProviders.test")}
            </button>
            <button
              type="button"
              className="rounded-md border border-hairline px-2.5 py-1 text-[12.5px] text-ink-secondary hover:text-ink"
              disabled={busy}
              onClick={() => { setEditing(true); setNote(null); }}
            >
              {t("cloudAgentProviders.replace")}
            </button>
            <button
              type="button"
              className="rounded-md border border-hairline px-2.5 py-1 text-[12.5px] text-danger"
              disabled={busy}
              onClick={() => void run(async () => { await removeCloudAgentProvider(api, row.provider); })}
            >
              {t("cloudAgentProviders.remove")}
            </button>
          </div>
        )}
      </div>
      {editing && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="password"
            autoComplete="off"
            className={inputClass}
            placeholder={t("cloudAgentProviders.tokenPlaceholder")}
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-text disabled:opacity-50"
              disabled={busy || !token.trim()}
              onClick={() => void run(async () => { await saveCloudAgentProvider(api, row.provider, token); })}
            >
              {t("cloudAgentProviders.save")}
            </button>
            <button
              type="button"
              className="rounded-md border border-hairline px-3 py-1.5 text-[12.5px] text-ink-secondary"
              disabled={busy || !token.trim()}
              onClick={() => void run(async () => { await testCloudAgentProvider(api, row.provider, token); setNote(t("cloudAgentProviders.test.ok")); })}
            >
              {t("cloudAgentProviders.test")}
            </button>
            {row.configured && (
              <button type="button" className="rounded-md px-2 py-1.5 text-[12.5px] text-ink-secondary" disabled={busy} onClick={() => { setEditing(false); setToken(""); setNote(null); }}>
                {t("common.cancel")}
              </button>
            )}
          </div>
        </div>
      )}
      {note && <p role="status" className="mt-2 text-[12px] text-ink-secondary">{note}</p>}
    </div>
  );
}
