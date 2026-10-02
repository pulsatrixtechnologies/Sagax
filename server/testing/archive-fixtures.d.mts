export declare function zipArchive(entries: { name: string; data?: string | Buffer; method?: 0 | 8; encrypted?: boolean; symlink?: boolean; declaredSize?: number }[]): Buffer;
export declare function tarArchive(
  entries: { name: string; data?: string | Buffer; type?: "file" | "dir" | "symlink" | "hardlink" | "fifo"; linkname?: string; pax?: boolean }[],
  options?: { gzip?: boolean },
): Buffer;
