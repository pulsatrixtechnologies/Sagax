// Settings > Organization > Automatic approval levels for members' bots
// (organization admin only, 2026-10-16): whether a bot a member owns runs
// its Auto ("Approve for me") and Auto-accept edits levels as such
// (server/member-auto-approval.ts). On by default. Off: those levels run as
// Ask and members cannot choose them; the first time it is turned off, the
// levels members saved go back to Ask once, and turning it on again brings
// none back.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { DescribedRow, Switch } from "../SettingsPrimitives";

/** Save the policy; the server answers with the organization's settings. */
export function saveOrgMemberAutoApproval(allowed: boolean): Promise<{ settings: { memberAutoApproval: boolean } }> {
  return api("/api/org/settings", { method: "PATCH", body: JSON.stringify({ memberAutoApproval: allowed }) });
}

export function OrgMemberAutoApprovalPolicy({ initial, onChanged }: { initial: boolean; onChanged?: () => void | Promise<void> }) {
  const [allowed, setAllowed] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !allowed;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOrgMemberAutoApproval(next);
      setAllowed(saved.settings.memberAutoApproval);
      await loadPerspicaxOrg(true);
      await onChanged?.();
    } catch (failure) {
      setError(t("organization.fullAccess.failed", { error: failure instanceof Error ? failure.message : String(failure) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-settings-card="organization.memberAutoApproval" data-org-member-auto-approval={allowed ? "on" : "off"}>
      <DescribedRow
        label={t("organization.memberAutoApproval.title")}
        rowId="memberAutoApproval"
        description={error ? <span role="alert" className="text-danger">{error}</span> : t("organization.memberAutoApproval.short")}
      >
        <Switch checked={allowed} disabled={busy} aria-label={t("organization.memberAutoApproval.label")} onClick={() => void toggle()} />
      </DescribedRow>
    </div>
  );
}
