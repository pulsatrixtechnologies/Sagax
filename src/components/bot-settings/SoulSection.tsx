// Soul: the bot's standing instructions (SOUL.md). What it is lives behind
// the field's info button, so the editor is the first thing on the page.
// #1329: the bot's "do not finish until" condition sits under them.
import type { Bot } from "@/state/store";
import { SoulField } from "../SoulField";
import { useBotEditor } from "./BotEditorContext";
import { FinishUntilSettings } from "./FinishUntilSettings";
import type { BotPatch } from "./useBotSettingsDerived";

export function SoulSection({ bot, patch }: { bot: Bot; patch: (patch: BotPatch) => void }) {
  const { draft } = useBotEditor();
  return (
    <div className="flex flex-col gap-4">
      <SoulField bot={bot} onPatch={patch} />
      {!draft && <FinishUntilSettings bot={bot} />}
    </div>
  );
}
