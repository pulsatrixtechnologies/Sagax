// The sidebar's lists once a person's hidden entries (src/lib/sidebar-hidden.ts)
// are applied, and the names the "Hidden" row and Settings show for them.
import type { Bot, Group } from "@/state/store";
import { peopleDmPeer } from "@/lib/people-dm";
import { hiddenKey, type HiddenEntry } from "@/lib/sidebar-hidden";

/** The sidebar key of a group: a direct conversation with a person is
 * hidden as that person (it follows them), any other group by its id. */
export function groupHiddenKey(group: Group, viewerId: string): string {
  const peer = group.peopleDm ? peopleDmPeer(group, viewerId, new Map()) : null;
  return peer ? hiddenKey("person", peer.id) : hiddenKey("group", group.id);
}

/** What the sidebar lists once the person's hidden entries are left out.
 * Nothing is removed from the store: search, the command palette and the
 * To: picker still reach them. */
export function withoutHiddenEntries<B extends Bot, G extends Group>(bots: readonly B[], groups: readonly G[], hidden: ReadonlySet<string>, viewerId: string): { bots: B[]; groups: G[] } {
  if (hidden.size === 0) return { bots: [...bots], groups: [...groups] };
  return {
    bots: bots.filter((bot) => !hidden.has(hiddenKey("bot", bot.id))),
    groups: groups.filter((group) => !hidden.has(groupHiddenKey(group, viewerId))),
  };
}

/** The hidden entries as the "Hidden" row lists them: the ones that still
 * exist, with their names (a person's from the directory). */
export function hiddenSidebarRows(
  items: readonly HiddenEntry[],
  input: { bots: readonly Bot[]; groups: readonly Group[]; viewerId: string; people: ReadonlyMap<string, { name: string; login: string }> },
): { key: string; kind: HiddenEntry["kind"]; id: string; name: string }[] {
  const rows: { key: string; kind: HiddenEntry["kind"]; id: string; name: string }[] = [];
  for (const item of items) {
    const key = hiddenKey(item.kind, item.id);
    if (item.kind === "bot") {
      const bot = input.bots.find((candidate) => candidate.id === item.id && !candidate.hidden);
      if (bot) rows.push({ key, kind: item.kind, id: item.id, name: bot.name });
    } else if (item.kind === "group") {
      const group = input.groups.find((candidate) => candidate.id === item.id);
      if (group) rows.push({ key, kind: item.kind, id: item.id, name: group.name });
    } else {
      const group = input.groups.find((candidate) => candidate.peopleDm && groupHiddenKey(candidate, input.viewerId) === key);
      if (!group) continue;
      const person = input.people.get(item.id);
      rows.push({ key, kind: item.kind, id: item.id, name: person?.name || person?.login || group.name || item.id });
    }
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

