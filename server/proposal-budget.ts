// The open-card budget of a bot's proposals in one conversation
// (index.ts proposalPersistence): routine, profile, default-model and
// team-setup proposals share eight open cards per bot per thread.
//
// 2026-10-20: a waiting proposal never blocks a new one. Past the
// budget the oldest waiting cards are replaced: closed as expired, nothing
// applied, journaled. A card under a safety hold is never replaced.
//
// 2026-10-26 (#1059): a team setup card is never replaced either. It holds
// a whole reviewed plan (bots to create, teams to open) that the person may
// still be reading, and the bot moved on believing it would resume once.
// When only cards that cannot be replaced fill the budget, the new proposal
// is refused with words that tell the bot to wait for the person.

export const OPEN_PROPOSAL_BUDGET = 8;

export const TEAM_SETUP_WAITING =
  "Team setup cards are already waiting for the person's answer here. Nothing was replaced or applied. End this turn and wait for their decision; it resumes you once, then propose the rest.";

export interface OpenProposal {
  held: boolean;
  teamSetup: boolean;
}

/** Which open proposals (oldest first) the new card replaces, or the refusal. */
export function proposalReplacements<T extends OpenProposal>(open: readonly T[]):
  | { ok: true; replace: T[] }
  | { ok: false; error: string } {
  const surplus = Math.max(0, open.length - (OPEN_PROPOSAL_BUDGET - 1));
  if (surplus === 0) return { ok: true, replace: [] };
  const replaceable = open.filter((proposal) => !proposal.held && !proposal.teamSetup);
  if (replaceable.length >= surplus) return { ok: true, replace: replaceable.slice(0, surplus) };
  return {
    ok: false,
    error: open.some((proposal) => proposal.teamSetup) ? TEAM_SETUP_WAITING : "confirm or cancel an existing proposal first",
  };
}
