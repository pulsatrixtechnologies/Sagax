// Settings > Organization > New threads are confidential by default
// (organization admin only, 2026-10-16): a new thread with a bot starts
// confidential (src/lib/confidential-thread.ts) unless the person picks an
// ordinary one in the New thread menu. Off by default. It changes no thread
// that exists: a confidential thread stays one, an ordinary one stays one.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { loadPerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { DescribedRow, Switch } from "../SettingsPrimitives";

/** Save the default; the server answers with the organization's settings. */
export function saveOrgConfidentialDefault(on: boolean): Promise<{ settings: { confidentialThreadsByDefault?: boolean } }> {
  return api("/api/org/settings", { method: "PATCH", body: JSON.stringify({ confidentialThreadsByDefault: on }) });
}

export function OrgConfidentialThreadsDefault({ initial, onChanged }: { initial: boolean; onChanged?: () => void | Promise<void> }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    const next = !on;
    setBusy(true);
    setError(null);
    try {
      const saved = await saveOrgConfidentialDefault(next);
      setOn(saved.settings.confidentialThreadsByDefault === true);
      await loadPerspicaxOrg(true);
      await onChanged?.();
    } catch (failure) {
      setError(t("organization.fullAccess.failed", { error: failure instanceof Error ? failure.message : String(failure) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-settings-card="organization.confidentialDefault" data-org-confidential-default={on ? "on" : "off"}>
      <DescribedRow
        label={t("organization.confidentialDefault.title")}
        rowId="confidentialDefault"
        description={error ? <span role="alert" className="text-danger">{error}</span> : t("organization.confidentialDefault.short")}
      >
        <Switch checked={on} disabled={busy} aria-label={t("organization.confidentialDefault.label")} onClick={() => void toggle()} />
      </DescribedRow>
    </div>
  );
}
