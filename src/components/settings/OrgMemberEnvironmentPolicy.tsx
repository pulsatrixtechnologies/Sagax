// Settings > Organization > Bots act freely in their owner's environment
// (organization admin only, 2026-10-16): whether a bot runs its owner's
// commands in the owner's own isolated environment (their server
// environment, their Local VM) without an approval card
// (server/member-environment.ts). On by default. This computer, the server
// itself and anyone else's space keep their cards either way.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { DescribedRow, Switch } from "../SettingsPrimitives";

/** Save the policy; the server answers with the organization's settings. */
export function saveOrgMemberEnvironment(allowed: boolean): Promise<{ settings: { memberEnvironmentAutonomy: boolean } }> {
  return api("/api/org/settings", { method: "PATCH", body: JSON.stringify({ memberEnvironmentAutonomy: allowed }) });
}

export function OrgMemberEnvironmentPolicy({ initial, onChanged }: { initial: boolean; onChanged?: () => void | Promise<void> }) {
  const [allowed, setAllowed] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !allowed;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOrgMemberEnvironment(next);
      setAllowed(saved.settings.memberEnvironmentAutonomy);
      await loadPerspicaxOrg(true);
      await onChanged?.();
    } catch (failure) {
      setError(t("organization.fullAccess.failed", { error: failure instanceof Error ? failure.message : String(failure) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-settings-card="organization.memberEnvironment" data-org-member-environment={allowed ? "on" : "off"}>
      <DescribedRow
        label={t("organization.memberEnvironment.title")}
        rowId="memberEnvironment"
        description={error ? <span role="alert" className="text-danger">{error}</span> : t("organization.memberEnvironment.short")}
      >
        <Switch checked={allowed} disabled={busy} aria-label={t("organization.memberEnvironment.label")} onClick={() => void toggle()} />
      </DescribedRow>
    </div>
  );
}
