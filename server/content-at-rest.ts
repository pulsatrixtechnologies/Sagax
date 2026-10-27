// Content encryption at rest for what lives outside messages.db: bot memory
// files, attachments (and the copies made from them) and the event logs
// (docs/content-encryption.md, "Files and logs"). Same keys as the
// transcripts (server/message-db.ts keyring, content_keys): no second key
// store.
//
// Files are sealed IN PLACE (server/content-file-crypto.ts): same path, a
// sealed header instead of the plain bytes. Every reader in the server opens
// both kinds (readAtRestSync, atRestStream, atRestSizeSync). An engine, a
// separate process reading the path itself, gets the plain file while it
// works: holdPlain() opens the files of a turn back in place before the turn
// starts and releasePlain() hands them back at its end; the migration seals
// them again once nothing holds them and they have been idle for a while
// (GRACE_MS). A new or edited file is written plain, as before, and sealed
// by the same migration a moment later: no write path waits on encryption.
//
// The migration (a background loop, a few milliseconds of work then a
// pause) seals plain files, re-seals a file whose key should change, and,
// with SAGAX_CONTENT_ENCRYPTION=off, opens everything back to plain. Every
// replacement writes a sibling copy, reads it back and compares it byte for
// byte with the original, checks the original did not change meanwhile,
// then renames the copy over it (atomic): a failure, a locked key or a key
// provider that does not answer leaves the original exactly as it was.
//
// Log lines (NDJSON) are sealed one by one (sealLogLine): a small projection
// stays in the clear for the readers' filters, the line itself under its
// thread's (or bot's, or the workspace's) key. A log file is migrated the
// same way: a copy, verified line by line, renamed over the original, with
// the lines appended meanwhile carried over.
import { createHash, createSecretKey, randomUUID } from "node:crypto";
import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
  appendFileSync,
  type Stats,
} from "node:fs";
import { appendFile, chmod, link, lstat, open as openHandle, rename, unlink, utimes, type FileHandle } from "node:fs/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { Readable } from "node:stream";

import { DATA_DIR } from "./config.ts";
import { ContentSealError } from "./content-crypto.ts";
import type { ExportedContentKey } from "./content-export.ts";
import { ContentKeyUnavailable, WORKSPACE_OWNER, type LiveKey } from "./content-keys.ts";
import {
  CHUNK_OVERHEAD,
  FileSealer,
  chunkCount,
  looksSealed,
  openBuffer,
  openChunk,
  openLine,
  SEALED_LINE_FIELD,
  parseHeader,
  plainSizeOf,
  sealBuffer,
  sealLine,
  sealedLineKeyId,
  type FileKey,
  type SealedHeader,
} from "./content-file-crypto.ts";
import { contentAutoMigrate, contentEncryptionOn, contentKeyById, contentKeyForBot, contentKeyForOwner, contentKeyForThread, onContentAtRest } from "./message-db.ts";

export type ContentScope = { thread: string } | { bot: string } | { owner: string };

/** A sealed file whose key was destroyed (its owner erased): it reads as a
 * file that is not there. */
export class ContentErased extends Error {
  readonly code = "ENOENT";
  constructor() {
    super("This content was erased.");
  }
}

/** An error that must never read as an empty or missing file: a key locked
 * on this launch, or a sealed file that does not open here. A caller that
 * would write over what it read (a memory update) must let it through. */
export function isAtRestRefusal(error: unknown): boolean {
  return error instanceof ContentKeyUnavailable || error instanceof ContentSealError;
}

// ---------------------------------------------------------------------------
// Keys

let exported: { keys: Map<string, FileKey>; stored: Set<string> } | null = null;

/** A backup worker opens with the keys the server handed it (in memory),
 * never with the live keyring. `stored`: every key id the database had, so
 * a key that exists but was not handed over fails the backup instead of
 * reading as erased. Null restores the keyring. */
export function useExportedContentKeys(keys: readonly ExportedContentKey[] | null, stored: Iterable<string> = []): void {
  exported = keys
    ? { keys: new Map(keys.map((key) => [key.keyId, { keyId: key.keyId, owner: key.owner, dek: createSecretKey(Buffer.from(key.raw)) }])), stored: new Set(stored) }
    : null;
}

const fileKeys = new WeakMap<LiveKey, FileKey>();
function asFileKey(key: LiveKey): FileKey {
  let out = fileKeys.get(key);
  if (!out) fileKeys.set(key, (out = { keyId: key.keyId, owner: key.owner, dek: key.dek }));
  return out;
}

function keyById(keyId: string): FileKey | "destroyed" | null {
  if (exported) {
    const key = exported.keys.get(keyId);
    if (key) return key;
    return exported.stored.has(keyId) ? null : "destroyed";
  }
  const key = contentKeyById(keyId);
  return key === "destroyed" || key === null ? key : asFileKey(key);
}

/** The key new content of this scope is sealed with; null: write it plain
 * (encryption off, the key not available yet). */
export function sealingKey(scope: ContentScope): FileKey | null {
  if (exported) return null;
  const live = "thread" in scope ? contentKeyForThread(scope.thread) : "bot" in scope ? contentKeyForBot(scope.bot) : contentKeyForOwner(scope.owner);
  return live ? asFileKey(live) : null;
}

function openingKey(keyId: string): FileKey {
  const key = keyById(keyId);
  if (key === "destroyed") throw new ContentErased();
  if (!key) throw new ContentKeyUnavailable();
  return key;
}

// ---------------------------------------------------------------------------
// Where sealed files live: a root and the context its files are bound to

interface AtRestRoot {
  id: string;
  dir: string;
  /** the context of a file, from its path under `dir` (posix separators) */
  context(relativePath: string): string;
  /** the files the migration looks after, with whose key each takes */
  files(): Iterable<{ path: string; scope: ContentScope }>;
  /** at an owner's erasure: whether a file sealed under their key is still
   * someone else's (re-sealed under its scope) rather than theirs (erased).
   * Absent: re-sealed when its scope's key is another's. */
  keepOnErase?(path: string): boolean;
  /** a sealed file keeps the key it was sealed with (its owner is known only
   * when it is written: an upload's person) instead of following its scope */
  stickyKeys?: boolean;
}

const roots: AtRestRoot[] = [];

/** server/workspace.ts (memory) and server/attachments.ts register theirs. */
export function registerAtRestRoot(root: AtRestRoot): void {
  const index = roots.findIndex((entry) => entry.id === root.id);
  if (index >= 0) roots[index] = root;
  else roots.push(root);
  scheduleAtRest();
}

const realRoots = new Map<string, string>();
function realDir(dir: string): string {
  let real = realRoots.get(dir);
  if (real === undefined) {
    try { real = realpathSync(dir); } catch { return dir; }
    realRoots.set(dir, real);
  }
  return real;
}

function under(dir: string, path: string): string | null {
  const rel = relative(dir, path);
  return rel && !rel.startsWith("..") && !rel.startsWith(sep) && !/^[A-Za-z]:/.test(rel) ? rel.split(sep).join("/") : null;
}

/** The root a path is in, by its spelling or by the root's real path (a
 * caller that resolved links, /var and /private/var on macOS). */
function rootOf(path: string): { root: AtRestRoot; relativePath: string } | null {
  for (const root of roots) {
    const rel = under(root.dir, path) ?? under(realDir(root.dir), path);
    if (rel) return { root, relativePath: rel };
  }
  return null;
}

