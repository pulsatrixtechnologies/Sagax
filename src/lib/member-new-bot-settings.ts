import type { ConfigStatus } from "@/state/store";
import { canEditBotField } from "./bot-capabilities";
import { PROACTIVE_MODES, type ProactiveMode } from "../../shared/proactive-mode";

/** What the quick New bot form of an organization member can offer: only
 * the settings their permissions open (`bots.approvalLevel`), judged by the
 * same rule as the full form and the server's memberBotFieldRefusal. */
export type MemberNewBotChoice = { approvalMode?: "ask" | "auto"; proactiveMode?: ProactiveMode };

export function memberNewBotFields(config: ConfigStatus | null | undefined): { approvalMode: boolean; proactiveMode: boolean } {
  const may = (field: string) => canEditBotField(config, {}, field, { draft: true });
  return { approvalMode: may("approvalMode"), proactiveMode: may("proactiveMode") };
}

/** The settings to send after creation: only what the person chose and may set. */
export function memberNewBotSettings(config: ConfigStatus | null | undefined, choice: MemberNewBotChoice): Record<string, unknown> {
  const fields = memberNewBotFields(config);
  const settings: Record<string, unknown> = {};
  if (fields.approvalMode && (choice.approvalMode === "ask" || choice.approvalMode === "auto")) settings.approvalMode = choice.approvalMode;
  if (fields.proactiveMode && choice.proactiveMode && (PROACTIVE_MODES as readonly string[]).includes(choice.proactiveMode)) {
    settings.proactiveMode = choice.proactiveMode;
  }
  return settings;
}
