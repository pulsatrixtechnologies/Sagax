// The Library tab's model: a conversation's files and its bot's artifacts in
// one list, the pinned ones first, the rest grouped by how recent they are.
// A file is pinned on the server per conversation (POST
// /api/threads/:id/files/:fileId/pin); an artifact's pin is its favorite
// flag, which the server already keeps per bot.
import type { ThreadFile } from "./chat-files";
import type { ArtifactSummary } from "../../shared/artifacts";

export type LibraryItem =
  | { kind: "file"; key: string; at: number; pinned: boolean; file: ThreadFile }
  | { kind: "artifact"; key: string; at: number; pinned: boolean; artifact: ArtifactSummary };

export const LIBRARY_PERIODS = ["thisWeek", "older"] as const;
export type LibraryPeriod = (typeof LIBRARY_PERIODS)[number];

export interface LibraryGroups {
  pinned: LibraryItem[];
  /** Only the periods that have something in them, newest period first. */
  periods: { id: LibraryPeriod; items: LibraryItem[] }[];
}

const WEEK_MS = 7 * 24 * 3_600_000;

export function libraryItems(files: readonly ThreadFile[] | null, artifacts: readonly ArtifactSummary[] | null): LibraryItem[] {
  return [
    ...(files ?? []).map((file): LibraryItem => ({ kind: "file", key: `file:${file.id}`, at: file.at, pinned: file.pinned === true, file })),
    ...(artifacts ?? []).map((artifact): LibraryItem => ({ kind: "artifact", key: `artifact:${artifact.id}`, at: artifact.updatedAt, pinned: artifact.favorite === true, artifact })),
  ];
}

/** Pinned items on top; the rest by period (the last 7 days, then older),
 * each newest first. */
export function groupLibraryItems(items: readonly LibraryItem[], now: number): LibraryGroups {
  const newest = (a: LibraryItem, b: LibraryItem) => b.at - a.at || a.key.localeCompare(b.key);
  const sorted = [...items].sort(newest);
  const pinned = sorted.filter((item) => item.pinned);
  const rest = sorted.filter((item) => !item.pinned);
  const thisWeek = rest.filter((item) => now - item.at < WEEK_MS);
  const older = rest.filter((item) => now - item.at >= WEEK_MS);
  return {
    pinned,
    periods: [
      ...(thisWeek.length ? [{ id: "thisWeek" as const, items: thisWeek }] : []),
      ...(older.length ? [{ id: "older" as const, items: older }] : []),
    ],
  };
}
