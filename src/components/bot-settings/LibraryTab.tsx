// Bot panel > Library: the bot's files, its skills and its Claude Code
// plugins, one at a time (Files | Skills | Plugins).
import { useState } from "react";

import type { Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { BotPluginsCard } from "./BotPluginsCard";
import { FilesSection } from "./FilesSection";
import { SkillsSection } from "./SkillsSection";

export const LIBRARY_VIEWS = ["files", "skills", "plugins"] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

export function LibraryTab({ bot }: { bot: Bot }) {
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
      {view === "plugins" && <BotPluginsCard bot={bot} />}
    </div>
  );
}
