import { closeSync, mkdirSync, openSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import path from "node:path";

/** One live file plus one backup. The shell copies the server child's stdout
 * here for the whole session; without a cap that file grows for as long as
 * Sagax stays open. */
export const SERVER_LOG_MAX_BYTES = 8 * 1024 * 1024;

/** Append-only log with a hard cap. Writes are synchronous so a line survives
 * a crash that kills the process before an async buffer flushes, and so the
 * rotation can close the file before renaming it (Windows will not rename a
 * file another handle still has open). */
export function createRotatingLog(file, maxBytes = SERVER_LOG_MAX_BYTES) {
  let fd = null;
  let written = 0;

  const rotate = () => {
    if (fd !== null) {
      try { closeSync(fd); } catch { /* already closed */ }
      fd = null;
    }
    const previous = `${file}.1`;
    try { rmSync(previous, { force: true }); } catch { /* nothing to replace */ }
    try { renameSync(file, previous); } catch { /* the live file may not exist yet */ }
  };

  const open = () => {
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      const size = statSync(file).size;
      if (size >= maxBytes) {
        rotate();
        written = 0;
      } else written = size;
    } catch {
      written = 0;
    }
    fd = openSync(file, "a", 0o600);
  };

  return {
    write(text) {
      try {
        if (fd === null) open();
        const bytes = Buffer.byteLength(text);
        if (written > 0 && written + bytes > maxBytes) {
          rotate();
          written = 0;
          fd = openSync(file, "a", 0o600);
        }
        writeSync(fd, text);
        written += bytes;
      } catch {
        /* logging must never break startup */
      }
    },
  };
}
