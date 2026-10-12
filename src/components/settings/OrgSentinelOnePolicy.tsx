// Settings > Organization > SentinelOne on persistent local virtual machines
// (organization admin only). On by default. Off, first boot skips the agent.
// The site token stays on the server either way.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { Card, Switch } from "../SettingsPrimitives";

/** Save the policy; the server answers with the organization's settings. */
export function saveOrgSentinelOne(enabled: boolean): Promise<{ settings: { sentinelOneVmAgent: boolean } }> {
  return api("/api/org/settings", { method: "PATCH", body: JSON.stringify({ sentinelOneVmAgent: enabled }) });
}

export function OrgSentinelOnePolicy({ initial, onChanged }: { initial: boolean; onChanged?: () => void | Promise<void> }) {
  const [enabled, setEnabled] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !enabled;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOrgSentinelOne(next);
      setEnabled(saved.settings.sentinelOneVmAgent);
      await loadPerspicaxOrg(true);
      await onChanged?.();
    } catch (failure) {
      setError(t("organization.sentinelOne.failed", { error: failure instanceof Error ? failure.message : String(failure) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card cardId="organization.sentinelOne" title={t("organization.sentinelOne.title")}>
      <div className="flex flex-col gap-2 text-[13px]" data-org-sentinelone={enabled ? "on" : "off"}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-ink">{t("organization.sentinelOne.label")}</span>
          <Switch checked={enabled} disabled={busy} aria-label={t("organization.sentinelOne.label")} onClick={() => void toggle()} />
        </div>
        <p className="text-[12px] leading-relaxed text-ink-secondary">{t("organization.sentinelOne.text")}</p>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}
