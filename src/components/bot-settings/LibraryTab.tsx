// Bot panel > Library: the bot's files and its skills, one at a time
// (Files | Skills). The bot's Claude Code plugins live in Connect apps, in
// that bot's scope; the link below opens it there.
import { useState } from "react";
import { Puzzle } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { FilesSection } from "./FilesSection";
import { SkillsSection } from "./SkillsSection";

export const LIBRARY_VIEWS = ["files", "skills"] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

/** Opens Connect apps in this bot's install scope. */
export function openBotPlugins(dispatch: ReturnType<typeof useStore>["dispatch"], botId: string): void {
  dispatch({ type: "togglePlugins", open: true, botId });
}

export function LibraryTab({ bot }: { bot: Bot }) {
  const { dispatch } = useStore();
  const [view, setView] = useState<LibraryView>("files");
  return (
    <div className="flex flex-col gap-3 px-4 pb-6 pt-2" data-library-view={view}>
      <div role="tablist" aria-label={t("library.views")} className="flex gap-1">
        {LIBRARY_VIEWS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            onClick={() => setView(id)}
            className={cn(
              "rounded-md px-2 py-1 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              view === id ? "bg-elevated-hover text-ink" : "text-ink-secondary hover:text-ink",
            )}
          >
            {t(`library.view.${id}`)}
          </button>
        ))}
      </div>
      {view === "files" && <FilesSection bot={bot} />}
      {view === "skills" && <SkillsSection bot={bot} />}
      <button
        type="button"
        data-library-open-plugins
        onClick={() => openBotPlugins(dispatch, bot.id)}
        className="flex items-center gap-2 self-start rounded-md px-2 py-1 text-[12.5px] text-ink-secondary hover:bg-hover hover:text-ink"
      >
        <Puzzle size={14} aria-hidden="true" />
        {t("library.openPlugins")}
      </button>
    </div>
  );
}
