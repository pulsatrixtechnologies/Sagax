import type { OrgRole } from "./org-directory.ts";

/** True only when the actor owns the bot. An admin is not an exception. */
export function canPlaceBot(input: { actorId: string; ownerUserId: string }): boolean {
  return input.actorId === input.ownerUserId;
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
