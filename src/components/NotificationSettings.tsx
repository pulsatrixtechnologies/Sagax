// Settings > Notifications: how a new message or a nudge gets this person's
// attention on THIS computer (src/lib/attention.ts decides, the desktop
// shell does it: electron/desktop-attention.mjs). Every switch is on by
// default and kept on this computer only. Which bots may notify at all is
// each bot's own setting, on the server.
import { t } from "@/lib/i18n";
import {
  dockBadge,
  nudgeShake,
  persistentNotifications,
  setNotificationSounds,
  setNudgeSound,
  useLocalSwitch,
  useNotificationSounds,
  useNudgeSound,
} from "@/lib/notification-preferences";
import { SettingRow, Switch } from "./SettingsPrimitives";

export function NotificationSettings() {
  const sounds = useNotificationSounds();
  const persistent = useLocalSwitch(persistentNotifications);
  const badge = useLocalSwitch(dockBadge);
  const nudgeSound = useNudgeSound();
  const shake = useLocalSwitch(nudgeShake);
  return (
    <>
      <p className="text-[13px] leading-[18px] text-ink-secondary">{t("settings.notifications.subtitle")}</p>
      <div className="rounded-[14px] border-[0.5px] border-border py-1">
        <SettingRow title={t("settings.notificationSounds.title")} subtitle={t("settings.notificationSounds.short")} help={t("settings.notificationSounds.subtitle")}>
          <Switch checked={sounds} aria-label={t("settings.notificationSounds.play")} onClick={() => setNotificationSounds(!sounds)} />
        </SettingRow>
        <SettingRow
          title={t("settings.notifications.persistent.title")}
          subtitle={t("settings.notifications.persistent.short")}
          help={t("settings.notifications.persistent.help")}
        >
          <Switch checked={persistent} aria-label={t("settings.notifications.persistent.title")} onClick={() => persistentNotifications.set(!persistent)} />
        </SettingRow>
        <SettingRow title={t("settings.notifications.badge.title")} subtitle={t("settings.notifications.badge.short")}>
          <Switch checked={badge} aria-label={t("settings.notifications.badge.title")} onClick={() => dockBadge.set(!badge)} />
        </SettingRow>
        <SettingRow title={t("settings.nudgeSound.title")} subtitle={t("settings.nudgeSound.short")}>
          <Switch checked={nudgeSound} aria-label={t("settings.nudgeSound.title")} onClick={() => setNudgeSound(!nudgeSound)} />
        </SettingRow>
        <SettingRow title={t("settings.nudgeShake.title")} subtitle={t("settings.nudgeShake.short")}>
          <Switch checked={shake} aria-label={t("settings.nudgeShake.title")} onClick={() => nudgeShake.set(!shake)} />
        </SettingRow>
      </div>
    </>
  );
}
