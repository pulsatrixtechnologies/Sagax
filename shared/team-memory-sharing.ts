// Who a team-memory card reaches besides its bot's owner.
//
// Two memories, kept apart:
// - personal memory: one person's own (a write to their own tier, confirmed
//   on a "Save to your personal memory?" card in their conversation). It is
//   never a team-memory card and never reaches anyone else.
// - team memory: a section's shared people, places, decisions and terms. A
//   bot proposes an entry on a "Remember this for the team?" card that the
//   members of its section may confirm.
//
// Each bot chooses how far its team-memory cards travel (`teamMemorySharing`):
// - "shared" (the default, and every bot that never set it): every member of
//   the card's section gets the card;
// - "private": only the members who already see this bot and the card's
//   conversation or channel.

export type TeamMemorySharing = "shared" | "private";

export const TEAM_MEMORY_SHARING_VALUES: readonly TeamMemorySharing[] = ["shared", "private"];

/** A bot's setting; absent or unknown reads as "shared". */
export function teamMemorySharingOf(bot: { teamMemorySharing?: unknown } | null | undefined): TeamMemorySharing {
  return bot?.teamMemorySharing === "private" ? "private" : "shared";
}

export function isTeamMemorySharing(value: unknown): value is TeamMemorySharing {
  return value === "shared" || value === "private";
}

export interface TeamMemoryCardDelivery {
  card: { teamMemoryRequest?: { section?: unknown }; confidentialMemoryRequest?: unknown } | null | undefined;
  /** The proposing bot's setting. */
  sharing: TeamMemorySharing;
  /** Several people share team memory on this server. */
  sharedServer: boolean;
  /** A Cloud home: one person's. */
  cloudHome: boolean;
  /** The card's conversation is confidential. */
  confidential: boolean;
  /** The person can use a bot of this section now. */
  memberOfSection: (section: string) => boolean;
  /** The person sees this card's bot and its conversation or channel. */
  seesCardContext: () => boolean;
}

/** Whether a team-memory card reaches this person as a member of its
 * section. Never a personal memory card, never a confidential conversation. */
export function teamMemoryCardReachesMember(input: TeamMemoryCardDelivery): boolean {
  const card = input.card;
  if (!card || card.confidentialMemoryRequest) return false;
  const section = card.teamMemoryRequest?.section;
  if (typeof section !== "string") return false;
  if (input.cloudHome || !input.sharedServer || input.confidential) return false;
  if (!input.memberOfSection(section)) return false;
  return input.sharing === "shared" || input.seesCardContext();
}
