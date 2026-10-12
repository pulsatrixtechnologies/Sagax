import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { grantTier, sortGrants, type ToolGrantRow } from "@/lib/tool-grants";
import { api, useStore } from "@/state/store";

const STATE_KEY = {
  active: "settings.toolAccess.state.active",
  expired: "settings.toolAccess.state.expired",
  revoked: "settings.toolAccess.state.revoked",
} as const;

/** Settings → Tool access (B3b): every grant behind the securable tool layer,
 * with Revoke. Admins only; the server refuses anyone else. */
export function ToolAccessSettings() {
  const { state } = useStore();
  const [rows, setRows] = useState<ToolGrantRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const nameOf = (row: ToolGrantRow) => row.subject.kind === "bot"
    ? state.bots.find((bot) => bot.id === row.subject.id)?.name ?? row.subject.id
    : row.subject.id;

  const load = useCallback(async () => {
    try {
      const body = await api<{ grants: ToolGrantRow[] }>("/api/tool-grants");
      setRows(sortGrants(body.grants));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolAccess.error"));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const revoke = async (id: string) => {
    if (busy) return;
    setBusy(id);
    try {
      await api(`/api/tool-grants/${encodeURIComponent(id)}/revoke`, { method: "POST", body: "{}" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolAccess.error"));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="text-[13px] text-danger">{error}</p>;
  if (!rows) return <p className="text-[13px] text-ink-muted">{t("settings.toolAccess.loading")}</p>;
  if (!rows.length) return <p className="text-[13px] text-ink-muted">{t("settings.toolAccess.empty")}</p>;
  return (
    <ul className="flex flex-col gap-2" aria-label={t("settings.toolAccess.title")}>
      {rows.map((row) => (
        <li key={row.id} className="flex items-center justify-between gap-3 rounded-lg border border-hairline/40 px-3 py-2">
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-ink">
              {nameOf(row)} · <code>{row.scope}</code>
            </div>
            <div className="text-[12px] text-ink-muted">
              {t(STATE_KEY[row.state])}
              {row.expiresAt && row.state === "active" ? ` · ${t("settings.toolAccess.expires", { date: new Date(row.expiresAt).toLocaleDateString() })}` : ""}
            </div>
            {grantTier(row.scope) === "admin" && row.state === "active" && (
              <div className="text-[12px] text-danger">{t("settings.toolAccess.adminWarning")}</div>
            )}
          </div>
          {row.state === "active" && (
            <button type="button" className="rounded-md border border-hairline/40 px-2 py-1 text-[12px]" disabled={busy !== null} onClick={() => void revoke(row.id)}>
              {t("settings.toolAccess.revoke")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
