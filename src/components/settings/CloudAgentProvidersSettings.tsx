// Settings > Models and voice, keys: per-person API keys for external cloud
// coding agents (Cursor, Claude Code, Codex). Under "More providers" until
// one is saved (src/components/EnginesSettings.tsx).
import { cn } from "@/lib/cn";
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
import { FoldRow, PILL } from "../SettingsPrimitives";

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
    return (
      <div className="px-3.5 py-2.5">
        {error
          ? <p role="alert" data-cloud-agent-providers-error className="text-[12.5px] text-danger">{error}</p>
          : <p className="text-[12.5px] text-ink-secondary">{t("cloudAgentProviders.loading")}</p>}
      </div>
    );
  }

  // 0.5.6: a folding row of the Keys group (Grok Bot's count pill), the
  // longer explanation behind its info button.
  return (
    <FoldRow
      cardId="connections.cloudAgents"
      label={t("cloudAgentProviders.title")}
      description={rows.some((row) => row.configured) ? t("cloudAgentProviders.summary.configured") : t("cloudAgentProviders.summary.empty")}
      help={t("cloudAgentProviders.intro")}
      count={rows.length}
    >
      <div className="flex flex-col gap-2" data-cloud-agent-providers>
        {rows.map((row) => (
          <ProviderRow key={row.provider} row={row} onChanged={refresh} />
        ))}
      </div>
    </FoldRow>
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
    <div className="rounded-lg bg-inset px-3 py-2.5" data-cloud-provider={row.provider}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] text-ink">{row.label}</div>
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
              className={PILL}
              disabled={busy}
              onClick={() => void run(async () => { await testCloudAgentProvider(api, row.provider); setNote(t("cloudAgentProviders.test.ok")); })}
            >
              {t("cloudAgentProviders.test")}
            </button>
            <button
              type="button"
              className={PILL}
              disabled={busy}
              onClick={() => { setEditing(true); setNote(null); }}
            >
              {t("cloudAgentProviders.replace")}
            </button>
            <button
              type="button"
              className={cn(PILL, "text-danger")}
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
              className="ui-button ui-button-primary min-h-[44px] disabled:opacity-50 md:min-h-0"
              disabled={busy || !token.trim()}
              onClick={() => void run(async () => { await saveCloudAgentProvider(api, row.provider, token); })}
            >
              {t("cloudAgentProviders.save")}
            </button>
            <button
              type="button"
              className={PILL}
              disabled={busy || !token.trim()}
              onClick={() => void run(async () => { await testCloudAgentProvider(api, row.provider, token); setNote(t("cloudAgentProviders.test.ok")); })}
            >
              {t("cloudAgentProviders.test")}
            </button>
            {row.configured && (
              <button type="button" className={cn(PILL, "bg-transparent text-ink-secondary")} disabled={busy} onClick={() => { setEditing(false); setToken(""); setNote(null); }}>
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
