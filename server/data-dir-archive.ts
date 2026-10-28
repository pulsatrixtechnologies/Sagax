// A copy of one data folder: sagax backup, and sagax restore --verify.
//
// Files are copied as they sit on disk. Rows already sealed stay sealed.
// Nothing here opens a database, unwraps a key, or turns encryption off.
// Paths the workspace backup already leaves out (clear keys, sign-in
// tokens, live databases) stay out of the archive too.
//
// restore --verify checks every hash and writes nothing. Writing back
// needs the explicit --apply flag, and even then only the archived files
// are replaced. A key file that was left out is not deleted.

import { createHash } from "node:crypto";
import { closeSync, createReadStream, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, statSync, writeSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { omittedFromWorkspaceBackup } from "./workspace-backup.ts";

const MAGIC = Buffer.from("SGBK1\n");

export interface ArchiveFile {
  path: string;
  bytes: number;
  sha256: string;
  mode: number;
}

export interface ArchiveReport {
  files: number;
  bytes: number;
  sha256: string;
}

function safeRelative(path: string): string | null {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").some((part) => part === ".." || part === "")) return null;
  return normalized;
}

function listedFiles(dataDir: string, skip: string | undefined): ArchiveFile[] {
  const root = resolve(dataDir);
  const out: ArchiveFile[] = [];
  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(dir, entry.name);
      const rel = safeRelative(relative(root, absolute).split(sep).join("/"));
      if (!rel || omittedFromWorkspaceBackup(rel)) continue;
      if (skip && resolve(absolute) === skip) continue;
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) {
        const stat = statSync(absolute);
        out.push({ path: rel, bytes: stat.size, sha256: "", mode: stat.mode & 0o777 });
      }
    }
  };
  walk(root);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function writeAll(fd: number, buffer: Buffer): void {
  let offset = 0;
  while (offset < buffer.length) offset += writeSync(fd, buffer, offset);
}

function readExact(fd: number, size: number): Buffer {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const read = readSync(fd, buffer, offset, size - offset, null);
    if (read === 0) throw new Error("The archive ended early.");
    offset += read;
  }
  return buffer;
}

/** Copy the data folder into one archive. The archive's own sha256 is of the file bytes. */
export async function createDataArchive(dataDir: string, outFile: string): Promise<ArchiveReport> {
  const root = resolve(dataDir);
  let rootStat;
  try {
    rootStat = statSync(root);
  } catch {
    throw new Error("The data folder could not be read.");
  }
  if (!rootStat.isDirectory()) throw new Error("The data folder is not a directory.");
  const destination = resolve(outFile);
  const files = listedFiles(root, destination);
  for (const file of files) file.sha256 = await hashFile(join(resolve(dataDir), file.path));
  mkdirSync(dirname(destination), { recursive: true });
  const fd = openSync(destination, "w", 0o600);
  try {
    writeAll(fd, MAGIC);
    writeAll(fd, Buffer.from(`${JSON.stringify({ v: 1, files })}\n`));
    for (const file of files) {
      const body = readFileSync(join(resolve(dataDir), file.path));
      if (body.length !== file.bytes) throw new Error(`"${file.path}" changed while it was copied.`);
      writeAll(fd, body);
    }
  } finally {
    closeSync(fd);
  }
  const sha256 = await hashFile(destination);
  const bytes = statSync(destination).size;
  return { files: files.length, bytes, sha256 };
}

export interface VerifyResult {
  ok: boolean;
  files: number;
  error?: string;
}

/** Read the archive and check every stored hash. Does not write a data folder. */
export function verifyDataArchive(archive: string): VerifyResult {
  let fd: number;
  try {
    fd = openSync(resolve(archive), "r");
  } catch {
    return { ok: false, files: 0, error: "The archive could not be read." };
  }
  try {
    const magic = readExact(fd, MAGIC.length);
    if (!magic.equals(MAGIC)) return { ok: false, files: 0, error: "This is not a sagax backup." };
    let header = "";
    const one = Buffer.alloc(1);
    for (;;) {
      const read = readSync(fd, one, 0, 1, null);
      if (read === 0) return { ok: false, files: 0, error: "The archive has no file list." };
      if (one[0] === 0x0a) break;
      header += one.toString("utf8");
      if (header.length > 8_000_000) return { ok: false, files: 0, error: "The file list is too large." };
    }
    const parsed = JSON.parse(header) as { v?: number; files?: ArchiveFile[] };
    if (parsed.v !== 1 || !Array.isArray(parsed.files)) return { ok: false, files: 0, error: "This backup version is not supported." };
    for (const file of parsed.files) {
      const rel = safeRelative(file.path);
      if (!rel || rel !== file.path) return { ok: false, files: parsed.files.length, error: "The archive names a path outside the data folder." };
      if (!Number.isInteger(file.bytes) || file.bytes < 0) return { ok: false, files: parsed.files.length, error: "The archive has a bad file size." };
      const body = readExact(fd, file.bytes);
      const hash = createHash("sha256").update(body).digest("hex");
      if (hash !== file.sha256) return { ok: false, files: parsed.files.length, error: `"${file.path}" does not match its hash.` };
    }
    return { ok: true, files: parsed.files.length };
  } catch (error) {
    return { ok: false, files: 0, error: error instanceof Error ? error.message : "The archive could not be checked." };
  } finally {
    closeSync(fd);
  }
}

/** Write the archive into dataDir. Refuses unless apply is true. Verify still runs first. */
export function restoreDataArchive(archive: string, dataDir: string, apply: boolean): VerifyResult & { applied?: boolean } {
  const checked = verifyDataArchive(archive);
  if (!checked.ok || !apply) return checked;
  const fd = openSync(resolve(archive), "r");
  try {
    readExact(fd, MAGIC.length);
    let header = "";
    const one = Buffer.alloc(1);
    for (;;) {
      readSync(fd, one, 0, 1, null);
      if (one[0] === 0x0a) break;
      header += one.toString("utf8");
    }
    const parsed = JSON.parse(header) as { files: ArchiveFile[] };
    const root = resolve(dataDir);
    mkdirSync(root, { recursive: true });
    for (const file of parsed.files) {
      const body = readExact(fd, file.bytes);
      const target = resolve(root, file.path);
      if (relative(root, target).startsWith("..") || relative(root, target) === "") throw new Error("The archive names a path outside the data folder.");
      mkdirSync(dirname(target), { recursive: true });
      const temp = `${target}.restore-tmp`;
      const out = openSync(temp, "w", file.mode & 0o777);
      try {
        writeAll(out, body);
      } finally {
        closeSync(out);
      }
      // rename is the replace. It happens only because --apply was passed.
      renameSync(temp, target);
    }
  } finally {
    closeSync(fd);
  }
  return { ...checked, applied: true };
}