/** The context a file at `path` is sealed under: what it is, so a sealed
 * file moved elsewhere does not open. */
export function contextFor(path: string): string {
  const found = rootOf(path);
  return found ? found.root.context(found.relativePath) : `file:${basename(path)}`;
}

/** The temporary sibling of a replacement: hidden, never listed as content. */
const TEMP_SUFFIX = ".sgx-tmp";
export function isAtRestTemp(name: string): boolean {
  return name.endsWith(TEMP_SUFFIX);
}
const tempFor = (path: string) => join(dirname(path), `.${basename(path)}.${randomUUID().slice(0, 8)}${TEMP_SUFFIX}`);

// ---------------------------------------------------------------------------
// Reading files, sealed or plain

/** Open sealed bytes (a whole small file); plain bytes come back as they are. */
export function openIfSealed(bytes: Buffer, path: string): Buffer {
  // only the folders sealed at rest hold sealed files: anything else is read as it is
  if (!looksSealed(bytes) || !rootOf(path)) return bytes;
  const header = parseHeader(bytes)!;
  return openBuffer(bytes, openingKey(header.keyId), contextFor(path));
}

/** readFileSync for a file that may be sealed (small files: memory, a
 * manifest, a picture). Throws like readFileSync; ContentErased (ENOENT)
 * for erased content, ContentKeyUnavailable (503) when its key is locked. */
export function readAtRestSync(path: string, fd?: number): Buffer {
  return openIfSealed(readFileSync(fd ?? path), path);
}

export function readAtRestTextSync(path: string, fd?: number): string {
  return readAtRestSync(path, fd).toString("utf8");
}

