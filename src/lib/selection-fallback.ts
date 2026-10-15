// Which conversation the main column may fall back on when nothing (or
// nothing that still exists) is selected. A fallback only ever lands on a
// conversation the sidebar lists: never a bot or a group the person hid,
// never a direct conversation with a person they closed, never a bot the
// server marks hidden. With none listed the selection stays empty and the
// main column shows its empty state, so the composer never targets a
// conversation the person cannot see in their list.
//
// An explicit pick (search, the person panel, a link) may still open a
// hidden entry; only restored and fallback selections go through here.
import { hiddenKey } from "@/lib/sidebar-hidden";

interface BotLike { id: string; hidden?: boolean }
interface GroupLike { id: string; dm?: boolean; peopleDm?: boolean; humanIds?: readonly string[] }

/** Whether the person removed this group from their sidebar: a group by its
 * id, a direct conversation with a person by that person (any member of
 * the pair: the viewer never hides themself). */
export function groupHiddenFromSidebar(group: GroupLike, hidden: ReadonlySet<string>): boolean {
  if (hidden.has(hiddenKey("group", group.id))) return true;
  return Boolean(group.peopleDm && group.humanIds?.some((id) => hidden.has(hiddenKey("person", id))));
}

export function botListedInSidebar(bot: BotLike, hidden: ReadonlySet<string>): boolean {
  return !bot.hidden && !hidden.has(hiddenKey("bot", bot.id));
}

/** Whether the conversation with this id is present and listed in the
 * sidebar (a bot's own chat group counts with its bot). */
export function selectionListed(
  bots: readonly BotLike[],
  groups: readonly GroupLike[],
  id: string,
  hidden: ReadonlySet<string>,
): boolean {
  if (!id) return false;
  const bot = bots.find((candidate) => candidate.id === id);
  if (bot) return botListedInSidebar(bot, hidden);
  const group = groups.find((candidate) => candidate.id === id);
  return Boolean(group && !groupHiddenFromSidebar(group, hidden));
}

/** Whether the selection is hidden by `next` but was not by `previous`:
 * the person just closed or hid the conversation that is open, or their
 * hidden list arrived from another device. */
export function selectionNewlyHidden(
  bots: readonly BotLike[],
  groups: readonly GroupLike[],
  id: string,
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
): boolean {
  if (!id) return false;
  const bot = bots.find((candidate) => candidate.id === id);
  if (bot) {
    const key = hiddenKey("bot", bot.id);
    return next.has(key) && !previous.has(key);
  }
  const group = groups.find((candidate) => candidate.id === id);
  return Boolean(group && groupHiddenFromSidebar(group, next) && !groupHiddenFromSidebar(group, previous));
}

/** The first listed bot, else the first listed room (never a bot's own chat
 * group), else "" (the empty state). */
export function fallbackSelection(
  bots: readonly BotLike[],
  groups: readonly GroupLike[],
  hidden: ReadonlySet<string>,
): string {
  return bots.find((bot) => botListedInSidebar(bot, hidden))?.id
    ?? groups.find((group) => !group.dm && !groupHiddenFromSidebar(group, hidden))?.id
    ?? "";
}
