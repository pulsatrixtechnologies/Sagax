// Settings > Organization > Vault export (organization admin only,
// 2026-10-18): whether people may export their credential vault in clear
// (Settings > Credentials > Export, server/routes/credential-vault.ts). On
// by default. Off: the server refuses every export (403
// `export_blocked_by_org`) and Settings > Credentials shows the Export
// button disabled with the reason. Imports are not affected.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { DescribedRow, Switch } from "../SettingsPrimitives";

/** Save the policy; the server answers with the organization's settings. */
export function saveOrgVaultExport(allowed: boolean): Promise<{ settings: { allowVaultExport?: boolean } }> {
  return api("/api/org/settings", { method: "PATCH", body: JSON.stringify({ allowVaultExport: allowed }) });
}

export function OrgVaultExportPolicy({ initial, onChanged }: { initial: boolean; onChanged?: () => void | Promise<void> }) {
  const [allowed, setAllowed] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !allowed;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOrgVaultExport(next);
      setAllowed(saved.settings.allowVaultExport !== false);
      await loadPerspicaxOrg(true);
      await onChanged?.();
    } catch (failure) {
      setError(t("organization.fullAccess.failed", { error: failure instanceof Error ? failure.message : String(failure) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-settings-card="organization.vaultExport" data-org-vault-export={allowed ? "on" : "off"}>
      <DescribedRow
        label={t("organization.vaultExport.title")}
        rowId="vaultExport"
        description={error ? <span role="alert" className="text-danger">{error}</span> : t("organization.vaultExport.short")}
      >
        <Switch checked={allowed} disabled={busy} aria-label={t("organization.vaultExport.label")} onClick={() => void toggle()} />
      </DescribedRow>
    </div>
  );
}
