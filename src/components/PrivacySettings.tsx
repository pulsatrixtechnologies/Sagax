// Settings > Privacy (organization server): what other people learn about
// this person from Sagax.
import { t } from "@/lib/i18n";
import { setSendReadReceipts, useSendReadReceipts } from "@/lib/read-receipt-preference";
import { SettingRow, Switch } from "./SettingsPrimitives";

export function PrivacySettings() {
  const on = useSendReadReceipts();
  return (
    <div className="rounded-[14px] border-[0.5px] border-border py-1">
      <SettingRow title={t("settings.privacy.readReceipts.title")} subtitle={t("settings.privacy.readReceipts.subtitle")}>
        <Switch
          checked={on}
          aria-label={t("settings.privacy.readReceipts.title")}
          onClick={() => setSendReadReceipts(!on)}
        />
      </SettingRow>
    </div>
  );
}
