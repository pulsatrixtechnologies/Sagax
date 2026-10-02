// The Primary Bot (formerly Chief of Staff): a person's main contact among
// their bots, who coordinates the others. One per person (one on a solo
// server), enforced by the server (`POST /api/bots/:id/primary`,
// `Store.setPrimaryBot`). The wire keeps its former field name,
// `chiefOfStaff`. The UI marks it with an orange star on the avatar.

export type PrimaryBotCandidate = {
  id: string;
  name: string;
  title?: string;
  hidden?: boolean;
  chiefOfStaff?: boolean;
  ownerUserId?: string;
};

const ownerKey = (bot: { ownerUserId?: string }): string => bot.ownerUserId?.trim().toLowerCase() ?? "";

/** Whether the viewer owns this bot. A bot without a recorded owner (or the
 * legacy "local-owner") is the operator's, which on a solo server is the
 * viewer. */
export function viewerOwnsBot(bot: { ownerUserId?: string }, viewerId: string): boolean {
  const owner = ownerKey(bot);
  if (!owner || owner === "local-owner") return true;
  return owner === viewerId.trim().toLowerCase();
}

/** The star shows on the viewer's own Primary Bot only: another person's
 * Primary Bot shared with them is not theirs. */
export function isViewersPrimaryBot(bot: { chiefOfStaff?: boolean; ownerUserId?: string }, viewerId: string): boolean {
  return Boolean(bot.chiefOfStaff) && viewerOwnsBot(bot, viewerId);
}

/** The viewer's own bots they may choose as Primary Bot: visible, not the
 * current one, matching the search, by name. */
export function primaryBotChoices<T extends PrimaryBotCandidate>(
  bots: readonly T[],
  viewerId: string,
  currentId: string | null,
  query = "",
): T[] {
  const wanted = query.trim().toLowerCase();
  return bots
    .filter((bot) => !bot.hidden && bot.id !== currentId && viewerOwnsBot(bot, viewerId))
    .filter((bot) => !wanted || `${bot.name} ${bot.title ?? ""}`.toLowerCase().includes(wanted))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A bot frame for a new Primary Bot: the same person's other bots give the
 * role up (the server already did; this keeps the window in step until
 * their own frames arrive). */
export function withPrimaryBot<T extends { id: string; chiefOfStaff?: boolean; ownerUserId?: string }>(bots: readonly T[], primary: T): T[] {
  const owner = ownerKey(primary);
  return bots.map((bot) => (bot.id !== primary.id && bot.chiefOfStaff && ownerKey(bot) === owner ? { ...bot, chiefOfStaff: false } : bot));
}
