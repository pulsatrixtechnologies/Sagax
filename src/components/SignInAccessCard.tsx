// Who may sign in with an emailed code. The list editor itself lives in
// People (PeopleSection). These helpers are the shared rules for an address
// or an @domain.

export interface SignInLists {
  admins: string[];
  members: string[];
}

/** An address or `@domain`, lower-cased; null when it is neither. */
export function normalizeAccessEntry(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  if (!value || /\s/.test(value)) return null;
  if (value.startsWith("@")) return /^@[^@\s]+\.[^@\s]+$/.test(value) ? value : null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? value : null;
}

/** Adding moves an entry between the lists rather than duplicating it. */
export function withEntry(lists: SignInLists, entry: string, role: "admin" | "member"): SignInLists {
  const admins = lists.admins.filter((item) => item !== entry);
  const members = lists.members.filter((item) => item !== entry);
  return role === "admin" ? { admins: [...admins, entry], members } : { admins, members: [...members, entry] };
}

export function withoutEntry(lists: SignInLists, entry: string): SignInLists {
  return { admins: lists.admins.filter((item) => item !== entry), members: lists.members.filter((item) => item !== entry) };
}
