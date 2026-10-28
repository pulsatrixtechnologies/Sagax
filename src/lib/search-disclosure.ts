import { useEffect, useState, type SetStateAction } from "react";

/** The open state each sidebar row was left in outside a search. Kept here
 * rather than in the row, because a row that does not match a search leaves
 * the list and would come back closed, and remembered on this device
 * (sidebar mode, Settings > Conversation threads): a bot folded open or
 * shut stays so across a reload, a list refresh and another bot's
 * selection. */
export const SIDEBAR_DISCLOSURE_KEY = "sagax.sidebar.threadsOpen.v1";
const chosen = new Map<string, boolean>(readStored());

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readStored(): Array<[string, boolean]> {
  try {
    const raw = storage()?.getItem(SIDEBAR_DISCLOSURE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return [];
    return Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean");
  } catch {
    return [];
  }
}

function remember(key: string, open: boolean): void {
  chosen.set(key, open);
  try {
    storage()?.setItem(SIDEBAR_DISCLOSURE_KEY, JSON.stringify(Object.fromEntries(chosen)));
  } catch {
    // the choice still holds for this session when storage is unavailable
  }
}

/** Tests start each case with no remembered rows. */
export function forgetSearchDisclosuresForTests(): void {
  chosen.clear();
  try { storage()?.removeItem(SIDEBAR_DISCLOSURE_KEY); } catch { /* nothing stored */ }
}

/** A fresh window reads what the last one left (tests). */
export function reloadSearchDisclosuresForTests(): void {
  chosen.clear();
  for (const [key, open] of readStored()) chosen.set(key, open);
}

/** A sidebar row's thread list open state while a search may be active
 * (MOCA-293). A search used to open every row it listed and leave them all
 * open after it was cleared, so one search exploded the sidebar for good.
 * Now a search opens only the rows that have a matching thread to show,
 * and clearing it puts every row back the way it was. A row the person
 * opens or closes during a search keeps that until the query changes. */
export function useSearchDisclosure(
  key: string,
  query: string,
  matches: boolean,
  initial = false,
): [boolean, (next: SetStateAction<boolean>) => void] {
  const [own, setOwn] = useState(() => chosen.get(key) ?? initial);
  const [during, setDuring] = useState<boolean | null>(null);
  useEffect(() => setDuring(null), [query]);
  const searching = Boolean(query.trim());
  const open = searching ? (during ?? matches) : own;
  const set = (next: SetStateAction<boolean>) => {
    const value = typeof next === "function" ? next(open) : next;
    if (searching) {
      setDuring(value);
      return;
    }
    remember(key, value);
    setOwn(value);
  };
  return [open, set];
}

/** Whether a search has a thread (or folder) of this row to show, which is
 * what earns opening the row; a name or role match alone just lists it. */
export function searchMatchesThreads(
  query: string,
  tasks: ReadonlyArray<{ title: string; routineRunId?: string }> | undefined,
  folders: ReadonlyArray<{ name: string }> | undefined = [],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return Boolean(tasks?.some((task) => !task.routineRunId && task.title.toLowerCase().includes(q)))
    || folders.some((folder) => folder.name.toLowerCase().includes(q));
}
