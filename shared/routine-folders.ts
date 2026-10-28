/** Routine folders (2026-10-28): a routine may sit in one named folder of its
 * bot, and each bot keeps a stable order of its folders. One home for the
 * name rules, the "[Prefix] Title" reading and the grouping, so the server,
 * the desktop list and the API answer cannot drift apart. */

export const ROUTINE_FOLDER_MAX = 60;
/** Folders one bot may keep. */
export const ROUTINE_FOLDERS_PER_BOT = 100;

/** A folder name as stored: control characters dropped, spaces collapsed,
 * trimmed, at most ROUTINE_FOLDER_MAX characters. Empty means no folder. */
export function cleanRoutineFolder(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return undefined;
  return [...cleaned].slice(0, ROUTINE_FOLDER_MAX).join("").trim();
}

/** Two names are the same folder whatever their case. */
export function routineFolderKey(name: string): string {
  return name.toLocaleLowerCase();
}

/** The spelling a bot already uses for this folder, else the name itself. */
export function canonicalRoutineFolder(order: readonly string[], name: string): string {
  const key = routineFolderKey(name);
  return order.find((existing) => routineFolderKey(existing) === key) ?? name;
}

/** "[Prefix] Title" read as a folder and the title without it. Null when the
 * name has no leading bracketed prefix, or nothing would be left after it. */
export function routinePrefixFolder(name: string): { folder: string; name: string } | null {
  const match = /^\s*\[([^\][\n]{1,80})\]\s*[-:·|]?\s*(.+)$/.exec(name);
  if (!match) return null;
  const folder = cleanRoutineFolder(match[1]);
  const rest = match[2]!.trim();
  if (!folder || !rest) return null;
  return { folder, name: rest };
}

/** A bot's folders in order: its saved order first, then any folder a
 * routine names that the order does not (an older file), by name. */
export function orderedRoutineFolders(order: readonly string[], routines: readonly { folder?: string }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (name: string) => {
    const key = routineFolderKey(name);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  for (const name of order) add(name);
  // A folder only routines name keeps the spelling of the first of them.
  const extra = new Map<string, string>();
  for (const routine of routines) {
    if (routine.folder && !seen.has(routineFolderKey(routine.folder)) && !extra.has(routineFolderKey(routine.folder))) extra.set(routineFolderKey(routine.folder), routine.folder);
  }
  for (const name of [...extra.values()].sort((a, b) => a.localeCompare(b))) add(name);
  return out;
}

export interface RoutineFolderGroup<R> {
  /** null: the routines in no folder (a section without a title). */
  folder: string | null;
  routines: R[];
}

/** The list cut into sections: routines in no folder first (the list as it
 * always was), then one section per folder in the bot's order, empty
 * folders included so a new folder can be filled from its header. */
export function groupRoutinesByFolder<R extends { folder?: string }>(routines: readonly R[], order: readonly string[]): RoutineFolderGroup<R>[] {
  const folders = orderedRoutineFolders(order, routines);
  const byKey = new Map<string, R[]>(folders.map((name) => [routineFolderKey(name), []]));
  const loose: R[] = [];
  for (const routine of routines) {
    const bucket = routine.folder ? byKey.get(routineFolderKey(routine.folder)) : undefined;
    if (bucket) bucket.push(routine);
    else loose.push(routine);
  }
  return [
    { folder: null, routines: loose },
    ...folders.map((name) => ({ folder: name, routines: byKey.get(routineFolderKey(name))! })),
  ];
}

/** What "Sort by prefix" would do: the routines whose name starts with
 * "[X]", each with its folder and shortened name. Routines already in a
 * folder keep it and are left alone. */
export function routinePrefixPlan<R extends { id: string; name: string; folder?: string }>(routines: readonly R[]): Array<{ id: string; folder: string; name: string }> {
  return routines.flatMap((routine) => {
    if (routine.folder) return [];
    const parsed = routinePrefixFolder(routine.name);
    return parsed ? [{ id: routine.id, ...parsed }] : [];
  });
}

/** One routine as it was before a folder action, for its Undo. */
export interface RoutineFolderUndoEntry {
  id: string;
  name: string;
  /** Absent: the routine was in no folder. */
  folder?: string;
}

/** Everything one folder action changed, handed back so Undo restores it. */
export interface RoutineFolderUndo {
  botId: string;
  folders: string[];
  routines: RoutineFolderUndoEntry[];
}

/** POST /api/routines/folders: one action on one bot's folders. */
export type RoutineFolderAction =
  | { action: "create"; botId: string; name: string }
  | { action: "rename"; botId: string; from: string; to: string }
  | { action: "delete"; botId: string; name: string }
  | { action: "reorder"; botId: string; order: string[] }
  | { action: "move"; botId: string; routineIds: string[]; folder: string | null }
  | { action: "sort-by-prefix"; botId: string }
  | { action: "restore"; botId: string; undo: RoutineFolderUndo };
