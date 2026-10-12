// Settings > Connections: per-person API keys for external cloud coding agents.
import { useCallback, useEffect, useState } from "react";

import { api } from "@/state/store";
import { t } from "@/lib/i18n";
import {
  loadCloudAgentProviders,
  removeCloudAgentProvider,
  saveCloudAgentProvider,
  testCloudAgentProvider,
  type CloudAgentProviderRow,
} from "@/lib/cloud-agent-providers";
import { Card } from "../SettingsPrimitives";

const inputClass = "w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none";
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function CloudAgentProvidersSettings() {
  const [rows, setRows] = useState<CloudAgentProviderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setRows(await loadCloudAgentProviders(api));
      setError(null);
    } catch (failure) {
      setError(message(failure));
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  if (!rows) {
    return error
      ? <p role="alert" className="text-[12.5px] text-danger">{error}</p>
      : <p className="text-[12.5px] text-ink-secondary">{t("cloudAgentProviders.loading")}</p>;
  }

  return (
    <Card
      collapsible
      cardId="connections.cloudAgents"
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
      setNote(message(failure));
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
