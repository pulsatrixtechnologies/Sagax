// Settings > Organization > Allow full access (organization admin only):
// whether bot owners may choose Full access (server/org-full-access.ts). On
// by default. Off, the menu greys Full out with a note and the server refuses
// turns asking for it; nothing stored is rewritten.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { Card, Switch } from "../SettingsPrimitives";

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

  return (
    <Card cardId="organization.fullAccess" title={t("organization.fullAccess.title")}>
      <div className="flex flex-col gap-2 text-[13px]" data-org-full-access={allowed ? "on" : "off"}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink">{t("organization.fullAccess.label")}</span>
          <Switch checked={allowed} disabled={busy} aria-label={t("organization.fullAccess.label")} onClick={() => void toggle()} />
        </div>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("organization.fullAccess.text")}</p>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}
