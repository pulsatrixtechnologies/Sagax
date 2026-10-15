// Parallel conversations of this bot (JC 2026-10-15, formerly Settings >
// General > Advanced for every bot): how many of its conversations work at
// once, what a message sent while it works does, and how many parallel
// tasks one person may have running on it. Owner or admin
// (server/routes/bot-runtime-settings.ts).
import { t } from "@/lib/i18n";
import { BOT_THREAD_LIMITS, botParallelLimit, botThreadLimit } from "@/lib/bot-runtime-settings";
import { useStore, type Bot } from "@/state/store";
import { MAX_PARALLEL_PER_PERSON, parseBusySendPreference } from "../../../shared/parallel-tasks";
import { PaneSection } from "./PaneSection";
import { useBotRuntimeSettings } from "./useBotRuntimeSettings";

const SELECT = "mt-2 cursor-pointer rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] text-ink disabled:opacity-50";

export function BotParallelSettings({ bot }: { bot: Bot }) {
  const { state } = useStore();
  const { shown, save, saving, error } = useBotRuntimeSettings(bot);
  const threads = botThreadLimit(shown, state.config);
  const perPerson = botParallelLimit(shown, state.config);
  const ids = { threads: `bot-threads-${bot.id}`, busy: `bot-busy-send-${bot.id}`, perPerson: `bot-parallel-${bot.id}` };
  return (
    <PaneSection data-bot-parallel="" title={t("botPanel.parallel.title")} help={t("botPanel.parallel.help")}>
      <label htmlFor={ids.threads} className="block text-[13px] font-medium text-ink">{t("botPanel.parallel.threads")}</label>
      <select id={ids.threads} value={threads} disabled={saving}
        aria-describedby={`${ids.threads}-help`}
        onChange={(event) => { const value = Number(event.target.value); if (value !== threads) void save({ maxConcurrentThreads: value }); }}
        className={SELECT}>
        {BOT_THREAD_LIMITS.map((limit) => <option key={limit} value={limit}>{limit}</option>)}
      </select>
      <p id={`${ids.threads}-help`} className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("botPanel.parallel.threadsHelp")}</p>

      <label htmlFor={ids.busy} className="mt-4 block text-[13px] font-medium text-ink">{t("botPanel.parallel.busySend")}</label>
      <select id={ids.busy} value={shown.busySend ?? ""} disabled={saving}
        onChange={(event) => { if (event.target.value) void save({ busySend: parseBusySendPreference(event.target.value) }); }}
        className={SELECT}>
        {/* Absent: each person keeps their own earlier default. */}
        {!shown.busySend && <option value="">{t("botPanel.parallel.busySendPersonal")}</option>}
        <option value="ask">{t("settings.threads.busySend.ask")}</option>
        <option value="steer">{t("composer.busy.choice.steer")}</option>
        <option value="parallel">{t("composer.busy.choice.parallel")}</option>
        <option value="after">{t("composer.busy.choice.after")}</option>
      </select>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("settings.threads.busySend.help")}</p>

      <label htmlFor={ids.perPerson} className="mt-4 block text-[13px] font-medium text-ink">{t("botPanel.parallel.perPerson")}</label>
      <select id={ids.perPerson} value={perPerson} disabled={saving}
        onChange={(event) => { const value = Number(event.target.value); if (value !== perPerson) void save({ maxParallelPerPerson: value }); }}
        className={SELECT}>
        {Array.from({ length: MAX_PARALLEL_PER_PERSON }, (_, i) => i + 1).map((limit) => <option key={limit} value={limit}>{limit}</option>)}
      </select>
      <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{t("botPanel.parallel.perPersonHelp")}</p>
      {saving && <p role="status" className="mt-2 text-[12px] text-ink-secondary">{t("settings.threads.saving")}</p>}
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    </PaneSection>
  );
}
