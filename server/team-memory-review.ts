// Who may confirm a section's shared team memory.
//
// A bot proposes an entry for the section it sits in. On a shared workspace
// the people who can use a bot in that section confirm it, and so does a
// workspace admin. Anyone else is refused. A solo workspace keeps the older
// rule: whoever may chat may answer.

export const TEAM_MEMORY_REVIEW_REFUSAL =
  "Only a member of this team, or a workspace admin, can review its shared memory.";

export interface TeamMemoryReview {
  /** Workspace admin scope, or the operator at this computer. */
  admin: boolean;
  /** More than one person uses this workspace. */
  shared: boolean;
  /** The caller can use the proposing bot, or another bot in this section. */
  memberOfSection: boolean;
}

/** Null when this caller may review the entry. The refusal is the whole decision. */
export function teamMemoryReviewRefusal(input: TeamMemoryReview): string | null {
  if (input.admin || !input.shared || input.memberOfSection) return null;
  return TEAM_MEMORY_REVIEW_REFUSAL;
}
