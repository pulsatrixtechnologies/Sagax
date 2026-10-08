// Settings > Privacy (organization server): what other people learn about
// this person from Sagax: read receipts (server/read-receipts.ts) and
// presence, online / away / offline (src/lib/presence.ts).
import { t } from "@/lib/i18n";
import { setSendReadReceipts, useSendReadReceipts } from "@/lib/read-receipt-preference";
import { setPresenceVisible, usePresenceVisible } from "@/lib/presence";
import { SettingRow, Switch } from "./SettingsPrimitives";

export function PrivacySettings() {
  const on = useSendReadReceipts();
  // on by default; off: offline with no last-seen time for everyone else
  const visible = usePresenceVisible();
  return (
    <div className="rounded-[14px] border-[0.5px] border-border py-1">
      <SettingRow title={t("settings.privacy.readReceipts.title")} subtitle={t("settings.privacy.readReceipts.subtitle")}>
        <Switch
          checked={on}
          aria-label={t("settings.privacy.readReceipts.title")}
          onClick={() => setSendReadReceipts(!on)}
        />
      </SettingRow>
      <SettingRow title={t("settings.privacy.presence.title")} subtitle={t("settings.privacy.presence.subtitle")}>
        <Switch
          checked={visible}
          aria-label={t("settings.privacy.presence.title")}
          onClick={() => setPresenceVisible(!visible)}
        />
      </SettingRow>
    </div>
  );
}
