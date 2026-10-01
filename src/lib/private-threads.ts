// Private conversations on a server signed in with Perspicax: a 1:1 thread
// with a bot belongs to the person who started it, and the server sends each
// person only their own threads. Several people talk together only in a
// group chat. Pure helpers for the sidebar, the chat header and the group's
// people panel.
import type { OrgDirectoryPerson } from "@/lib/perspicax-org";

/** Whether the chat header shows the "private conversation" hint: on an
 * organization server, for a bot someone else owns or one its owner shared. */
export function showPrivateConversationHint(input: {
  org: boolean;
  viewerId: string;
  bot: { ownerUserId?: string; grants?: readonly unknown[]; directGrants?: readonly unknown[] };
}): boolean {
  if (!input.org) return false;
  const owner = input.bot.ownerUserId?.trim().toLowerCase() ?? "";
  const viewer = input.viewerId.trim().toLowerCase();
  if (owner && viewer && owner !== viewer) return true;
  return (input.bot.grants?.length ?? 0) > 0 || (input.bot.directGrants?.length ?? 0) > 0;
}

/** How a group's person entry reads: a directory person's name, a team's
 * name, else the raw entry (an email on a solo server). */
export function groupHumanLabel(
  entry: string,
  directory: { people: Pick<OrgDirectoryPerson, "principalId" | "name" | "login">[]; teams?: { id: string; name: string }[] } | null,
): string {
  const raw = entry.trim();
  if (!directory) return raw;
  if (raw.startsWith("team:")) return directory.teams?.find((team) => team.id === raw.slice(5))?.name || raw.slice(5);
  const id = (raw.startsWith("user:") ? raw.slice(5) : raw).toLowerCase();
  const person = directory.people.find((candidate) => candidate.principalId.toLowerCase() === id);
  return person?.name || person?.login || raw;
}

/** Directory people a group may add: active, not already listed, matching
 * the search by name, login or address. At most `limit`. */
export function groupPeopleCandidates(people: readonly OrgDirectoryPerson[], input: { taken: readonly string[]; query: string; limit?: number }): OrgDirectoryPerson[] {
  const taken = new Set(input.taken.map((id) => (id.startsWith("user:") ? id.slice(5) : id).trim().toLowerCase()));
  const q = input.query.trim().toLowerCase();
  return people
    .filter((person) => {
      if (person.disabled || taken.has(person.principalId.toLowerCase())) return false;
      if (!q) return true;
      return [person.name, person.login, person.email ?? ""].some((field) => field.toLowerCase().includes(q));
    })
    .slice(0, input.limit ?? 20);
}
