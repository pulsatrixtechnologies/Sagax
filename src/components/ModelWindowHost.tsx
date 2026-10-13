// The model window opened from the sidebar's bot menu (openModelWindow): the
// same window as the composer menu's Edit… and the persona's Model tab, for
// the bot's own model (a shared bot's viewer sets their own, as in its
// settings).
import { useStore } from "@/state/store";
import { botWithViewerSettings, useViewerBotOverride, viewerLocalBotSettings } from "@/lib/viewer-bot-overrides";
import { closeModelWindow, useModelWindowRequest } from "@/lib/model-window";
import { ModelPicker } from "./ModelPicker";

export function ModelWindowHost() {
  const botId = useModelWindowRequest();
  const { state } = useStore();
  const bot = botId ? state.bots.find((candidate) => candidate.id === botId) : undefined;
  const viewerLocal = bot ? viewerLocalBotSettings(state.config, bot) : false;
  const override = useViewerBotOverride(bot?.id ?? "", viewerLocal);
  if (!bot) return null;
  const shown = viewerLocal ? botWithViewerSettings(bot, override) : bot;
  return <ModelPicker key={bot.id} bot={shown} viewerLocal={viewerLocal} windowOnly onWindowClose={closeModelWindow} />;
}
