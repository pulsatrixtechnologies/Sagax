/** Whether the composer of this room offers a group nudge.
 * A person-to-person chat and a bot dm do not. The room must name someone
 * other than the viewer: a principal id, `user:<id>`, or `team:<id>`.
 * The server decides who is actually shaken. */
export function groupNudgeTarget(
  group: { id: string; name: string; dm?: boolean; peopleDm?: boolean; humanIds?: string[] },
  viewerId: string,
  viewerEmail?: string,
): { id: string; name: string } | null {
  if (group.peopleDm || group.dm) return null;
  const self = new Set([viewerId, viewerEmail ?? ""].map((value) => value.trim().toLowerCase()).filter(Boolean));
  const other = (group.humanIds ?? []).some((entry) => {
    const raw = entry.trim();
    if (!raw) return false;
    const lower = raw.toLowerCase();
    if (lower.startsWith("team:")) return raw.slice(5).trim().length > 0;
    const id = (lower.startsWith("user:") ? raw.slice(5) : raw).trim().toLowerCase();
    return id.length > 0 && !self.has(id);
  });
  if (!other) return null;
  return { id: group.id, name: group.name.trim() || group.id };
}
