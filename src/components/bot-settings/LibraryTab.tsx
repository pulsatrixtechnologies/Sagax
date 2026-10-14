// Bot panel > Library: the bot's files only. Skills live on the Personas
// page, not here (no Files | Skills sub-tabs). The bot's Claude Code plugins live in Connect apps, in
// that bot's scope (no link here: JC 2026-10-14).
import { useStore, type Bot } from "@/state/store";
import { FilesSection } from "./FilesSection";

export const LIBRARY_VIEWS = ["files"] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

/** Opens Connect apps in this bot's install scope. */
export function openBotPlugins(dispatch: ReturnType<typeof useStore>["dispatch"], botId: string): void {
  dispatch({ type: "togglePlugins", open: true, botId });
}

export function LibraryTab({ bot }: { bot: Bot }) {
  return (
    <div className="flex flex-col gap-3 px-4 pb-6 pt-2" data-library-view="files">
      <FilesSection bot={bot} />
    </div>
  );
}
