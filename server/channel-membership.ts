/** Who someone is to a channel: the operator at this computer (owner), an
 * admin, or a member. */
export type OrgRole = "owner" | "admin" | "member";

/** True only when the actor owns the bot. An admin is not an exception. */
export function canPlaceBot(input: { actorId: string; ownerUserId: string }): boolean {
  return input.actorId.trim().toLowerCase() === input.ownerUserId.trim().toLowerCase();
}

/** The id canPlaceBot compares against. A recorded owner wins, then a
 * given organization owner, else the local operator. This never
 * substitutes the caller's id. */
export function ownerUserIdForPlacement(input: {
  recordedOwnerUserId?: string;
  orgOwnerUserId?: string;
  localOperatorId: string;
}): string {
  if (input.recordedOwnerUserId) return input.recordedOwnerUserId;
  if (input.orgOwnerUserId) return input.orgOwnerUserId;
  return input.localOperatorId;
}

/** Owner and admin may change who is in a channel. A member may not. */
export function canEditHumans(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

/** Humans sit beside bots. A bot-to-bot dm has no human list. */
export function applyHumanIds(input: { dm?: boolean; humanIds: string[] }): { ok: true; humanIds: string[] } | { ok: false; error: "dm-has-no-humans" } {
  if (input.dm) return { ok: false, error: "dm-has-no-humans" };
  return { ok: true, humanIds: input.humanIds };
}
