// The bot panel's tabs. Details holds what the bot is doing (its coding
// activity), its routines and who it is (name and label are edited in place
// at the panel's top; the description stays on the bot and is edited in the
// persona editor); Library holds its files; Computer is the computer view.
// Every other section lives in the persona editor (lib/persona-sections).
import { simpleHidesPanelTab } from "@/lib/interface-visibility";

export const PANEL_TABS = ["details", "library", "computer"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

/** The tabs the panel shows. Simple hides Computer, and a bot that works
 * nowhere has no computer of its own, except while the person controls one
 * of its remote sessions (Prendre le contrôle works in every mode). */
export function visiblePanelTabs(input: { advanced: boolean; computerOff: boolean; remoteControl: boolean }): PanelTab[] {
  return PANEL_TABS.filter((id) => {
    if (id === "computer" && input.remoteControl) return true;
    return (input.advanced || !simpleHidesPanelTab(id)) && (id !== "computer" || !input.computerOff);
  });
}

/** The Computer tab shows only the remote session (no bot computer) in Simple
 * or for a bot that works nowhere. */
export function computerTabIsRemoteOnly(input: { advanced: boolean; computerOff: boolean }): boolean {
  return !input.advanced || input.computerOff;
}
