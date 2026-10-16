// Parallel conversations of this bot (JC 2026-10-15, formerly Settings >
// General > Advanced for every bot): how many of its conversations work at
// once, what a message sent while it works does, and how many parallel
// tasks one person may have running on it. Owner or admin
// (server/routes/bot-runtime-settings.ts).
import { t } from "@/lib/i18n";
import { BOT_THREAD_LIMITS, botParallelLimit, botThreadLimit } from "@/lib/bot-runtime-settings";
import { useStore, type Bot } from "@/state/store";
import { MAX_PARALLEL_PER_PERSON, parseBusySendPreference } from "../../../shared/parallel-tasks";
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
        <DescribedRow label={t("botPanel.parallel.busySend")} help={t("settings.threads.busySend.help")} rowId="botBusySend">
          <PillSelect
            value={shown.busySend ?? ""}
            ariaLabel={t("botPanel.parallel.busySend")}
            disabled={saving}
            onChange={(next) => { if (next) void save({ busySend: parseBusySendPreference(next) }); }}
            options={[
              // Absent: each person keeps their own earlier default.
              ...(!shown.busySend ? [{ value: "", label: t("botPanel.parallel.busySendPersonal") }] : []),
              { value: "ask", label: t("settings.threads.busySend.ask") },
              { value: "steer", label: t("composer.busy.choice.steer") },
              { value: "parallel", label: t("composer.busy.choice.parallel") },
              { value: "after", label: t("composer.busy.choice.after") },
            ]}
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
