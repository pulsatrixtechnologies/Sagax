// `git diff` (unified, with --find-renames) into the DiffView contract of the
// cloud agents spec (section 8.0): files with their hunks and numbered lines.
// Text only: the console and Sagax never inject HTML from a diff.
import type { DiffFile, DiffHunk } from "./protocol.ts";

const PREVIEWABLE = /\.(md|markdown|html?|svg|png|jpe?g|gif|webp)$/i;

function unquote(path: string): string {
  // git quotes paths with unusual characters ("a/sp ace\t.txt").
  if (path.startsWith("\"") && path.endsWith("\"")) {
    try { return JSON.parse(path) as string; } catch { return path.slice(1, -1); }
  }
  return path;
}

function stripPrefix(path: string): string {
  const clean = unquote(path.trim());
  return clean.replace(/^[ab]\//, "");
}

export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git (".*?"|\S+) (".*?"|\S+)$/.exec(line);
      file = { path: match ? stripPrefix(match[2]!) : line.slice(11), status: "modified", added: 0, removed: 0, hunks: [] };
      files.push(file);
      hunk = null;
      continue;
    }
    if (!file) continue;
    if (!hunk) {
      if (line.startsWith("new file mode")) file.status = "added";
      else if (line.startsWith("deleted file mode")) file.status = "deleted";
      else if (line.startsWith("rename to ")) { file.status = "renamed"; file.path = unquote(line.slice(10)); }
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
      else if (line.startsWith("+++ ") && !line.startsWith("+++ /dev/null")) file.path = stripPrefix(line.slice(4));
    }
    const header = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (header) {
      hunk = { header: line, lines: [] };
      file.hunks.push(hunk);
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ kind: "add", new: newLine++, text: line.slice(1) });
      file.added++;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ kind: "del", old: oldLine++, text: line.slice(1) });
      file.removed++;
    } else if (line.startsWith(" ")) {
      hunk.lines.push({ kind: "ctx", old: oldLine++, new: newLine++, text: line.slice(1) });
    }
    // "\ No newline at end of file" and the final empty line carry no row.
  }
  for (const f of files) if (PREVIEWABLE.test(f.path)) f.previewable = true;
  return files;
}

/** Keep the diff under `maxBytes` once serialized: the largest files lose
 * their hunks first (path and counts stay, so the list is still whole). */
export function capDiff(files: DiffFile[], maxBytes: number): { files: DiffFile[]; truncated: boolean } {
  const size = (list: DiffFile[]) => Buffer.byteLength(JSON.stringify({ files: list }));
  if (size(files) <= maxBytes) return { files, truncated: false };
  const out = files.map((file) => ({ ...file }));
  const order = out
    .map((file, index) => ({ index, bytes: Buffer.byteLength(JSON.stringify(file.hunks)) }))
    .sort((a, b) => b.bytes - a.bytes);
  for (const { index } of order) {
    out[index] = { ...out[index]!, hunks: [] };
    if (size(out) <= maxBytes) return { files: out, truncated: true };
  }
  // Even the bare list is too big: keep as many files as fit.
  while (out.length && size(out) > maxBytes) out.pop();
  return { files: out, truncated: true };
}
