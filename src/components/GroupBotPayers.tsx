// #1137: in a group, who pays for the replies of each bot the viewer owns
// (organization server): as set on the bot, the owner, or each person
// (PUT /api/groups/:id/bot-payer). Only a bot's owner (or an admin)
// chooses it for that bot; everyone else sees nothing here.
import { useState } from "react";

import { t } from "@/lib/i18n";
import { botTurnPayer, groupBotPayerPath } from "@/lib/bot-runtime-settings";
import { viewerOwnsBot } from "@/lib/bot-capabilities";
import { viewerBotsReadOnly } from "@/lib/viewer";
import { api, useStore, type Bot, type Group } from "@/state/store";
import type { TurnPayerMode } from "../../shared/turn-payer";
import { CompactRow, HelpTip, PillSelect, SettingsGroup } from "./SettingsPrimitives";
import { payerLabel } from "./bot-settings/BotPayerSettings";

type Choice = TurnPayerMode | "bot";

/** The bots of this group whose payer the viewer may choose. */
export function groupPayerBots(group: Pick<Group, "memberIds" | "dm" | "peopleDm">, bots: readonly Bot[], owns: (bot: Bot) => boolean): Bot[] {
  if (group.dm || group.peopleDm) return [];
  return group.memberIds.flatMap((id) => {
    const bot = bots.find((candidate) => candidate.id === id);
    return bot && bot.turnPayerDefault && owns(bot) ? [bot] : [];
  });
}

export function GroupBotPayers({ group }: { group: Group }) {
  const { state } = useStore();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [local, setLocal] = useState<Record<string, Choice>>({});
  if (viewerBotsReadOnly(state.config)) return null;
  const bots = groupPayerBots(group, state.bots, (bot) => viewerOwnsBot(state.config, bot));
  if (!bots.length) return null;
  const choose = async (bot: Bot, next: Choice) => {
    if (saving) return;
    setSaving(bot.id);
    setError("");
    try {
      await api(groupBotPayerPath(group.id), { method: "PUT", body: JSON.stringify({ botId: bot.id, turnPayer: next === "bot" ? null : next }) });
      setLocal((current) => ({ ...current, [bot.id]: next }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("botPayer.error"));
    } finally {
      setSaving(null);
    }
  };
  const title = t("botPayer.title");
  return (
    <div data-group-bot-payers="">
      <SettingsGroup
        title={title}
        groupId="groupBotPayers"
        accessory={<HelpTip label={t("settings.moreAbout", { title })}>{t("botPayer.groupHelp")}</HelpTip>}
      >
        {bots.map((bot) => {
          const value: Choice = local[bot.id] ?? group.botPayers?.[bot.id] ?? "bot";
          const own = botTurnPayer(bot) ?? "speaker";
          const label = t("botPayer.groupRow", { bot: bot.name });
          return (
            <CompactRow key={bot.id} label={label} rowId={`groupBotPayer-${bot.id}`}>
              <PillSelect<Choice>
                value={value}
                ariaLabel={label}
                disabled={saving !== null}
                onChange={(next) => void choose(bot, next)}
                options={[
                  { value: "bot", label: t("botPayer.asOnBot", { value: payerLabel(own) }) },
                  { value: "owner", label: payerLabel("owner") },
                  { value: "speaker", label: payerLabel("speaker") },
                ]}
              />
            </CompactRow>
          );
        })}
        {error && <p role="alert" className="px-3.5 pb-2 text-[12px] text-danger">{error}</p>}
      </SettingsGroup>
    </div>
  );
}