export async function readAtRest(path: string): Promise<Buffer> {
  const handle = await openHandle(path, "r");
  try {
    const file = await describeHandle(handle, path);
    if (!file.sealed) return await handle.readFile();
    const parts: Buffer[] = [];
    for await (const part of plainChunks(handle, file, 0, file.size - 1)) parts.push(part);
    return Buffer.concat(parts);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function headerOfFd(fd: number, size: number): SealedHeader | null {
  if (size < 5) return null;
  const head = Buffer.allocUnsafe(Math.min(size, 512));
  const read = readSync(fd, head, 0, head.length, 0);
  if (!looksSealed(head.subarray(0, read))) return null;
  try { return parseHeader(head.subarray(0, read)); }
  catch {
    const longer = Buffer.allocUnsafe(Math.min(size, 9 + 255 + 65535));
    const n = readSync(fd, longer, 0, longer.length, 0);
    return parseHeader(longer.subarray(0, n));
  }
}

/** Whether a file is sealed, and its plaintext size. Null when missing. */
export function atRestInfoSync(path: string): { sealed: boolean; size: number; keyId: string | null; stat: Stats } | null {
  let fd: number;
  try { fd = openSync(path, "r"); } catch { return null; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) return null;
    const header = rootOf(path) ? headerOfFd(fd, stat.size) : null;
    if (!header) return { sealed: false, size: stat.size, keyId: null, stat };
    return { sealed: true, size: plainSizeOf(header, stat.size), keyId: header.keyId, stat };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

const sizeCache = new Map<string, { ino: number; size: number; mtimeMs: number; plain: number }>();
/** The plaintext size of a file whose stat the caller already holds: from
 * a cache while the file is unchanged (a listing stats every file, and
 * would otherwise open each one again). */
export function plainSizeFor(path: string, stat: Pick<Stats, "ino" | "size" | "mtimeMs">): number {
  if (stat.size < 5) return stat.size;
  const known = sizeCache.get(path);
  if (known && known.ino === stat.ino && known.size === stat.size && known.mtimeMs === stat.mtimeMs) return known.plain;
  const info = atRestInfoSync(path);
  const plain = info?.size ?? stat.size;
  if (sizeCache.size > 20_000) sizeCache.clear();
  sizeCache.set(path, { ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, plain });
  return plain;
}

/** The plaintext size of a file (its own size when plain). */
export function atRestSizeSync(path: string): number {
  const info = atRestInfoSync(path);
  if (!info) throw Object.assign(new Error(`ENOENT: no such file, '${path}'`), { code: "ENOENT" });
  return info.size;
}

export interface AtRestHandleFile {
  sealed: boolean;
  /** plaintext bytes */
  size: number;
  header: SealedHeader | null;
  fileSize: number;
  key: FileKey | null;
  context: string;
}

/** What an open handle holds; throws ContentErased / ContentKeyUnavailable. */
export async function describeHandle(handle: FileHandle, path: string): Promise<AtRestHandleFile> {
  const stat = await handle.stat();
  const context = contextFor(path);
  if (stat.size < 5) return { sealed: false, size: stat.size, header: null, fileSize: stat.size, key: null, context };
  // only the folders sealed at rest hold sealed files: anything else is read as it is
  if (!rootOf(path)) return { sealed: false, size: stat.size, header: null, fileSize: stat.size, key: null, context };
  const head = Buffer.allocUnsafe(Math.min(stat.size, 512));
  const { bytesRead } = await handle.read(head, 0, head.length, 0);
  if (!looksSealed(head.subarray(0, bytesRead))) return { sealed: false, size: stat.size, header: null, fileSize: stat.size, key: null, context };
  let header: SealedHeader | null;
  try { header = parseHeader(head.subarray(0, bytesRead)); }
  catch {
    const longer = Buffer.allocUnsafe(Math.min(stat.size, 9 + 255 + 65535));
    const again = await handle.read(longer, 0, longer.length, 0);
    header = parseHeader(longer.subarray(0, again.bytesRead));
  }
  if (!header) return { sealed: false, size: stat.size, header: null, fileSize: stat.size, key: null, context };
  if (header.context !== context) throw new ContentSealError("unreadable");
  return { sealed: true, size: plainSizeOf(header, stat.size), header, fileSize: stat.size, key: openingKey(header.keyId), context };
}

/** The plaintext of [start, end] (inclusive) of a sealed file, chunk by
 * chunk: only the chunks the range covers are read and opened. */
async function* plainChunks(handle: FileHandle, file: AtRestHandleFile, start: number, end: number): AsyncGenerator<Buffer> {
  if (end < start) return;
  const header = file.header!;
  const stride = header.chunkBytes + CHUNK_OVERHEAD;
  const count = chunkCount(header, file.fileSize);
  const first = Math.floor(start / header.chunkBytes);
  const last = Math.min(count - 1, Math.floor(end / header.chunkBytes));
  // up to 16 chunks (1 MiB) per read: fewer system calls on a long file
  const batch = Buffer.allocUnsafe(stride * Math.min(16, last - first + 1));
  for (let index = first; index <= last;) {
    const n = Math.min(16, last - index + 1);
    const offset = header.length + index * stride;
    const length = Math.min(stride * n, file.fileSize - offset);
    let filled = 0;
    while (filled < length) {
      const { bytesRead } = await handle.read(batch, filled, length - filled, offset + filled);
      if (bytesRead === 0) throw new ContentSealError("malformed");
      filled += bytesRead;
    }
    for (let k = 0; k < n; k++, index++) {
      const sealed = batch.subarray(k * stride, Math.min(length, (k + 1) * stride));
      const plain = openChunk(file.key!, header.context, index, index === count - 1, sealed);
      const chunkStart = index * header.chunkBytes;
      const from = Math.max(0, start - chunkStart);
      const to = Math.min(plain.length, end - chunkStart + 1);
      yield from === 0 && to === plain.length ? plain : plain.subarray(from, to);
    }
  }
}

/** A readable of the plaintext [start, end] of an open file, sealed or
 * plain. The handle is closed when the stream ends or is destroyed. */
export function atRestStream(handle: FileHandle, file: AtRestHandleFile, start = 0, end = file.size - 1, autoClose = true): Readable {
  if (!file.sealed) return handle.createReadStream({ start, end, autoClose });
  const source = plainChunks(handle, file, start, end);
  const close = () => { if (autoClose) void handle.close().catch(() => undefined); };
  const stream = Readable.from((async function* () {
    try { yield* source; } finally { close(); }
  })(), { objectMode: false });
  stream.on("close", () => { void source.return(undefined).catch(() => undefined); close(); });
  return stream;
}

/** The whole plaintext of an open file (small files only). */
export async function readAllFromHandle(handle: FileHandle, file: AtRestHandleFile): Promise<Buffer> {
  if (!file.sealed) return await handle.readFile();
  const parts: Buffer[] = [];
  for await (const part of plainChunks(handle, file, 0, file.size - 1)) parts.push(part);
  return Buffer.concat(parts);
}

/** The plaintext of a file as chunks (a copy to another machine, a hash). */
export async function* atRestChunks(path: string): AsyncGenerator<Buffer> {
  const handle = await openHandle(path, "r");
  try {
    const file = await describeHandle(handle, path);
    if (!file.sealed) {
      const buffer = Buffer.allocUnsafe(256 * 1024);
      for (let position = 0; ;) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        position += bytesRead;
        yield Buffer.from(buffer.subarray(0, bytesRead));
      }
      return;
    }
    yield* plainChunks(handle, file, 0, file.size - 1);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Replacing a file in place, verified

const locks = new Map<string, Promise<unknown>>();
function withLock<T>(path: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(path) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(work);
  const tail = run.catch(() => undefined);
  locks.set(path, tail);
  void tail.then(() => { if (locks.get(path) === tail) locks.delete(path); });
  return run;
}

/** Two chunk streams hold the same bytes. */
async function sameBytes(a: AsyncIterable<Buffer>, b: AsyncIterable<Buffer>): Promise<boolean> {
  const left = a[Symbol.asyncIterator]();
  const right = b[Symbol.asyncIterator]();
  let x: Buffer = Buffer.alloc(0);
  let y: Buffer = Buffer.alloc(0);
  let doneX = false;
  let doneY = false;
  try {
    for (;;) {
      while (!doneX && x.length < 65536) {
        const next = await left.next();
        if (next.done) doneX = true;
        else x = x.length ? Buffer.concat([x, next.value]) : next.value;
      }
      while (!doneY && y.length < 65536) {
        const next = await right.next();
        if (next.done) doneY = true;
        else y = y.length ? Buffer.concat([y, next.value]) : next.value;
      }
      const n = Math.min(x.length, y.length);
      if (n === 0) return doneX && doneY && x.length === 0 && y.length === 0;
      if (!x.subarray(0, n).equals(y.subarray(0, n))) return false;
      x = x.subarray(n);
      y = y.subarray(n);
    }
  } finally {
    await left.return?.(undefined);
    await right.return?.(undefined);
  }
}

/** Run `work` while no migration rewrites `file` (a log's own rewrite). */
export function withLogFileLock<T>(file: string, work: () => Promise<T>): Promise<T> {
  return withLock(file, work);
}

let testFault: ((temp: string, original: string) => void) | null = null;
/** Test seam: called between writing a replacement and reading it back. */
export function setAtRestFaultForTests(fault: ((temp: string, original: string) => void) | null): void {
  testFault = fault;
}

export type ReplaceOutcome = "done" | "changed" | "held" | "locked" | "skipped";

const sameFile = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;

/** Rewrite one file in place: sealed under `to` (a key), or plain (`to`
 * null). Reads the original as plaintext (opening it if sealed), writes a
 * sibling, reads the sibling back and compares it with the original byte
 * for byte, checks the original is unchanged and not held by a turn, then
 * renames. Anything else leaves the original untouched. */
/** Opening a file for a turn skips the fsync (a turn must not wait on
 * the disk): the sealed original stays as a hard link here until the file
 * is sealed again, so a power cut that leaves the plain copy empty or
 * zeroed restores it (recoverOriginal). */
const ORIGINALS_DIR = () => join(DATA_DIR, ".at-rest-originals");
const originalOf = (path: string) => join(ORIGINALS_DIR(), createHash("sha256").update(path).digest("hex"));

/** Drop the kept original of a file that was sealed again or removed. */
function forgetOriginal(path: string): void {
  try { unlinkSync(originalOf(path)); } catch { /* none */ }
  try { unlinkSync(`${originalOf(path)}.path`); } catch { /* none */ }
}

/** Originals whose file is gone (a bot, a thread or an upload deleted):
 * removed, so nothing sealed outlives what it was a copy of. */
function sweepOriginals(): void {
  let names: string[];
  try { names = readdirSync(ORIGINALS_DIR()); } catch { return; }
  for (const name of names) {
    if (!name.endsWith(".path")) continue;
    let path: string;
    try { path = readFileSync(join(ORIGINALS_DIR(), name), "utf8"); } catch { continue; }
    if (!held(path)) recoverOriginal(path);
  }
}

/** A plain copy that a power cut left empty or zeroed gets its sealed
 * original back; a file removed meanwhile lets the original go. */
function recoverOriginal(path: string): void {
  const original = originalOf(path);
  let kept: Stats;
  try { kept = lstatSync(original); } catch { return; }
  if (!kept.isFile()) return;
  let current: Stats | null = null;
  try { current = lstatSync(path); } catch { current = null; }
  if (!current) { forgetOriginal(path); return; }
  let torn = current.size === 0;
  if (!torn && current.size <= 64 * 1024 * 1024) {
    try { torn = !readFileSync(path).some((byte) => byte !== 0); } catch { torn = false; }
  }
  if (torn) {
    try { renameSync(original, path); } catch { return; /* left for the next pass */ }
    try { unlinkSync(`${original}.path`); } catch { /* none */ }
  }
}

export function replaceInPlace(path: string, to: FileKey | null, options: { quick?: boolean } = {}): Promise<ReplaceOutcome> {
  return withLock(path, async () => {
    let before: Stats;
    try { before = await lstat(path); } catch { return "skipped"; }
    if (!before.isFile()) return "skipped";
    const context = contextFor(path);
    const temp = tempFor(path);
    let out: FileHandle | null = null;
    try {
      const source = await openHandle(path, "r");
      let file: AtRestHandleFile;
      try {
        try { file = await describeHandle(source, path); }
        catch (error) { return error instanceof ContentKeyUnavailable ? "locked" : "skipped"; }
        if (!file.sealed && !to) return "skipped";
        if (file.sealed && to && file.header!.keyId === to.keyId) return "skipped";
        out = await openHandle(temp, "wx", 0o600);
        const sealer = to ? new FileSealer(to, context) : null;
        const write = async (parts: Buffer[]) => { for (const part of parts) await out!.write(part); };
        const chunks = file.sealed ? plainChunks(source, file, 0, file.size - 1) : atRestChunksOfHandle(source, file.size);
        for await (const chunk of chunks) await write(sealer ? sealer.push(chunk) : [chunk]);
        if (sealer) await write(sealer.end());
        if (!options.quick || to) await out.sync();
        await out.close();
        out = null;
      } finally {
        await source.close().catch(() => undefined);
      }
      testFault?.(temp, path);
      // read back: the copy opens to exactly the original's bytes
      if (!(await sameBytes(atRestChunksExpecting(temp, context, to?.keyId ?? null), atRestChunks(path)))) return "skipped";
      // never sealed while a turn holds it plain (opening it is what a hold wants)
      if (to && held(path)) return "held";
      let now: Stats;
      try { now = await lstat(path); } catch { return "changed"; }
      if (!sameFile(before, now)) return "changed";
      await chmod(temp, before.mode & 0o777);
      await utimes(temp, before.atimeMs / 1000, before.mtimeMs / 1000);
      let kept = false;
      if (options.quick && !to) {
        // the sealed original, kept (a link: no copy) until sealed again
        try {
          mkdirSync(ORIGINALS_DIR(), { recursive: true, mode: 0o700 });
          forgetOriginal(path);
          await link(path, originalOf(path));
          writeFileSync(`${originalOf(path)}.path`, path, { mode: 0o600 });
          kept = true;
        } catch {
          // no hard links on this disk: the copy is made durable instead
          const handle = await openHandle(temp, "r+");
          try { await handle.sync(); } finally { await handle.close(); }
        }
      }
      await rename(temp, path);
      if (!kept) forgetOriginal(path);
      return "done";
    } catch {
      return "skipped";
    } finally {
      if (out) await out.close().catch(() => undefined);
      await unlink(temp).catch(() => undefined);
    }
  });
}

async function* atRestChunksOfHandle(handle: FileHandle, size: number): AsyncGenerator<Buffer> {
  const buffer = Buffer.allocUnsafe(256 * 1024);
  for (let position = 0; position < size;) {
    const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, size - position), position);
    if (!bytesRead) break;
    position += bytesRead;
    yield Buffer.from(buffer.subarray(0, bytesRead));
  }
}

/** The copy's plaintext, refusing a copy that is not what was asked for. */
async function* atRestChunksExpecting(path: string, context: string, keyId: string | null): AsyncGenerator<Buffer> {
  const handle = await openHandle(path, "r");
  try {
    const stat = await handle.stat();
    const head = Buffer.allocUnsafe(Math.min(stat.size, 512));
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    const sealed = looksSealed(head.subarray(0, bytesRead));
    if (sealed !== (keyId !== null)) throw new ContentSealError("malformed");
    if (!sealed) { yield* atRestChunksOfHandle(handle, stat.size); return; }
    const header = parseHeader(head.subarray(0, bytesRead))!;
    if (header.context !== context || header.keyId !== keyId) throw new ContentSealError("malformed");
    yield* plainChunks(handle, { sealed: true, size: plainSizeOf(header, stat.size), header, fileSize: stat.size, key: openingKey(header.keyId), context }, 0, plainSizeOf(header, stat.size) - 1);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** The synchronous replacement, for small files (memory) where a turn
 * cannot wait: same steps, same verification. */
export function replaceInPlaceSync(path: string, to: FileKey | null): ReplaceOutcome {
  let before: Stats;
  try { before = lstatSync(path); } catch { return "skipped"; }
  if (!before.isFile()) return "skipped";
  const context = contextFor(path);
  let original: Buffer;
  let plain: Buffer;
  try {
    original = readFileSync(path);
    plain = openIfSealed(original, path);
  } catch (error) {
    return error instanceof ContentKeyUnavailable ? "locked" : "skipped";
  }
  const sealedNow = plain !== original;
  if (!sealedNow && !to) return "skipped";
  if (sealedNow && to && parseHeader(original)!.keyId === to.keyId) return "skipped";
  const next = to ? sealBuffer(to, context, plain) : plain;
  const temp = tempFor(path);
  let fd: number | null = null;
  try {
    fd = openSync(temp, "wx", 0o600);
    for (let written = 0; written < next.length;) written += writeSync(fd, next, written, next.length - written);
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    // read back: the copy opens to exactly the original's bytes
    const copy = readFileSync(temp);
    const reopened = to ? openBuffer(copy, to, context) : copy;
    if (!reopened.equals(plain)) return "skipped";
    if (to && parseHeader(copy)?.keyId !== to.keyId) return "skipped";
    if (to && held(path)) return "held";
    const now = lstatSync(path);
    if (!sameFile(before, now)) return "changed";
    utimesSync(temp, before.atimeMs / 1000, before.mtimeMs / 1000);
    renameSync(temp, path);
    forgetOriginal(path);
    return "done";
  } catch {
    return "skipped";
  } finally {
    if (fd !== null) { try { closeSync(fd); } catch { /* closed */ } }
    try { unlinkSync(temp); } catch { /* renamed or never made */ }
  }
}

// ---------------------------------------------------------------------------
// Plain while a turn works on it

/** How long a file stays plain after its last use or write before the
 * migration seals it: a conversation's next turn usually comes sooner, so
 * its files are opened once per stretch of work, not at every turn. */
export const GRACE_MS = 10 * 60_000;
const holders = new Map<string, Set<string>>();
/** A turn that never said it ended (a crash of its engine) lets go after this. */
const HOLD_MAX_MS = 6 * 60 * 60_000;
const holderSince = new Map<string, number>();
/** A turn that set up its files but never started (refused, cancelled)
 * lets go once this old if its holder is no longer running. */
const HOLD_SETUP_MS = 10 * 60_000;
let holderAlive: (holder: string) => boolean = () => true;

/** server/index.ts: whether a holder's turn still runs. */
export function setAtRestHolderCheck(alive: (holder: string) => boolean): void {
  holderAlive = alive;
}
const holdCount = new Map<string, number>();
const lastUse = new Map<string, number>();
/** SAGAX_CONTENT_AT_REST_GRACE_MS: another idle time before sealing (a
 * verification fixture uses a second). */
const graceFromEnv = Number(process.env.SAGAX_CONTENT_AT_REST_GRACE_MS?.trim() || NaN);
let graceMs = Number.isInteger(graceFromEnv) && graceFromEnv >= 0 ? graceFromEnv : GRACE_MS;

/** Test seam. */
export function setAtRestGrace(ms: number): void {
  graceMs = ms;
}

function held(path: string): boolean {
  return (holdCount.get(path) ?? 0) > 0;
}

function hold(holder: string, paths: readonly string[]): string[] {
  let set = holders.get(holder);
  if (!set) holders.set(holder, (set = new Set()));
  holderSince.set(holder, Date.now());
  const added: string[] = [];
  for (const path of paths) {
    if (set.has(path)) continue;
    set.add(path);
    holdCount.set(path, (holdCount.get(path) ?? 0) + 1);
    added.push(path);
  }
  return added;
}

/** Files an engine reads by path during a turn (`holder`: the thread):
 * opened back to plain in place now, kept plain until releasePlain. Small
 * files only (memory); attachments go through holdPlain. */
export function holdPlainSync(holder: string, paths: readonly string[]): void {
  for (const path of hold(holder, paths)) {
    const info = atRestInfoSync(path);
    if (info?.sealed) replaceInPlaceSync(path, null);
  }
}

/** The same for files of any size, opened as streams. */
export async function holdPlain(holder: string, paths: readonly string[]): Promise<void> {
  const added = hold(holder, paths);
  await Promise.all(added.map(async (path) => {
    const info = atRestInfoSync(path);
    if (info?.sealed) await replaceInPlace(path, null, { quick: true });
  }));
}

/** The turn ended: its files are sealed again once idle (GRACE_MS). */
export function releasePlain(holder: string): void {
  const set = holders.get(holder);
  if (!set) return;
  holders.delete(holder);
  holderSince.delete(holder);
  const now = Date.now();
  for (const path of set) {
    const count = (holdCount.get(path) ?? 1) - 1;
    if (count > 0) holdCount.set(path, count);
    else holdCount.delete(path);
    lastUse.set(path, now);
  }
  scheduleAtRest(graceMs + 50);
}

/** A file written plain by the server (an upload, a memory edit): sealed
 * once idle. `scope` overrides its root's default key (the uploader). */
export function noteAtRestWrite(path: string, scope?: ContentScope): void {
  lastUse.set(path, Date.now());
  if (scope) scopeHints.set(path, scope);
  scheduleAtRest(graceMs + 50);
}
const scopeHints = new Map<string, ContentScope>();

/** Whose key a file takes: a hint left by its writer, else its root's. */
function scopeFor(path: string, fallback: ContentScope): ContentScope {
  return scopeHints.get(path) ?? fallback;
}

// ---------------------------------------------------------------------------
// Log lines

interface SealedLogSpec {
  dir: string;
  /** whose key a record takes (its thread, its bot, the workspace) */
  scope(record: Record<string, unknown>, file: string): ContentScope;
  /** the fields a reader filters on before opening, kept in the clear */
  projection(record: Record<string, unknown>): Record<string, unknown>;
}

const logs: SealedLogSpec[] = [];

/** A log whose lines are sealed: harness/bus.ts (events/), drivers/native.ts
 * (native/), memory-journal.ts, decision-log.ts, admin-activity.ts. */
export function registerSealedLog(spec: SealedLogSpec): void {
  const index = logs.findIndex((entry) => entry.dir === spec.dir);
  if (index >= 0) logs[index] = spec;
  else logs.push(spec);
}

function logOf(file: string): SealedLogSpec | null {
  const dir = dirname(file);
  return logs.find((entry) => entry.dir === dir) ?? null;
}

/** The context of a log's lines: its folder and file name. */
export function logContext(file: string): string {
  return `${basename(dirname(file))}/${basename(file)}`;
}

/** One record as the line to append (no newline): sealed when the log is a
 * sealed one and its key is available, else the plain JSON as before. */
export function sealLogLine(file: string, record: Record<string, unknown>, line = JSON.stringify(record)): string {
  const spec = logOf(file);
  if (!spec) return line;
  let key: FileKey | null;
  try { key = sealingKey(spec.scope(record, file)); } catch { key = null; }
  if (!key) {
    if (contentEncryptionOn()) scheduleAtRest(graceMs + 50);
    return line;
  }
  return sealLine(key, logContext(file), line, spec.projection(record));
}

/** A parsed line as its original record: a plain record comes back as it
 * is; a sealed one opened. Null: erased (its key destroyed) or a line that
 * does not open here (copied from another log). Throws
 * ContentKeyUnavailable when its key is locked on this launch. */
export function openLogRecord(file: string, value: unknown): unknown {
  const keyId = sealedLineKeyId(value);
  if (!keyId) return value;
  const key = keyById(keyId);
  if (key === "destroyed") return null;
  if (!key) throw new ContentKeyUnavailable();
  try { return JSON.parse(openLine(value as Record<string, unknown>, key, logContext(file))); }
  catch { return null; }
}

const projected = new WeakSet<object>();
/** A sealed line a reader chose not to open: only its cleartext projection. */
export function isProjectedRecord(value: unknown): boolean {
  return typeof value === "object" && value !== null && projected.has(value);
}

/** JSON.parse of one raw line of a log, opened. Throws on a torn line
 * (SyntaxError) and a locked key (ContentKeyUnavailable), like a reader
 * expects; null when erased. `projectionOnly`: a sealed line whose clear
 * fields say the reader will not use it is not opened; its projection comes
 * back instead (isProjectedRecord), so it still counts where a plain line
 * would have. */
export function parseLogLine(file: string, raw: string, projectionOnly?: (projection: Record<string, unknown>) => boolean): unknown {
  const value: unknown = JSON.parse(raw);
  if (projectionOnly && sealedLineKeyId(value) && projectionOnly(value as Record<string, unknown>)) {
    const { [SEALED_LINE_FIELD]: _sealed, ...projection } = value as Record<string, unknown>;
    projected.add(projection);
    return projection;
  }
  return openLogRecord(file, value);
}

const inFlight = new Map<string, number>();

/** fs.promises.appendFile for a sealed log: the migration waits for an
 * append in progress before it replaces the file. */
export async function appendLog(file: string, data: string, options: { mode?: number } = {}): Promise<void> {
  inFlight.set(file, (inFlight.get(file) ?? 0) + 1);
  try { await appendFile(file, data, options); }
  finally {
    const left = (inFlight.get(file) ?? 1) - 1;
    if (left > 0) inFlight.set(file, left);
    else inFlight.delete(file);
  }
}

export function appendLogSync(file: string, data: string, options: { mode?: number } = {}): void {
  appendFileSync(file, data, options);
}

type LineAction = { line: string; changed: boolean };

/** One line as the migration wants it: sealed under its key (on), plain
 * (off). A line that does not parse, or a sealed line whose key is gone,
 * is kept exactly as it is. */
function migrateLine(spec: SealedLogSpec, file: string, raw: string, on: boolean, keep: { locked: boolean; plain: boolean }): LineAction {
  if (!raw) return { line: raw, changed: false };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { line: raw, changed: false }; }
  const keyId = sealedLineKeyId(value);
  let original = raw;
  let record = value as Record<string, unknown>;
  if (keyId) {
    const key = keyById(keyId);
    if (!key) { keep.locked = true; return { line: raw, changed: false }; }
    if (key === "destroyed") return { line: raw, changed: false };
    try { original = openLine(value as Record<string, unknown>, key, logContext(file)); record = JSON.parse(original) as Record<string, unknown>; }
    catch { return { line: raw, changed: false }; }
    if (on) {
      let want: FileKey | null = null;
      try { want = sealingKey(spec.scope(record, file)); } catch { want = null; }
      if (!want || want.keyId === keyId) return { line: raw, changed: false };
      return { line: sealLine(want, logContext(file), original, spec.projection(record)), changed: true };
    }
    return { line: original, changed: true };
  }
  if (!on || !record || typeof record !== "object") return { line: raw, changed: false };
  let want: FileKey | null = null;
  try { want = sealingKey(spec.scope(record, file)); } catch { want = null; }
  if (!want) { keep.plain = true; return { line: raw, changed: false }; }
  return { line: sealLine(want, logContext(file), raw, spec.projection(record)), changed: true };
}

/** What a migrated line opens to, for the read-back check. */
function plainOf(file: string, raw: string): string {
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return raw; }
  const keyId = sealedLineKeyId(value);
  if (!keyId) return raw;
  const key = keyById(keyId);
  if (!key || key === "destroyed") return raw;
  try { return openLine(value as Record<string, unknown>, key, logContext(file)); } catch { return raw; }
}

/** The lines of `file` from byte 0 to `end` (exclusive), read in chunks;
 * the last one may be a fragment (no newline yet). */
async function* linesOf(file: string, end: number): AsyncGenerator<{ line: string; complete: boolean }> {
  const handle = await openHandle(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let carry = "";
    for (let position = 0; position < end;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, end - position), position);
      if (!bytesRead) break;
      position += bytesRead;
      const parts = (carry + buffer.toString("utf8", 0, bytesRead)).split("\n");
      carry = parts.pop()!;
      for (const line of parts) yield { line, complete: true };
      // the loop's other work first
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (carry) yield { line: carry, complete: false };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** Rewrite one log file with its lines sealed (or opened). The copy is
 * read back and every line compared with the original's (what each opens
 * to, byte for byte) before it replaces anything; lines appended during the
 * copy are carried over (and checked) in a last short synchronous step. */
export function migrateLogFile(file: string, on: boolean): Promise<{ outcome: ReplaceOutcome; plainLeft: boolean }> {
  return withLock(file, async () => {
    const spec = logOf(file);
    if (!spec) return { outcome: "skipped" as const, plainLeft: false };
    let before: Stats;
    try { before = await lstat(file); } catch { return { outcome: "skipped" as const, plainLeft: false }; }
    if (!before.isFile()) return { outcome: "skipped" as const, plainLeft: false };
    const temp = tempFor(file);
    const keep = { locked: false, plain: false };
    let changed = 0;
    let out: FileHandle | null = null;
    try {
      // the complete lines present now; a fragment at the end waits for the last step
      let consumed = 0;
      let lineCount = 0;
      out = await openHandle(temp, "wx", 0o600);
      const pending: string[] = [];
      for await (const { line, complete } of linesOf(file, before.size)) {
        if (!complete) break;
        const action = migrateLine(spec, file, line, on, keep);
        if (action.changed) changed++;
        pending.push(`${action.line}\n`);
        consumed += Buffer.byteLength(line, "utf8") + 1;
        lineCount++;
        if (pending.length >= 512) { await out.write(pending.join("")); pending.length = 0; }
      }
      if (pending.length) await out.write(pending.join(""));
      if (!changed) return { outcome: "skipped" as const, plainLeft: keep.plain };
      await out.sync();
      testFault?.(temp, file);
      // read back: line for line, the copy opens to what the original does
      const copyLines = linesOf(temp, Number.MAX_SAFE_INTEGER)[Symbol.asyncIterator]();
      let compared = 0;
      for await (const { line } of linesOf(file, consumed)) {
        const copy = await copyLines.next();
        if (copy.done || plainOf(file, copy.value.line) !== plainOf(file, line)) { await copyLines.return?.(undefined); return { outcome: "skipped" as const, plainLeft: keep.plain }; }
        compared++;
      }
      const extra = await copyLines.next();
      await copyLines.return?.(undefined);
      if (!extra.done || compared !== lineCount) return { outcome: "skipped" as const, plainLeft: keep.plain };
      // the last step, synchronous: no append runs between it and the
      // rename (appendLog is waited for, appendLogSync cannot interleave)
      for (let tries = 0; inFlight.get(file) && tries < 200; tries++) await new Promise((resolve) => setTimeout(resolve, 5));
      if (inFlight.get(file)) return { outcome: "changed" as const, plainLeft: keep.plain };
      const now = lstatSync(file);
      if (now.dev !== before.dev || now.ino !== before.ino || now.size < consumed) return { outcome: "changed" as const, plainLeft: keep.plain };
      let tail = "";
      if (now.size > consumed) {
        const fd = openSync(file, "r");
        try {
          const rest = Buffer.allocUnsafe(now.size - consumed);
          let filled = 0;
          while (filled < rest.length) {
            const n = readSync(fd, rest, filled, rest.length - filled, consumed + filled);
            if (!n) break;
            filled += n;
          }
          tail = rest.toString("utf8", 0, filled);
        } finally { closeSync(fd); }
      }
      const tailLines = tail.split("\n");
      const torn = tailLines.pop()!;
      const appended: string[] = [];
      for (const raw of tailLines) {
        const action = migrateLine(spec, file, raw, on, keep);
        if (plainOf(file, action.line) !== plainOf(file, raw)) return { outcome: "skipped" as const, plainLeft: keep.plain };
        appended.push(`${action.line}\n`);
      }
      const fd = out.fd;
      const rest = Buffer.from(appended.join("") + torn, "utf8");
      for (let written = 0; written < rest.length;) written += writeSync(fd, rest, written, rest.length - written);
      if (rest.length) fsyncSync(fd);
      const last = lstatSync(file);
      if (last.ino !== now.ino || last.size !== now.size) return { outcome: "changed" as const, plainLeft: keep.plain };
      await out.close();
      out = null;
      renameSync(temp, file);
      return { outcome: "done" as const, plainLeft: keep.plain };
    } catch {
      return { outcome: "skipped" as const, plainLeft: keep.plain };
    } finally {
      if (out) await out.close().catch(() => undefined);
      await unlink(temp).catch(() => undefined);
    }
  });
}

/** Whether a log file still holds a plain line (on) or a sealed one (off),
 * from `offset`, read in chunks: the migration only rewrites the files that
 * need it. */
async function logNeedsWork(file: string, on: boolean, offset: number): Promise<{ needs: boolean; size: number }> {
  let size = 0;
  try { size = (await lstat(file)).size; } catch { return { needs: false, size: 0 }; }
  if (size <= offset) return { needs: false, size };
  try {
    let first = offset > 0;
    for await (const { line } of linesOfFrom(file, offset, size)) {
      // a check that starts mid-file skips its first (partial) line
      if (first) { first = false; continue; }
      if (!line) continue;
      const sealed = line.includes(`"${SEALED_LINE_FIELD}":"`);
      if (on && !sealed && line.startsWith("{")) return { needs: true, size };
      if (!on && sealed) return { needs: true, size };
    }
  } catch {
    return { needs: false, size: 0 };
  }
  return { needs: false, size };
}

async function* linesOfFrom(file: string, start: number, end: number): AsyncGenerator<{ line: string }> {
  const handle = await openHandle(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let carry = "";
    for (let position = start; position < end;) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, end - position), position);
      if (!bytesRead) break;
      position += bytesRead;
      const parts = (carry + buffer.toString("utf8", 0, bytesRead)).split("\n");
      carry = parts.pop()!;
      for (const line of parts) yield { line };
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (carry) yield { line: carry };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// The migration

const seen = new Map<string, { ino: number; size: number; mtimeMs: number; on: boolean; keyId: string | null }>();
const logSeen = new Map<string, { ino: number; size: number; on: boolean }>();
let timer: ReturnType<typeof setTimeout> | null = null;
let timerAt = 0;
let running: Promise<AtRestPass> | null = null;
let again = false;

export interface AtRestPass {
  sealed: number;
  opened: number;
  resealed: number;
  logs: number;
  /** files left for later: held by a turn, not idle yet, changed meanwhile */
  waiting: number;
  /** files or lines whose key is locked on this launch, or not created yet */
  locked: number;
  failed: number;
}

/** Slice of work and pause (the transcripts' migration takes the same). */
const SLICE_MS = 4;
const PAUSE_MS = 20;
const SAFETY_PASS_MS = 5 * 60_000;
const REPLACEMENTS_PER_PAUSE = 8;

function scheduleAtRest(delay = PAUSE_MS): void {
  if (!contentAutoMigrate()) return;
  if (running) { again = true; return; }
  // the sooner of the two: a safety pass minutes away never delays one asked for now
  if (timer) {
    if (timerAt <= Date.now() + delay) return;
    clearTimeout(timer);
  }
  timerAt = Date.now() + delay;
  timer = setTimeout(() => {
    timer = null;
    void runAtRestMigration().then((pass) => {
      if (again || pass.waiting || pass.locked) { again = false; scheduleAtRest(pass.waiting ? graceMs + 50 : SAFETY_PASS_MS); }
      else scheduleAtRest(SAFETY_PASS_MS);
    }, () => scheduleAtRest(SAFETY_PASS_MS));
  }, delay);
  timer.unref?.();
}

onContentAtRest({
  changed: () => { seen.clear(); logSeen.clear(); scheduleAtRest(); },
  beforeErase: (owner, keyIds) => resealBeforeErase(owner, keyIds),
});

/** One whole pass over every root and sealed log (tests and the bench call
 * it directly; the server runs it on timers). */
export function runAtRestMigration(options: { sliceMs?: number; pauseMs?: number } = {}): Promise<AtRestPass> {
  if (running) return running;
  running = (async () => {
    const pass: AtRestPass = { sealed: 0, opened: 0, resealed: 0, logs: 0, waiting: 0, locked: 0, failed: 0 };
    const slice = options.sliceMs ?? SLICE_MS;
    const pause = options.pauseMs ?? PAUSE_MS;
    let started = performance.now();
    // The work is mostly I/O on the thread pool, which leaves the event loop
    // free: give the loop a turn whenever a slice of synchronous checks has
    // run, and the pool a pause after every few replacements (or MiB).
    let units = 0;
    const breathe = async (cost = 0) => {
      units += cost;
      if (units >= REPLACEMENTS_PER_PAUSE) {
        units = 0;
        await new Promise((resolve) => setTimeout(resolve, pause));
        started = performance.now();
        return;
      }
      if (performance.now() - started < slice) return;
      await new Promise((resolve) => setImmediate(resolve));
      started = performance.now();
    };
    const on = contentEncryptionOn();
    // one key lookup per scope (a bot, an owner) per pass, not per file
    const wants = new Map<string, FileKey | null>();
    const wantFor = (scope: ContentScope): FileKey | null => {
      const id = "thread" in scope ? `t:${scope.thread}` : "bot" in scope ? `b:${scope.bot}` : `o:${scope.owner}`;
      if (!wants.has(id)) wants.set(id, sealingKeySafe(scope));
      return wants.get(id)!;
    };
    for (const [holder, since] of Array.from(holderSince)) {
      const age = Date.now() - since;
      let alive = true;
      try { alive = holderAlive(holder); } catch { alive = true; }
      if (age > HOLD_MAX_MS || (age > HOLD_SETUP_MS && !alive)) releasePlain(holder);
    }
    const dirs = new Set<string>();
    for (const root of roots.slice()) {
      let files: Iterable<{ path: string; scope: ContentScope }>;
      try { files = root.files(); } catch { continue; }
      // listed lazily: a long listing never holds the loop either
      for (const { path, scope } of files) {
        await breathe();
        dirs.add(dirname(path));
        if (!held(path)) recoverOriginal(path);
        let stat: Stats;
        try { stat = lstatSync(path); } catch { continue; }
        if (!stat.isFile()) continue;
        const known = seen.get(path);
        const unchanged = known && known.ino === stat.ino && known.size === stat.size && known.mtimeMs === stat.mtimeMs && known.on === on;
        if (unchanged && (!on || (root.stickyKeys && known.keyId))) continue;
        const want = on ? wantFor(scopeFor(path, scope)) : null;
        if (unchanged && known.keyId === (want?.keyId ?? known.keyId)) continue;
        const info = atRestInfoSync(path);
        if (!info) continue;
        const remember = (keyId: string | null) => seen.set(path, { ino: info.stat.ino, size: info.stat.size, mtimeMs: info.stat.mtimeMs, on, keyId });
        if (on) {
          if (info.sealed && (!want || root.stickyKeys || info.keyId === want.keyId)) { remember(info.keyId); continue; }
          if (!want) { pass.locked++; continue; }
          if (held(path) || Date.now() - Math.max(lastUse.get(path) ?? 0, info.sealed ? 0 : stat.mtimeMs) < graceMs) { pass.waiting++; continue; }
          await whilePaused();
          const outcome = await (current = replaceInPlace(path, want));
          await breathe(1 + stat.size / (1024 * 1024));
          if (outcome === "done") {
            if (info.sealed) pass.resealed++; else pass.sealed++;
            scopeHints.delete(path);
            const after = atRestInfoSync(path);
            if (after) seen.set(path, { ino: after.stat.ino, size: after.stat.size, mtimeMs: after.stat.mtimeMs, on, keyId: want.keyId });
          } else if (outcome === "locked") pass.locked++;
          else if (outcome === "held" || outcome === "changed") pass.waiting++;
          else pass.failed++;
        } else {
          if (!info.sealed) { remember(null); continue; }
          await whilePaused();
          const outcome = await (current = replaceInPlace(path, null));
          await breathe(1 + stat.size / (1024 * 1024));
          if (outcome === "done") {
            pass.opened++;
            const after = atRestInfoSync(path);
            if (after) seen.set(path, { ino: after.stat.ino, size: after.stat.size, mtimeMs: after.stat.mtimeMs, on, keyId: null });
          } else if (outcome === "locked") pass.locked++;
          else if (outcome === "held" || outcome === "changed") pass.waiting++;
          else pass.failed++;
        }
      }
    }
    for (const spec of logs.slice()) {
      let names: string[];
      try { names = readdirSync(spec.dir); } catch { continue; }
      for (const name of names) {
        if (!/\.ndjson(\.\d+)?$/.test(name) || isAtRestTemp(name)) continue;
        await breathe();
        const file = join(spec.dir, name);
        let stat: Stats;
        try { stat = statSync(file); } catch { continue; }
        const known = logSeen.get(file);
        const offset = known && known.ino === stat.ino && known.on === on && stat.size >= known.size ? known.size : 0;
        if (offset === stat.size) continue;
        const check = await logNeedsWork(file, on, offset);
        if (!check.needs) { logSeen.set(file, { ino: stat.ino, size: check.size, on }); continue; }
        await whilePaused();
        const result = await (current = migrateLogFile(file, on));
        await breathe(1 + stat.size / (1024 * 1024));
        if (result.outcome === "done") pass.logs++;
        else if (result.outcome === "changed") pass.waiting++;
        if (result.plainLeft) pass.locked++;
        if (result.outcome === "done" && !result.plainLeft) {
          try { const after = statSync(file); logSeen.set(file, { ino: after.ino, size: after.size, on }); } catch { /* gone */ }
        }
      }
    }
    for (const spec of logs) dirs.add(spec.dir);
    await cleanStaleTemps(dirs);
    sweepOriginals();
    return pass;
  })().finally(() => { running = null; });
  return running;
}

function sealingKeySafe(scope: ContentScope): FileKey | null {
  try { return sealingKey(scope); } catch { return null; }
}

/** A replacement interrupted by a crash leaves its hidden sibling: removed
 * once old (never the original). One folder at a time. */
async function cleanStaleTemps(dirs: Iterable<string>): Promise<void> {
  const now = Date.now();
  for (const dir of dirs) {
    let names: string[];
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      if (!isAtRestTemp(name)) continue;
      try {
        const path = join(dir, name);
        if (now - statSync(path).mtimeMs > 10 * 60_000 && !locks.has(path)) unlinkSync(path);
      } catch { /* gone */ }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Before an owner's keys are destroyed (eraseContentOwner): every file
 * sealed under one of them that now belongs to someone else (a bot that
 * changed hands, an upload another thread still uses) is re-sealed under
 * that key first; the rest stays sealed under the destroyed key: erased. */
function resealBeforeErase(owner: string, keyIds: readonly string[]): void {
  const doomed = new Set(keyIds);
  for (const root of roots) {
    let files: Array<{ path: string; scope: ContentScope }>;
    try { files = [...root.files()]; } catch { continue; }
    for (const { path, scope } of files) {
      const info = atRestInfoSync(path);
      if (!info?.sealed || !info.keyId || !doomed.has(info.keyId)) continue;
      const hint = scopeHints.get(path);
      if (hint && "owner" in hint && hint.owner === owner) continue;
      let keep = true;
      try { keep = root.keepOnErase ? root.keepOnErase(path) : true; } catch { keep = true; }
      if (!keep) continue;
      const target = sealingKeySafe(hint ?? scope);
      if (!target || doomed.has(target.keyId)) continue;
      replaceInPlaceSync(path, target);
    }
  }
  seen.clear();
}

// ---------------------------------------------------------------------------
// Backups: the archive carries plaintext (it is encrypted with its own
// password), the destination's migration seals it again under its keys.

/** The top-level folders whose `.ndjson` files are sealed logs. */
const LOG_FOLDERS = new Set(["events", "native", "memory-journal", "decisions", "admin-activity"]);

export class ContentExportLocked extends Error {
  constructor() {
    super("Some files are encrypted with a key this server cannot open right now; the backup was not made.");
  }
}

/** A key of the backup's set: known and handed over, known but locked
 * (fails the backup), or not one of ours (the bytes are copied as they are:
 * a person's own file that happens to look sealed, or erased content). */
function exportKey(keyId: string): FileKey | "locked" | "foreign" {
  if (exported) {
    const key = exported.keys.get(keyId);
    if (key) return key;
    return exported.stored.has(keyId) ? "locked" : "foreign";
  }
  const key = contentKeyById(keyId);
  if (key === "destroyed") return "foreign";
  return key ? asFileKey(key) : "locked";
}

/** Copy `source` to `destination` (created with `mode`) as plaintext when
 * it is sealed at rest: a sealed file, or a sealed log (`relativePath`,
 * posix, under the data folder). Null: nothing sealed, the caller copies
 * the bytes. Throws ContentExportLocked when a key is locked. */
export function exportPlainCopy(source: string, destination: string, relativePath: string, mode: number): { size: number; sha256: string } | null {
  const top = relativePath.split("/")[0]!;
  if (LOG_FOLDERS.has(top) && /\.ndjson(\.\d+)?$/.test(relativePath)) return exportPlainLog(source, destination, mode);
  const fd = openSync(source, "r");
  try {
    const size = fstatSync(fd).size;
    const header = (() => { try { return headerOfFd(fd, size); } catch { return null; } })();
    if (!header) return null;
    const key = exportKey(header.keyId);
    if (key === "foreign") return null;
    if (key === "locked") throw new ContentExportLocked();
    const out = openSync(destination, "wx", mode);
    try {
      const hash = createHash("sha256");
      const stride = header.chunkBytes + CHUNK_OVERHEAD;
      const count = chunkCount(header, size);
      const sealed = Buffer.allocUnsafe(stride);
      let total = 0;
      for (let index = 0; index < count; index++) {
        const offset = header.length + index * stride;
        const length = Math.min(stride, size - offset);
        let filled = 0;
        while (filled < length) {
          const n = readSync(fd, sealed, filled, length - filled, offset + filled);
          if (!n) throw new ContentSealError("malformed");
          filled += n;
        }
        const plain = openChunk(key, header.context, index, index === count - 1, sealed.subarray(0, length));
        hash.update(plain);
        for (let written = 0; written < plain.length;) written += writeSync(out, plain, written, plain.length - written);
        total += plain.length;
      }
      return { size: total, sha256: hash.digest("hex") };
    } finally {
      closeSync(out);
    }
  } finally {
    closeSync(fd);
  }
}

function exportPlainLog(source: string, destination: string, mode: number): { size: number; sha256: string } | null {
  const text = readFileSync(source, "utf8");
  if (!text.includes(`"sealed":"`)) return null;
  const file = join(dirname(source), basename(source));
  const lines = text.split("\n").map((raw) => {
    if (!raw.includes(`"sealed":"`)) return raw;
    let value: unknown;
    try { value = JSON.parse(raw); } catch { return raw; }
    const keyId = sealedLineKeyId(value);
    if (!keyId) return raw;
    const key = exportKey(keyId);
    if (key === "locked") throw new ContentExportLocked();
    // erased (its key destroyed): left out, like an erased message
    if (key === "foreign") return null;
    try { return openLine(value as Record<string, unknown>, key, logContext(file)); } catch { return null; }
  }).filter((line): line is string => line !== null);
  const data = Buffer.from(lines.join("\n"), "utf8");
  const out = openSync(destination, "wx", mode);
  try {
    for (let written = 0; written < data.length;) written += writeSync(out, data, written, data.length - written);
  } finally {
    closeSync(out);
  }
  return { size: data.length, sha256: createHash("sha256").update(data).digest("hex") };
}

// ---------------------------------------------------------------------------
// Pausing (a backup copies the data folder: no replacement meanwhile)

let pauses = 0;
let resumeWaiters: Array<() => void> = [];
let current: Promise<unknown> = Promise.resolve();

/** Hold the migration between two files until the returned release. */
export async function pauseAtRestMigration(): Promise<() => void> {
  pauses++;
  await current.catch(() => undefined);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    pauses = Math.max(0, pauses - 1);
    if (!pauses) { const waiters = resumeWaiters; resumeWaiters = []; for (const resolve of waiters) resolve(); }
  };
}

async function whilePaused(): Promise<void> {
  while (pauses) await new Promise<void>((resolve) => resumeWaiters.push(resolve));
}

/** Counts for a status line (a scan: not for a hot path). */
export function atRestStatus(): { sealedFiles: number; plainFiles: number } {
  let sealedFiles = 0;
  let plainFiles = 0;
  for (const root of roots) {
    try {
      for (const { path } of root.files()) {
        const info = atRestInfoSync(path);
        if (!info) continue;
        if (info.sealed) sealedFiles++; else plainFiles++;
      }
    } catch { /* none */ }
  }
  return { sealedFiles, plainFiles };
}

/** Test seam: forget holds, hints and what the migration saw. */
export function resetAtRestState(): void {
  holders.clear();
  holderSince.clear();
  holdCount.clear();
  lastUse.clear();
  scopeHints.clear();
  seen.clear();
  logSeen.clear();
  if (timer) { clearTimeout(timer); timer = null; }
  graceMs = Number.isInteger(graceFromEnv) && graceFromEnv >= 0 ? graceFromEnv : GRACE_MS;
}

export { WORKSPACE_OWNER };
