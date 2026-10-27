// The person's own tool access (2026-10-26, server/routes/my-tool-grants.ts):
// the grants whose subject is the person themselves, which the tool guard
// checks as the "speaker" of their bots' turns. Theirs to give and revoke
// without an admin within their own environment; the areas that reach past
// it (adminOnlyAreas) stay an admin's. An admin-tier grant ends within 30 days.
import { useCallback, useEffect, useState } from "react";

import { activeLocale, t } from "@/lib/i18n";
import { botGrantRequest, grantTier, sortGrants, type GrantDraft, type ToolGrantRow } from "@/lib/tool-grants";
import { readableErrorMessage } from "@/lib/readable-error";
import { api } from "@/state/store";
import { HelpTip, PILL, PillSelect, SettingsGroup } from "../SettingsPrimitives";

const PATH = "/api/me/tool-grants";
const STATE_KEY = {
  active: "settings.toolAccess.state.active",
  expired: "settings.toolAccess.state.expired",
  revoked: "settings.toolAccess.state.revoked",
} as const;

export function MyToolGrants() {
  const [rows, setRows] = useState<ToolGrantRow[] | null>(null);
  const [adminOnlyAreas, setAdminOnlyAreas] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Omit<GrantDraft, "botId">>({ area: "agents", tier: "write", days: "" });

  const load = useCallback(async () => {
    try {
      const body = await api<{ grants: ToolGrantRow[]; adminOnlyAreas?: string[] }>(PATH);
      setRows(sortGrants(body.grants));
      setAdminOnlyAreas(Array.isArray(body.adminOnlyAreas) ? body.adminOnlyAreas : []);
      setError("");
    } catch (cause) {
      // an older server, or nobody signed in: nothing to manage here
      setRows(null);
      setError(readableErrorMessage(cause, t("settings.toolAccess.error")));
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await work();
      await load();
    } catch (cause) {
      setError(readableErrorMessage(cause, t("settings.toolAccess.error")));
    } finally {
      setBusy(false);
    }
  };
  const grant = () => {
    const request = botGrantRequest(draft, Date.now());
    if (!request.ok) { setError(t(request.error)); return; }
    void run(async () => {
      await api(PATH, { method: "POST", body: JSON.stringify(request.body) });
      setDraft((d) => ({ ...d, days: "" }));
    });
  };
  if (!rows) return null;
  const field = "h-7 rounded-lg border-[0.5px] border-border bg-inset px-2 text-[13px] text-ink focus:border-focus focus:outline-none";
  return (
    <SettingsGroup title={t("myToolAccess.title")} groupId="myToolAccess"
      accessory={<HelpTip label={t("settings.moreAbout", { title: t("myToolAccess.title") })}>{t("myToolAccess.help")}</HelpTip>}>
      <div className="flex flex-col gap-3 px-3.5 py-3" data-my-tool-access={String(rows.length)}>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); grant(); }} aria-label={t("settings.toolAccess.form.title")}>
          <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("settings.toolAccess.form.area")}
            <input className={`${field} w-[110px]`} value={draft.area} onChange={(e) => { setDraft((d) => ({ ...d, area: e.target.value })); setError(""); }} />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("settings.toolAccess.form.tier")}
            <PillSelect<GrantDraft["tier"]>
              value={draft.tier}
              ariaLabel={t("settings.toolAccess.form.tier")}
              onChange={(tier) => { setDraft((d) => ({ ...d, tier })); setError(""); }}
              options={[
                { value: "read", label: t("settings.toolAccess.tier.read") },
                { value: "write", label: t("settings.toolAccess.tier.write") },
                { value: "admin", label: t("settings.toolAccess.tier.admin") },
              ]}
            />
          </label>
          <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">{t("settings.toolAccess.form.days")}
            <input className={`${field} w-[70px]`} inputMode="numeric" value={draft.days} onChange={(e) => { setDraft((d) => ({ ...d, days: e.target.value })); setError(""); }} />
          </label>
          <button type="submit" disabled={busy} className={PILL}>{t("settings.toolAccess.form.grant")}</button>
        </form>
        {draft.tier === "admin" && <p className="text-[12px] text-danger">{t("settings.toolAccess.adminWarning")}</p>}
        {adminOnlyAreas.length > 0 && <p className="text-[12px] text-ink-secondary">{t("botPanel.toolAccess.orgAreas", { areas: adminOnlyAreas.join(", ") })}</p>}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        {rows.length === 0 ? <p className="text-[13px] text-ink-secondary">{t("myToolAccess.empty")}</p> : (
          <ul className="flex flex-col divide-y divide-hairline/40 border-t border-hairline/40" aria-label={t("myToolAccess.title")}>
            {rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-ink"><code>{row.scope}</code></div>
                  <div className="text-[12px] text-ink-secondary">
                    {t(STATE_KEY[row.state])}
                    {row.expiresAt && row.state === "active" ? ` · ${t("settings.toolAccess.expires", { date: new Date(row.expiresAt).toLocaleDateString(activeLocale()) })}` : ""}
                  </div>
                  {grantTier(row.scope) === "admin" && row.state === "active" && <div className="text-[12px] text-danger">{t("settings.toolAccess.adminWarning")}</div>}
                </div>
                {row.state === "active" && (
                  <button type="button" className={PILL} disabled={busy} onClick={() => void run(() => api(`${PATH}/${row.id}/revoke`, { method: "POST", body: "{}" }))}>
                    {t("settings.toolAccess.revoke")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsGroup>
  );
}
