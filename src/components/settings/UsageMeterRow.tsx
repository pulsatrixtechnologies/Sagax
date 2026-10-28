// Settings: the person's usage measure. Off until they turn it on.
// The switch is theirs, not an admin's.
import { useEffect, useState } from "react";

import { setUsageMeterEnabled, usageMeterEnabled } from "@/lib/analytics";
import { t } from "@/lib/i18n";
import { DescribedRow, Switch } from "../SettingsPrimitives";

export function UsageMeterRow() {
  const [on, setOn] = useState(usageMeterEnabled);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let gone = false;
    void fetch("/api/me/usage-meter", { headers: { accept: "application/json" } })
      .then((res) => res.ok ? res.json() as Promise<{ enabled?: unknown }> : null)
      .then((body) => { if (!gone && body) setOn(body.enabled === true); })
      .catch(() => {});
    return () => { gone = true; };
  }, []);
  return (
    <div data-settings-card="general.usage">
      <DescribedRow label={t("settings.usage.title")} rowId="usageMeter" description={t("settings.usage.help")}>
        <Switch
          checked={on}
          disabled={busy}
          aria-label={t("settings.usage.title")}
          onClick={() => {
            const next = !on;
            setBusy(true);
            void setUsageMeterEnabled(next).then((saved) => { setOn(saved); setBusy(false); });
          }}
        />
      </DescribedRow>
    </div>
  );
}
