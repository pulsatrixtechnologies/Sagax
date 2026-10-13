// Soul: the bot's standing instructions (SOUL.md). What it is lives behind
// the field's info button, so the editor is the first thing on the page.
import type { Bot } from "@/state/store";
import { SoulField } from "../SoulField";
import type { BotPatch } from "./useBotSettingsDerived";

export function SoulSection({ bot, patch }: { bot: Bot; patch: (patch: BotPatch) => void }) {
  return (
    <SoulField bot={bot} onPatch={patch} />
  );
}
