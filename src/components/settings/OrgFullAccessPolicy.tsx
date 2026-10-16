// Settings > Organization > Allow full access (organization admin only):
// whether bot owners may choose Full access (server/org-full-access.ts). On
// by default. Off, the menu greys Full out with a note and the server refuses
// turns asking for it; nothing stored is rewritten.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { DescribedRow, Switch } from "../SettingsPrimitives";

/** Save the policy; the server answers with the organization's settings. */
export function saveOrgFullAccess(allowed: boolean): Promise<{ settings: { allowFullAccess: boolean } }> {
  return api("/api/org/settings", { method: "PATCH", body: JSON.stringify({ allowFullAccess: allowed }) });
}

export function OrgFullAccessPolicy({ initial, onChanged }: { initial: boolean; onChanged?: () => void | Promise<void> }) {
  const [allowed, setAllowed] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !allowed;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOrgFullAccess(next);
      setAllowed(saved.settings.allowFullAccess);
      // Every menu reads the policy from /api/org: ask again.
      await loadPerspicaxOrg(true);
      await onChanged?.();
    } catch (failure) {
      setError(t("organization.fullAccess.failed", { error: failure instanceof Error ? failure.message : String(failure) }));
    } finally {
      setBusy(false);
    }
  };

  // 0.5.6 (JC): a Grok-style row of the organization's bots group.
  return (
    <div data-settings-card="organization.fullAccess" data-org-full-access={allowed ? "on" : "off"}>
      <DescribedRow
        label={t("organization.fullAccess.title")}
        rowId="fullAccess"
        description={error ? <span role="alert" className="text-danger">{error}</span> : t("organization.fullAccess.short")}
      >
        <Switch checked={allowed} disabled={busy} aria-label={t("organization.fullAccess.label")} onClick={() => void toggle()} />
      </DescribedRow>
    </div>
  );
}
