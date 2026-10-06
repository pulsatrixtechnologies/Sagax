export type ArchiveKind = "zip" | "tar" | "tgz" | "7z";
export type ArchiveStatus = "ok" | "encrypted" | "too-large" | "unsupported" | "invalid";

export interface ArchiveLimits {
  maxFiles: number;
  maxTotalBytes: number;
  maxRatio: number;
  ratioFloorBytes: number;
  maxDepth: number;
  maxPathBytes: number;
}

export interface ArchiveManifest {
  version: 1;
  kind: ArchiveKind | null;
  status: ArchiveStatus;
  reason?: string;
  files: number;
  dirs: number;
  totalBytes: number;
  archiveBytes: number;
  entries: { path: string; size: number }[];
  truncated: boolean;
  skipped: { path: string; reason: string }[];
  skippedCount: number;
}

export declare const ARCHIVE_LIMITS: Readonly<ArchiveLimits>;
export declare const MANIFEST_MAX_ENTRIES: number;
export declare function archiveKind(name: string | null | undefined): ArchiveKind | null;
export declare function extractedFolderName(name: string): string;
export declare function safeEntryPath(raw: unknown, limits?: ArchiveLimits): { path: string; reason?: undefined } | { path?: undefined; reason: string };
export interface ArchiveTextEntry {
  path: string;
  text: string;
}

/** Text members of a small archive, read in memory. Nothing is written. */
export declare function readSmallArchiveTexts(file: string, options?: {
  kind?: ArchiveKind | null;
  fileMax?: number;
  totalMax?: number;
  archiveMax?: number;
}): ArchiveTextEntry[];
export declare function listArchive(file: string, options?: { kind?: ArchiveKind | null; limits?: Partial<ArchiveLimits> }): Promise<ArchiveManifest>;
export declare function extractArchive(file: string, dest: string, options?: { kind?: ArchiveKind | null; limits?: Partial<ArchiveLimits> }): Promise<{ manifest: ArchiveManifest; extracted: boolean; existing?: boolean }>;
