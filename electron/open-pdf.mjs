// "Open in default app" for a PDF the in-app viewer shows. The page hands
// over the PDF's bytes and a display name, never a path: main checks the
// bytes (a PDF signature, a size cap), writes them to a new private folder
// in the system temp dir under a cleaned name that always ends in .pdf, and
// asks the system to open that file. A page can therefore only ever make
// this computer open a .pdf it just wrote, never an existing file, a folder,
// an app or a URL.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Same cap as an attachment the chat can fetch (FILE_MAX_BYTES). */
export const OPEN_PDF_MAX_BYTES = 25 * 1024 * 1024;
const TEMP_PREFIX = "sagax-pdf-";
const NAME_MAX = 120;
// Older private folders are removed on the next open: by then the reader
// has had the file for a day.
const STALE_MS = 24 * 60 * 60 * 1000;

/** The bytes as a Uint8Array, or null when they are not a PDF within the cap. */
export function pdfBytesFrom(value, maxBytes = OPEN_PDF_MAX_BYTES) {
  let bytes = null;
  if (value instanceof Uint8Array) bytes = value;
  else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
  if (!bytes || bytes.byteLength < 5 || bytes.byteLength > maxBytes) return null;
  // "%PDF-" may follow up to 1024 bytes of junk, as every reader allows.
  const head = bytes.subarray(0, Math.min(bytes.byteLength, 1024 + 5));
  for (let index = 0; index + 5 <= head.byteLength; index += 1) {
    if (head[index] === 0x25 && head[index + 1] === 0x50 && head[index + 2] === 0x44 && head[index + 3] === 0x46 && head[index + 4] === 0x2d) {
      return bytes;
    }
  }
  return null;
}

/** A file name safe on every system: no folders, no control or reserved
 * characters, no leading dots, bounded, and always ending in ".pdf". */
export function safePdfName(raw) {
  const text = typeof raw === "string" ? raw : "";
  const base = text.split(/[\\/]/).pop() ?? "";
  let stem = base
    .normalize("NFC")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*‪-‮⁦-⁩]/g, "")
    .replace(/\.pdf$/i, "")
    .replace(/^[\s.]+|[\s.]+$/g, "")
    .trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(stem)) stem = `_${stem}`;
  if (!stem) stem = "document";
  if (stem.length > NAME_MAX) stem = stem.slice(0, NAME_MAX).trimEnd();
  return `${stem}.pdf`;
}

/** Remove our own temp folders older than a day. Best effort. */
export async function sweepStalePdfDirs({ tmpdir = os.tmpdir(), fsp = fs.promises, now = Date.now() } = {}) {
  let names = [];
  try {
    names = await fsp.readdir(tmpdir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(TEMP_PREFIX)) continue;
    const dir = path.join(tmpdir, name);
    try {
      const stats = await fsp.lstat(dir);
      if (!stats.isDirectory() || now - stats.mtimeMs < STALE_MS) continue;
      await fsp.rm(dir, { recursive: true, force: true });
    } catch {
      // another process may have removed it
    }
  }
}

/** Write the PDF to a fresh private folder; resolves the file's path. */
export async function writeTempPdf(value, rawName, { tmpdir = os.tmpdir(), fsp = fs.promises, platform = process.platform } = {}) {
  const bytes = pdfBytesFrom(value);
  if (!bytes) throw new Error("That file is not a PDF this app can open");
  const dir = await fsp.mkdtemp(path.join(tmpdir, TEMP_PREFIX));
  if (platform !== "win32") await fsp.chmod(dir, 0o700);
  const file = path.join(dir, safePdfName(rawName));
  // wx: the folder is new, so the file must not exist yet (no symlink games)
  await fsp.writeFile(file, bytes, { mode: 0o600, flag: "wx" });
  return file;
}

/** The IPC handler's body: validate, write, open. Resolves true when the
 * system opened it, or throws a short message the page shows. */
export async function openPdfInDefaultApp(value, rawName, { openPath, tmpdir, fsp, platform } = {}) {
  if (typeof openPath !== "function") throw new Error("Opening files is not available here");
  void sweepStalePdfDirs({ tmpdir, fsp }).catch(() => {});
  const file = await writeTempPdf(value, rawName, { tmpdir, fsp, platform });
  const problem = await openPath(file);
  if (problem) throw new Error("No app on this computer could open the PDF");
  return true;
}
