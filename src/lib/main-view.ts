// What the main column shows: the selected group or bot, else the first bot
// the sidebar lists, else (someone who owns no bot and was added to a group,
// or shared nothing but a room) the first room it lists. A bot or a group
// the person hid, and a direct conversation with a person they closed, are
// never a fallback (src/lib/selection-fallback.ts): with nothing listed and
// nothing selected the main column shows its empty state.
import { botListedInSidebar, groupHiddenFromSidebar } from "@/lib/selection-fallback";

export function mainConversation<
  B extends { id: string; hidden?: boolean },
  G extends { id: string; dm?: boolean; peopleDm?: boolean; humanIds?: readonly string[] },
>(
  bots: readonly B[],
  groups: readonly G[],
  selectedId: string,
  sidebarHidden: ReadonlySet<string> = new Set(),
): { bot?: B; group?: G } {
  const selectedGroup = groups.find((group) => group.id === selectedId);
  if (selectedGroup) return { group: selectedGroup };
  const bot = bots.find((candidate) => candidate.id === selectedId)
    ?? bots.find((candidate) => botListedInSidebar(candidate, sidebarHidden));
  if (bot) return { bot };
  const group = groups.find((candidate) => !candidate.dm && !groupHiddenFromSidebar(candidate, sidebarHidden));
  return group ? { group } : {};
}
