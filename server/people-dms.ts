// Direct conversations between two people of an organization.
//
// A person-to-person conversation is a group record with `peopleDm: true`,
// exactly two `humanIds` (principal ids) and no bot. It reuses the group's
// thread, messages, live frames and unread flag, and nothing else:
//
// - Only its two people read it, list it, stream it, search it or export it.
//   No organization admin, no team, no section and not the operator at the
//   server's console (loopback): a private conversation stays private.
// - It stays people-only. No bot can be added, so nothing said there can
//   reach a bot's context, memory or its owner. Inviting a bot would need
//   both people to agree, and the first such bot would carry the transcript
//   to its own owner; a group chat already is the place for that.
// - Its people, name, section, folder and instructions never change, and it
//   has no shared memory (server/group-memory.ts). Unread and the home pin
//   are display flags, the same ones a member already sets on a room.
// - A message is a person's message: it starts no turn, marks the
//   conversation unread and notifies the other person only.

/** The part of a group record these rules read. */
export interface PeopleDmLike {
  peopleDm?: boolean;
  humanIds?: string[];
}

const key = (id: string) => id.trim().toLowerCase();

/** One of the two people of this conversation. */
export function isPeopleDmParticipant(group: PeopleDmLike, viewerId: string | undefined): boolean {
  if (!viewerId || !group.peopleDm) return false;
  const viewer = key(viewerId);
  return (group.humanIds ?? []).some((id) => key(id) === viewer);
}

/** The conversation these two people already have, if any (order-free). */
export function findPeopleDm<T extends PeopleDmLike>(groups: readonly T[], a: string, b: string): T | undefined {
  const pair = new Set([key(a), key(b)]);
  return groups.find((group) => {
    if (!group.peopleDm) return false;
    const ids = new Set((group.humanIds ?? []).map(key));
    return ids.size === pair.size && [...pair].every((id) => ids.has(id));
  });
}

/** The other person of the conversation, for the one viewing it. */
export function otherPerson(group: PeopleDmLike, viewerId: string): string | undefined {
  const viewer = key(viewerId);
  return (group.humanIds ?? []).find((id) => key(id) !== viewer);
}

/** A PATCH on a person-to-person conversation may only mark it read or
 * unread, or set its home pin. Anything else is refused with the field's
 * name. */
export function peopleDmPatchRefusal(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const field = Object.keys(body).find((name) => name !== "unread" && name !== "pinned");
  return field ?? null;
}

/** Whether a directory entry may be written to: an active person, not a
 * service account, and not the one asking. */
export function peopleDmCandidate(entry: { principalId: string; disabled?: boolean; service?: boolean }, selfId: string): boolean {
  return !entry.disabled && !entry.service && key(entry.principalId) !== key(selfId);
}

/** The routes a person-to-person conversation answers besides reads: a
 * message, a read receipt (unread flag and read position), and a PATCH that only marks it (checked by
 * peopleDmPatchRefusal). Anything else (tasks, setup, members, queue,
 * interrupt, delete) is refused. */
export function peopleDmRouteRefusal(method: string, path: string): string | null {
  if (method === "GET" || method === "HEAD") return null;
  if (method === "POST" && /^\/api\/groups\/[\w-]+\/(?:messages|read)$/.test(path)) return null;
  if (method === "POST" && /^\/api\/threads\/[\w-]+\/read$/.test(path)) return null;
  if (method === "PATCH" && /^\/api\/groups\/[\w-]+$/.test(path)) return null;
  return "A conversation between two people only takes messages.";
}
