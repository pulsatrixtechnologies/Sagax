import { useCallback, useEffect, useState } from "react";

import { t } from "@/lib/i18n";
import { grantRequest, grantTier, sortGrants, type GrantDraft, type ToolGrantRow } from "@/lib/tool-grants";
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

  if (error && !rows) return <p className="text-[13px] text-danger">{error}</p>;
  if (!rows) return <p className="text-[13px] text-ink-muted">{t("settings.toolAccess.loading")}</p>;
  return (
    <div className="flex flex-col gap-3">
    <GrantForm bots={state.bots} onGranted={load} />
    {error && <p className="text-[13px] text-danger">{error}</p>}
    {!rows.length ? <p className="text-[13px] text-ink-muted">{t("settings.toolAccess.empty")}</p> : (
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
    )}
    </div>
  );
}

/** B3c: grant a bot a scope. Admin tier needs an expiry (30 days at most). */
function GrantForm({ bots, onGranted }: { bots: ReadonlyArray<{ id: string; name: string }>; onGranted: () => Promise<void> }) {
  const [draft, setDraft] = useState<GrantDraft>({ botId: "", area: "agents", tier: "write", days: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<GrantDraft>) => { setDraft((d) => ({ ...d, ...patch })); setError(""); };
  const submit = async () => {
    if (saving) return;
    const request = grantRequest(draft, Date.now());
    if (!request.ok) { setError(t(request.error)); return; }
    setSaving(true);
    try {
      await api("/api/tool-grants", { method: "POST", body: JSON.stringify(request.body) });
      setDraft((d) => ({ ...d, days: "" }));
      await onGranted();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("settings.toolAccess.error"));
    } finally {
      setSaving(false);
    }
  };
  const field = "rounded-md border border-hairline/40 bg-inset px-2 py-1 text-[12px]";
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void submit(); }} aria-label={t("settings.toolAccess.form.title")}>
      <label className="flex flex-col gap-1 text-[12px] text-ink-muted">{t("settings.toolAccess.form.bot")}
        <select className={field} value={draft.botId} onChange={(e) => set({ botId: e.target.value })}>
          <option value="">{t("settings.toolAccess.form.pickBot")}</option>
          {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-ink-muted">{t("settings.toolAccess.form.area")}
        <input className={`${field} w-[110px]`} value={draft.area} onChange={(e) => set({ area: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-ink-muted">{t("settings.toolAccess.form.tier")}
        <select className={field} value={draft.tier} onChange={(e) => set({ tier: e.target.value as GrantDraft["tier"] })}>
          <option value="read">{t("settings.toolAccess.tier.read")}</option>
          <option value="write">{t("settings.toolAccess.tier.write")}</option>
          <option value="admin">{t("settings.toolAccess.tier.admin")}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-[12px] text-ink-muted">{t("settings.toolAccess.form.days")}
        <input className={`${field} w-[70px]`} inputMode="numeric" value={draft.days} onChange={(e) => set({ days: e.target.value })} />
      </label>
      <button type="submit" disabled={saving} className="rounded-md border border-hairline/40 px-2 py-1 text-[12px]">{t("settings.toolAccess.form.grant")}</button>
      {draft.tier === "admin" && <p className="w-full text-[12px] text-danger">{t("settings.toolAccess.adminWarning")}</p>}
      {error && <p className="w-full text-[12px] text-danger">{error}</p>}
    </form>
  );
}
