// Voice & alerts: this bot's spoken-reply voice and its desktop/phone
// notifications. Moved verbatim from SettingsPanel.tsx (VoiceSettings
// mount ~1026, Notifications ~1028-1046).
import { t } from "@/lib/i18n";
import { requestNotificationPermission } from "@/lib/notify";
import { useStore, type Bot } from "@/state/store";
import { saveViewerBotOverride, useViewerBotOverride, viewerLocalBotSettings } from "@/lib/viewer-bot-overrides";
import { Switch } from "../SettingsPrimitives";
import { VoiceSettings } from "../VoiceSettings";
import type { useBotSettingsDerived } from "./useBotSettingsDerived";
import { useBotEditor } from "./BotEditorContext";

export function VoiceSection({
  bot,
  derived,
}: {
  bot: Bot;
  derived: ReturnType<typeof useBotSettingsDerived>;
}) {
  const { patch } = derived;
  const { draft } = useBotEditor();
  const { state, dispatch } = useStore();
  // Voice, read-aloud and voice notes are not member fields, and the
  // engine key is an installation write. Notifications stay, and on a
  // shared bot they are this person's own.
  const showVoice = !derived.canEdit || derived.canEdit("voice");
  const viewerLocal = viewerLocalBotSettings(state.config, bot);
  const override = useViewerBotOverride(bot.id, viewerLocal);
  const notifications = viewerLocal && override?.notifications !== undefined ? override.notifications : bot.notifications !== false;

  return (
    <div className="flex flex-col gap-4">
      {showVoice && <VoiceSettings bot={bot} onPatch={patch} />}

      <div className="flex items-center justify-between gap-4 rounded-xl border border-hairline/40 p-4">
        <div>
          <div className="text-[13px] font-medium text-ink">{t("botPanel.remote.notifications")}</div>
          <div className="mt-0.5 text-[13px] text-ink-secondary">
            {viewerLocal ? t("botPanel.voice.notifyForYou") : t("botPanel.voice.notifyHelp")}
          </div>
        </div>
        <Switch
          checked={notifications}
          aria-label={t("botPanel.remote.notificationsAria")}
          onClick={() => {
            const enabled = !notifications;
            if (enabled && !draft) void requestNotificationPermission();
            if (viewerLocal) {
              void saveViewerBotOverride(bot.id, { notifications: enabled }).then((ok) => {
                if (!ok) dispatch({ type: "error", message: t("botPanel.viewerLocal.saveError") });
              });
              return;
            }
            patch({ notifications: enabled });
          }}
        />
      </div>
    </div>
  );
}
