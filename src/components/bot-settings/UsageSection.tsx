// Usage: what this bot has spent across its tasks. Moved verbatim from
// SettingsPanel.tsx's BotUsageCard (~40-77); its "All bots" button keeps
// dispatching toggleAppSettings, which closes this dialog (intended, since
// the destination is the app-wide Usage settings, not a per-bot view).
//
// BotUsageCard used to render nothing at all for a bot with no turns yet,
// which was fine buried among a dozen other cards in the old aside; as this
// section's entire content it would otherwise leave the panel blank, so a
// short placeholder line is added for that case.
import { t } from "@/lib/i18n";
import { useStore, type Bot } from "@/state/store";
import { CompactRow, DescribedRow, SettingsGroup } from "../SettingsPrimitives";
import { botUsage, costCaption, formatTokens, formatUsd, hasFiniteCost, headlineTokens, tokensColumnLabel, usageDetail } from "@/lib/usage";

export function UsageSection({ bot }: { bot: Bot }) {
  const { state, dispatch } = useStore();
  const usage = botUsage(bot);
  const instance = state.instances.find((i) => i.instanceId === bot.modelSelection.instanceId);

  const allBots = (
    <button
      type="button"
      onClick={() => dispatch({ type: "toggleAppSettings", open: true, section: "usage" })}
      className="ml-auto shrink-0 text-[12.5px] text-ink-secondary hover:text-ink"
    >
      {t("botPanel.usage.allBots")}
    </button>
  );

  // 2026-10-16 (JC): drawn like Settings > Usage: a grey heading, one card
  // of rows (label at the left, figure at the right), the price note in grey.
  if (usage.turns === 0) {
    return (
      <SettingsGroup title={t("botPanel.usage.title")} groupId="botUsage">
        <p className="px-3.5 py-2.5 text-[13px] leading-[18px] text-ink-secondary">{t("botPanel.usage.empty")}</p>
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup title={t("botPanel.usage.title")} groupId="botUsage" accessory={allBots}>
      <CompactRow label={t("botPanel.usage.turns")}>
        <span className="tabular-nums text-[13px] text-ink-secondary">{usage.turns}</span>
      </CompactRow>
      <CompactRow label={tokensColumnLabel(usage)}>
        <span className="tabular-nums text-[13px] text-ink-secondary" title={usageDetail(usage)}>{formatTokens(headlineTokens(usage))}</span>
      </CompactRow>
      <DescribedRow
        label={t("botPanel.usage.cost")}
        description={hasFiniteCost(usage.costUsd)
          ? t("botPanel.usage.costCaption", { caption: costCaption(instance?.snapshot.billing) })
          : t("botPanel.usage.noPrice")}
      >
        <span className="tabular-nums text-[13px] text-ink">{hasFiniteCost(usage.costUsd) ? formatUsd(usage.costUsd) : "-"}</span>
      </DescribedRow>
    </SettingsGroup>
  );
}
