// Voice & alerts: this bot's spoken-reply voice and its desktop/phone
// notifications. Moved verbatim from SettingsPanel.tsx (VoiceSettings
// mount ~1026, Notifications ~1028-1046).
import { t } from "@/lib/i18n";
import { requestNotificationPermission } from "@/lib/notify";
import { useStore, type Bot } from "@/state/store";
import { saveViewerBotOverride, useViewerBotOverride, viewerLocalBotSettings } from "@/lib/viewer-bot-overrides";
import { SwitchRow } from "../SettingsPrimitives";
import { PaneSection } from "./PaneSection";
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
    <div className="flex flex-col gap-5">
      {showVoice && <VoiceSettings bot={bot} onPatch={patch} />}

      <PaneSection title={t("botPanel.remote.notifications")}>
        <SwitchRow
          label={t("botPanel.voice.notifyHelp")}
          description={viewerLocal ? t("botPanel.voice.notifyForYou") : undefined}
          checked={notifications}
          onChange={() => {
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
      </PaneSection>
    </div>
  );
}
