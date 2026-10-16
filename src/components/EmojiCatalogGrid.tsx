// The full emoji catalogue as a grid (src/lib/emoji-catalog.ts), shared by
// the reaction picker (Reactions.tsx) and the composer's emoji button
// (ComposerEmojiButton.tsx). With a query: the matches, en or fr words.
// Without: one category at a time, chosen by the tabs on top, so a picker
// never draws two thousand buttons at once. While the data loads (the first
// opening only), the small built-in set answers the search.
import { useEffect, useMemo, useState } from "react";

import { cn } from "@/lib/cn";
import { EMOJI_GROUPS, emojiCatalogNow, loadEmojiCatalog, searchCatalog, type CatalogEmoji } from "@/lib/emoji-catalog";
import { searchEmoji } from "@/lib/emoji-list";
import { activeLocale, t } from "@/lib/i18n";

/** The catalogue, loading it on first use; null until it is there. */
export function useEmojiCatalog(): { catalog: readonly CatalogEmoji[] | null; failed: boolean } {
  const [catalog, setCatalog] = useState<readonly CatalogEmoji[] | null>(() => emojiCatalogNow());
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (catalog) return;
    let cancelled = false;
    loadEmojiCatalog().then((data) => { if (!cancelled) setCatalog(data); }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [catalog]);
  return { catalog, failed };
}

export interface EmojiChoice { emoji: string; label: string }

/** What the grid shows for this query and tab. Pure, for tests. */
export function emojiChoices(catalog: readonly CatalogEmoji[] | null, query: string, group: number, french: boolean, exclude: ReadonlySet<string> = new Set()): EmojiChoice[] {
  if (!catalog) {
    const found = searchEmoji(query, 160);
    return (query.trim() ? found : found.filter((entry) => !exclude.has(entry.emoji))).map((entry) => ({ emoji: entry.emoji, label: entry.emoji }));
  }
  const entries = query.trim() ? searchCatalog(catalog, query) : catalog.filter((entry) => entry.group === group);
  return entries.map((entry) => ({ emoji: entry.emoji, label: french ? entry.fr : entry.en }));
}

/** The picker's state: the catalogue, the open tab and what to show. */
export function useEmojiChoices(query: string, exclude?: ReadonlySet<string>) {
  const { catalog, failed } = useEmojiCatalog();
  const [group, setGroup] = useState<number>(EMOJI_GROUPS[0].id);
  const french = activeLocale().startsWith("fr");
  const choices = useMemo(() => emojiChoices(catalog, query, group, french, exclude), [catalog, query, group, french, exclude]);
  return { catalog, failed, group, setGroup, choices, searching: Boolean(query.trim()) };
}

export function EmojiCatalogGrid({ state, onPick, mine = [], labelFor, className }: {
  state: ReturnType<typeof useEmojiChoices>;
  onPick: (emoji: string) => void;
  /** Already chosen by the viewer (a reaction they put there). */
  mine?: readonly string[];
  /** The accessible name of one button (React with 👍, Insert 👍…). */
  labelFor: (choice: EmojiChoice) => string;
  className?: string;
}) {
  const { catalog, failed, group, setGroup, choices, searching } = state;
  return (
    <div className={cn("flex min-h-0 flex-col gap-1", className)} data-emoji-catalog={catalog ? "full" : "builtin"}>
      {catalog && !searching && (
        <div role="tablist" aria-label={t("emoji.categories")} className="flex items-center justify-between">
          {EMOJI_GROUPS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={group === entry.id}
              aria-label={t(entry.key)}
              title={t(entry.key)}
              data-emoji-group={entry.id}
              onClick={() => setGroup(entry.id)}
              className={cn("flex size-7 items-center justify-center rounded-md text-[15px] leading-none hover:bg-hover", group === entry.id && "bg-accent/15")}
            >
              {entry.icon}
            </button>
          ))}
        </div>
      )}
      <div role="group" aria-label={t("reactions.results")} className="grid max-h-48 grid-cols-8 overflow-y-auto">
        {choices.map((choice) => (
          <button
            key={choice.emoji}
            type="button"
            data-emoji-result={choice.emoji}
            onClick={() => onPick(choice.emoji)}
            aria-label={labelFor(choice)}
            title={choice.label === choice.emoji ? undefined : choice.label}
            aria-pressed={mine.includes(choice.emoji) || undefined}
            className={cn(
              "flex size-8 items-center justify-center rounded-md text-[18px] leading-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-none",
              mine.includes(choice.emoji) && "bg-accent/15",
            )}
          >
            {choice.emoji}
          </button>
        ))}
      </div>
      {!catalog && !failed && !searching && <p className="px-1 text-[11.5px] text-ink-tertiary">{t("emoji.loading")}</p>}
      {choices.length === 0 && searching && <p className="px-1 pb-1 text-[12px] text-ink-tertiary">{t("reactions.none")}</p>}
    </div>
  );
}
