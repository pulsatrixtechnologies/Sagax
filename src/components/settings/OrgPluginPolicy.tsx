// Settings > Organization > Plugins et GitHub (organization admin only):
// "Marketplaces autorisés" (where bots' Claude Code plugins may come from:
// any marketplace by default, or a list of owner/repo, owner/* or https
// addresses) and the organization's GitHub OAuth App, whose device flow
// lets each person "Connecter GitHub" (server/github-connect.ts).
import { useState } from "react";

import { t } from "@/lib/i18n";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { Card } from "../SettingsPrimitives";

type Policy = { mode: "any" } | { mode: "list"; allow: string[] };

export function OrgPluginPolicy({ marketplaces, github, onChanged }: { marketplaces: Policy; github: { clientId: string | null; fromEnvironment: boolean }; onChanged?: () => void | Promise<void> }) {
  const [mode, setMode] = useState<Policy["mode"]>(marketplaces.mode);
  const [list, setList] = useState(marketplaces.mode === "list" ? marketplaces.allow.join("\n") : "");
  const [clientId, setClientId] = useState(github.fromEnvironment ? "" : github.clientId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api("/api/org/settings", { method: "PATCH", body: JSON.stringify(body) });
      await loadPerspicaxOrg(true);
      await onChanged?.();
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card cardId="organization.plugins" title={t("organization.plugins.title")} collapsible defaultOpen={false}
      summary={mode === "any" ? t("organization.plugins.anySummary") : t("organization.plugins.listSummary")}>
      <div className="flex flex-col gap-3 text-[13px]" data-org-plugin-policy={mode}>
        <div className="flex flex-col gap-1.5">
          <span className="text-ink">{t("organization.plugins.marketplaces")}</span>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="radio" name="org-marketplaces" checked={mode === "any"} onChange={() => setMode("any")} />
            {t("organization.plugins.any")}
          </label>
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="radio" name="org-marketplaces" checked={mode === "list"} onChange={() => setMode("list")} />
            {t("organization.plugins.list")}
          </label>
          {mode === "list" && (
            <textarea value={list} onChange={(event) => setList(event.target.value)} rows={3} placeholder={"pulsatrixtechnologies/marketplace\ngoxtechnologies/*"}
              aria-label={t("organization.plugins.list")}
              className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 font-mono text-[12.5px] text-ink focus:border-border-strong focus:outline-none" />
          )}
          <p className="text-[12px] leading-relaxed text-ink-secondary">{t("organization.plugins.hint")}</p>
          <div>
            <button type="button" className="ui-button" disabled={busy} onClick={() => void save({
              pluginMarketplaces: mode === "any" ? { mode: "any" } : { mode: "list", allow: list.split(/[\n,]+/).map((entry) => entry.trim()).filter(Boolean) },
            })}>{t("organization.plugins.save")}</button>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-ink">{t("organization.github.title")}</span>
          <input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder={github.fromEnvironment && github.clientId ? github.clientId : "Ov23li..."}
            aria-label={t("organization.github.clientId")}
            className="w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 font-mono text-[12.5px] text-ink focus:border-border-strong focus:outline-none" />
          <p className="text-[12px] leading-relaxed text-ink-secondary">{github.fromEnvironment ? t("organization.github.fromEnvironment") : t("organization.github.hint")}</p>
          <div>
            <button type="button" className="ui-button" disabled={busy} onClick={() => void save({ githubClientId: clientId.trim() || null })}>{t("organization.plugins.save")}</button>
          </div>
        </div>
        {saved && <p role="status" className="text-[12px] text-ink-secondary">{t("organization.plugins.saved")}</p>}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}
