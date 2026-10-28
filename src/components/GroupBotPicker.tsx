// The bot picker of a group chat's Bots section (#1240, #1260): the same
// inline gesture as People. The caller passes only the bots this person may
// add that are not already in the room. Add puts that bot in; Done closes.
// Taking a bot out stays on the row above this picker.
import { useMemo, useState } from "react";
import { UserPlus } from "lucide-react";

import { t } from "@/lib/i18n";
import type { BotPublicProfile } from "../../shared/bot-public-profile";
import { BotAvatar } from "./Avatar";

export function matchingRosterBots(bots: readonly BotPublicProfile[], query: string): BotPublicProfile[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...bots];
  return bots.filter((bot) => bot.name.toLowerCase().includes(q) || bot.title.toLowerCase().includes(q));
}

export function GroupBotPicker({ bots, onAdd, onDone, emptyHint, showDone = true, autoFocus = true }: {
  bots: BotPublicProfile[];
  onAdd: (id: string) => void;
  onDone: () => void;
  emptyHint: string;
  /** Hidden when one Done below covers people and bots together. */
  showDone?: boolean;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => matchingRosterBots(bots, query), [bots, query]);
  return (
    <div data-group-bot-picker className="mt-2 flex flex-col gap-2">
      {bots.length > 0 && (
        <input
          type="search"
          autoFocus={autoFocus}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onDone(); } }}
          placeholder={t("room.bots.search")}
          aria-label={t("room.bots.search")}
          maxLength={200}
          className="w-full rounded-lg border border-hairline/40 bg-inset px-3 py-2 text-[13px] placeholder:text-ink-secondary focus:outline-none"
        />
      )}
      {bots.length === 0 && <p className="px-1 text-[12px] text-ink-secondary">{emptyHint}</p>}
      {bots.length > 0 && shown.length === 0 && <p className="px-1 text-[12px] text-ink-secondary">{t("room.bots.none")}</p>}
      {shown.length > 0 && (
        <ul className="flex flex-col divide-y divide-hairline/40 overflow-hidden rounded-xl bg-card">
          {shown.map((bot) => (
            <li key={bot.id} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2">
              <BotAvatar bot={bot} size={28} state="idle" animated={false} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-ink">{bot.name}</span>
                {bot.title && <span className="block truncate text-[11.5px] text-ink-secondary">{bot.title}</span>}
              </span>
              <button
                type="button"
                data-add-bot={bot.id}
                onClick={() => onAdd(bot.id)}
                className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2 py-1 text-[12px] font-semibold text-accent-ink hover:brightness-110"
              >
                <UserPlus size={12} />{t("room.people.add")}
              </button>
            </li>
          ))}
        </ul>
      )}
      {showDone && (
        <button type="button" data-roster-done="" onClick={onDone} className="self-end rounded-md px-2 py-1 text-[12px] text-ink-secondary hover:bg-control hover:text-ink">
          {t("room.people.done")}
        </button>
      )}
    </div>
  );
}
