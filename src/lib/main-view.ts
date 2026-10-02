// What the main column shows: the selected group or bot, else the first bot,
// else (someone who owns no bot and was added to a group, or shared nothing
// but a room) the first group. The "It feels empty in here" state is only
// for a viewer who sees no bot and no group at all.
export function mainConversation<B extends { id: string }, G extends { id: string; dm?: boolean }>(
  bots: readonly B[],
  groups: readonly G[],
  selectedId: string,
): { bot?: B; group?: G } {
  const selectedGroup = groups.find((group) => group.id === selectedId);
  if (selectedGroup) return { group: selectedGroup };
  const bot = bots.find((candidate) => candidate.id === selectedId) ?? bots[0];
  if (bot) return { bot };
  const group = groups.find((candidate) => !candidate.dm) ?? groups[0];
  return group ? { group } : {};
}

