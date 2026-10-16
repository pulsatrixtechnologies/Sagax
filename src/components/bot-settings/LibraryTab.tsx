// Bot panel > Library: the bot's files and its artifacts. Skills live on the
// Personas page, not here. The bot's Claude Code plugins live in Connect
// apps, in that bot's scope (no link here: JC 2026-10-14). Favorite
// artifacts sit in their own section on top, whichever view is up
// (docs/superpowers/specs/2026-10-16-artifacts-design.md).
import { useState } from "react";

import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useBotArtifacts, type ArtifactList } from "@/lib/artifacts";
import { FilesSection } from "./FilesSection";
import { ArtifactDialogs, ArtifactsList, ArtifactsSectionHeading, useArtifactActions } from "../artifacts/ArtifactsSection";

export const LIBRARY_VIEWS = ["files", "artifacts"] as const;
export type LibraryView = (typeof LIBRARY_VIEWS)[number];

/** Opens Connect apps in this bot's install scope. */
export function openBotPlugins(dispatch: ReturnType<typeof useStore>["dispatch"], botId: string): void {
  dispatch({ type: "togglePlugins", open: true, botId });
}

export function LibraryTab({ bot, initialView = "files" }: { bot: Bot; initialView?: LibraryView }) {
  const list = useBotArtifacts(bot.id);
  return <LibraryBody bot={bot} list={list} initialView={initialView} />;
}

/** Everything the tab shows, given the artifact list (tests render it). */
export function LibraryBody({ bot, list, initialView = "files", now }: { bot: Bot; list: ArtifactList; initialView?: LibraryView; now?: number }) {
  const [view, setView] = useState<LibraryView>(initialView);
  const [error, setError] = useState("");
  const actions = useArtifactActions(list, setError);
  const favorites = (list.artifacts ?? []).filter((artifact) => artifact.favorite);
  return (
    <div className="flex flex-col gap-3 px-4 pb-6 pt-2" data-library-view={view}>
      {favorites.length > 0 && (
        <section data-artifact-favorites="" className="flex flex-col gap-1">
          <ArtifactsSectionHeading>{t("artifacts.favorites")}</ArtifactsSectionHeading>
          <ArtifactsList list={list} favoritesOnly actions={actions} now={now} />
        </section>
      )}
      <div role="tablist" aria-label={t("botPanel.tab.library")} className="flex items-center gap-0.5 self-start rounded-lg border border-hairline-weak p-0.5">
        {LIBRARY_VIEWS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={view === id}
            data-library-choice={id}
            onClick={() => setView(id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12.5px] leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              view === id ? "bg-elevated-hover text-ink" : "text-ink-secondary hover:text-ink",
            )}
          >
            {t(id === "files" ? "artifacts.view.files" : "artifacts.view.artifacts")}
            {id === "artifacts" && list.artifacts && list.artifacts.length > 0 && <span className="ms-1.5 tabular-nums text-ink-tertiary">{list.artifacts.length}</span>}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      {view === "files" ? <FilesSection bot={bot} /> : <ArtifactsList list={list} actions={actions} now={now} />}
      <ArtifactDialogs state={actions} />
    </div>
  );
}
