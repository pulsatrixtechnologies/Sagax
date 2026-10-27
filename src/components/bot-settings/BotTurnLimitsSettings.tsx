// A bot's per-turn anti-loop limits (#1098, 2026-10-27): how many times one
// turn may post to rooms, open threads and create rooms. The defaults stay
// 3, 5 and 4; the bot's owner changes them here without an admin
// (server/routes/bot-runtime-settings.ts, shared/turn-limits.ts).
import { t } from "@/lib/i18n";
import { type Bot } from "@/state/store";
import { botTurnLimit, TURN_LIMIT_CHOICES, TURN_LIMIT_KEYS, type TurnLimitKey } from "../../../shared/turn-limits";
import { DescribedRow, HelpTip, PillSelect, SettingsGroup } from "../SettingsPrimitives";
import { useBotRuntimeSettings } from "./useBotRuntimeSettings";

const LABEL: Record<TurnLimitKey, { label: "botPanel.turnLimits.roomPosts" | "botPanel.turnLimits.threadsOpened" | "botPanel.turnLimits.roomsCreated"; help: "botPanel.turnLimits.roomPostsHelp" | "botPanel.turnLimits.threadsOpenedHelp" | "botPanel.turnLimits.roomsCreatedHelp" }> = {
  roomPosts: { label: "botPanel.turnLimits.roomPosts", help: "botPanel.turnLimits.roomPostsHelp" },
  threadsOpened: { label: "botPanel.turnLimits.threadsOpened", help: "botPanel.turnLimits.threadsOpenedHelp" },
  roomsCreated: { label: "botPanel.turnLimits.roomsCreated", help: "botPanel.turnLimits.roomsCreatedHelp" },
};

export function BotTurnLimitsSettings({ bot }: { bot: Bot }) {
  const { shown, save, saving, error } = useBotRuntimeSettings(bot);
  const title = t("botPanel.turnLimits.title");
  return (
    <div data-bot-turn-limits="">
      <SettingsGroup
        title={title}
        groupId="botTurnLimits"
        accessory={<HelpTip label={t("settings.moreAbout", { title })}>{t("botPanel.turnLimits.help")}</HelpTip>}
      >
        {TURN_LIMIT_KEYS.map((key) => {
          const value = botTurnLimit(shown, key);
          const choices = TURN_LIMIT_CHOICES.includes(value) ? TURN_LIMIT_CHOICES : [...TURN_LIMIT_CHOICES, value].sort((a, b) => a - b);
          return (
            <DescribedRow key={key} label={t(LABEL[key].label)} help={t(LABEL[key].help)} rowId={`botTurnLimit-${key}`}>
              <PillSelect
                value={String(value)}
                ariaLabel={t(LABEL[key].label)}
                disabled={saving}
                onChange={(next) => { const limit = Number(next); if (limit !== value) void save({ turnLimits: { [key]: limit } }); }}
                options={choices.map((limit) => ({ value: String(limit), label: String(limit) }))}
              />
            </DescribedRow>
          );
        })}
        {saving && <p role="status" className="px-3.5 pb-2 text-[12px] text-ink-secondary">{t("settings.threads.saving")}</p>}
        {error && <p role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</p>}
      </SettingsGroup>
    </div>
  );
}
