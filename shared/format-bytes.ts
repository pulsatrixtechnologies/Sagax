/** Byte strings that look alike and are not the same contract. Each caller
 * keeps its own wording. shared/resource-usage.ts is the locale ladder
 * ("1,5 Ko"). src/lib/memory.ts stays on memoryText and stops at kilobytes. */

/** Archive trees: "512 B", "1.5 KB", "2.0 MB", "1.0 GB". */
export function formatArchiveBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/** Network debugger: blank when the size is unknown, "kB" not "KB". */
export function formatDebuggerBytes(value: number | null): string {
  if (value === null || value < 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

/** Server environment panel: mebibytes or gibibytes, "?" when unknown. */
export function formatPanelBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "?";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
  return `${Math.round(bytes / 1024 ** 2)} MiB`;
}
