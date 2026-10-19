// Parallel conversations of this bot (JC 2026-10-15, formerly Settings >
// General > Advanced for every bot): how many of its conversations work at
// once and how many parallel tasks one person may have running on it. What a
// message sent while it works does is the bot's own call (2026-10-18,
// server/busy-routing.ts), so there is no setting for it. Owner or admin
// (server/routes/bot-runtime-settings.ts).
import { t } from "@/lib/i18n";
import { BOT_THREAD_LIMITS, botParallelLimit, botThreadLimit } from "@/lib/bot-runtime-settings";
import { useStore, type Bot } from "@/state/store";
import { MAX_PARALLEL_PER_PERSON } from "../../../shared/parallel-tasks";
import { DescribedRow, HelpTip, PillSelect, SettingsGroup } from "../SettingsPrimitives";
import { useBotRuntimeSettings } from "./useBotRuntimeSettings";

export function BotParallelSettings({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const { shown, save, saving, error } = useBotRuntimeSettings(bot);
  const threads = botThreadLimit(shown, state.config);
  const perPerson = botParallelLimit(shown, state.config);
  const title = t("botPanel.parallel.title");
  // 2026-10-16 (JC): drawn like Settings: compact rows with pill menus, the
  // explanations behind the info buttons.
  return (
    <div data-bot-parallel="">
      <SettingsGroup
        title={title}
        groupId="botParallel"
        accessory={<HelpTip label={t("settings.moreAbout", { title })}>{t("botPanel.parallel.help")}</HelpTip>}
      >
        <DescribedRow label={t("botPanel.parallel.threads")} help={t("botPanel.parallel.threadsHelp")} rowId="botThreads">
          <PillSelect
            value={String(threads)}
            ariaLabel={t("botPanel.parallel.threads")}
            disabled={saving}
            onChange={(next) => { const value = Number(next); if (value !== threads) void save({ maxConcurrentThreads: value }); }}
            options={BOT_THREAD_LIMITS.map((limit) => ({ value: String(limit), label: String(limit) }))}
          />
        </DescribedRow>
        <DescribedRow label={t("botPanel.parallel.perPerson")} help={t("botPanel.parallel.perPersonHelp")} rowId="botPerPerson">
          <PillSelect
            value={String(perPerson)}
            ariaLabel={t("botPanel.parallel.perPerson")}
            disabled={saving}
            onChange={(next) => { const value = Number(next); if (value !== perPerson) void save({ maxParallelPerPerson: value }); }}
            options={Array.from({ length: MAX_PARALLEL_PER_PERSON }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
          />
        </DescribedRow>
        {saving && <p role="status" className="px-3.5 pb-2 text-[12px] text-ink-secondary">{t("settings.threads.saving")}</p>}
        {error && <p role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</p>}
      </SettingsGroup>
    </div>
  );
}
