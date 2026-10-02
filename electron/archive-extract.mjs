// Archives a person attaches to a message (zip, tar, tar.gz): list what is
// inside and unpack it safely next to the archive. Shared by the server (solo
// mode, where the bot works on this same machine, and the listing of an
// upload) and the desktop bridge (organization mode, on the person's own
// computer). No dependency: node:fs and node:zlib only.
//
// Safety, enforced on every extraction whatever an earlier listing said:
// - every entry path is relative, has no `..`, no drive letter, no control
//   character and stays under the destination (zip-slip);
// - symbolic links, hard links and device entries are never created;
// - bomb limits: total uncompressed bytes, file count, compression ratio and
//   folder depth; the bytes are counted as they come out of the
//   decompressor, never trusted from the headers;
// - a password-protected zip is kept as is and not unpacked;
// - the result appears atomically: a private partial folder is renamed into
//   place only when every file was written.
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream";
import zlib from "node:zlib";

export const ARCHIVE_LIMITS = Object.freeze({
  /** Files unpacked from one archive. */
  maxFiles: 5000,
  /** Uncompressed bytes unpacked from one archive. */
  maxTotalBytes: 512 * 1024 * 1024,
  /** Uncompressed / compressed, past ratioFloorBytes (one entry or the whole). */
  maxRatio: 200,
  ratioFloorBytes: 8 * 1024 * 1024,
  /** Folder levels under the extracted folder. */
  maxDepth: 24,
  /** One entry's relative path, in UTF-8 bytes. */
  maxPathBytes: 1024,
});

/** Entries kept in a manifest; the counts stay exact past it. */
export const MANIFEST_MAX_ENTRIES = 2000;
const MANIFEST_MAX_SKIPPED = 200;
const ZIP_DIRECTORY_MAX_BYTES = 64 * 1024 * 1024;
const TAR_META_MAX_BYTES = 1024 * 1024;

/** The archive kind a file name says, or null. */
export function archiveKind(name) {
  const lower = String(name ?? "").toLowerCase();
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tgz";
  if (lower.endsWith(".tar")) return "tar";
  if (lower.endsWith(".7z")) return "7z";
  return null;
}

/** The folder an archive unpacks into, next to it: its name without the
 * archive extension (`abcd1234-project.zip` -> `abcd1234-project`). */
export function extractedFolderName(name) {
  const base = String(name ?? "").split(/[\\/]/).at(-1) ?? "";
  const lower = base.toLowerCase();
  for (const extension of [".tar.gz", ".tgz", ".tar", ".zip", ".7z"]) {
    if (lower.endsWith(extension) && base.length > extension.length) return base.slice(0, -extension.length);
  }
  return `${base || "archive"}-contents`;
}

class ArchiveProblem extends Error {
  constructor(status, reason) {
    super(reason);
    this.status = status;
    this.reason = reason;
  }
}
const invalid = (reason) => new ArchiveProblem("invalid", reason);
const tooLarge = (reason) => new ArchiveProblem("too-large", reason);

const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** One entry's path made safe as a relative path, or the reason it is not. */
export function safeEntryPath(raw, limits = ARCHIVE_LIMITS) {
  if (typeof raw !== "string" || !raw || raw.includes("\0")) return { reason: "unsafe-path" };
  const unified = raw.replace(/\\/g, "/");
  if (unified.startsWith("/") || /^[A-Za-z]:/.test(unified)) return { reason: "unsafe-path" };
  const parts = [];
  for (const part of unified.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return { reason: "unsafe-path" };
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f]/.test(part)) return { reason: "unsafe-path" };
    let clean = part.replace(/[<>:"|?*]/g, "_").replace(/[. ]+$/, "") || "_";
    if (RESERVED_WINDOWS_NAME.test(clean)) clean = `_${clean}`;
    parts.push(clean);
  }
  if (!parts.length) return { reason: "empty" };
  if (parts.length > limits.maxDepth) return { reason: "too-deep" };
  const relative = parts.join("/");
  if (Buffer.byteLength(relative) > limits.maxPathBytes) return { reason: "unsafe-path" };
  return { path: relative };
}

/** Finder and Windows leftovers nobody wants unpacked. */
function isMetadata(relative) {
  const parts = relative.split("/");
  return parts[0] === "__MACOSX" || parts.at(-1) === ".DS_Store" || parts.at(-1) === "Thumbs.db";
}

// ── zip ────────────────────────────────────────────────────────────────

async function readAt(handle, position, length) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  return buffer.subarray(0, bytesRead);
}

/** The central directory of a zip: one record per entry, sizes from it
 * (zip64 included). Data descriptors do not matter: the directory has the
 * real sizes. */
async function zipDirectory(file) {
  const handle = await fs.open(file, "r");
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, 22 + 0xffff);
    const tailStart = size - tailLength;
    const tail = await readAt(handle, tailStart, tailLength);
    let end = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50) { end = index; break; }
    }
    if (end < 0) throw invalid("not a zip file");
    let count = tail.readUInt16LE(end + 10);
    let directorySize = tail.readUInt32LE(end + 12);
    let directoryOffset = tail.readUInt32LE(end + 16);
    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      const locatorAt = tailStart + end - 20;
      if (locatorAt < 0) throw invalid("damaged zip64 directory");
      const locator = await readAt(handle, locatorAt, 20);
      if (locator.length < 20 || locator.readUInt32LE(0) !== 0x07064b50) throw invalid("damaged zip64 directory");
      const recordAt = Number(locator.readBigUInt64LE(8));
      const record = await readAt(handle, recordAt, 56);
      if (record.length < 56 || record.readUInt32LE(0) !== 0x06064b50) throw invalid("damaged zip64 directory");
      count = Number(record.readBigUInt64LE(32));
      directorySize = Number(record.readBigUInt64LE(40));
      directoryOffset = Number(record.readBigUInt64LE(48));
    }
    if (!Number.isSafeInteger(directoryOffset) || directoryOffset + directorySize > size) throw invalid("damaged zip directory");
    if (directorySize > ZIP_DIRECTORY_MAX_BYTES) throw tooLarge("too many entries");
    const directory = await readAt(handle, directoryOffset, directorySize);
    const entries = [];
    let at = 0;
    for (let index = 0; index < count; index += 1) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== 0x02014b50) throw invalid("damaged zip directory");
      const madeBy = directory.readUInt16LE(at + 4);
      const flags = directory.readUInt16LE(at + 8);
      const method = directory.readUInt16LE(at + 10);
      const crc = directory.readUInt32LE(at + 16);
      let compressed = directory.readUInt32LE(at + 20);
      let uncompressed = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      const external = directory.readUInt32LE(at + 38);
      let offset = directory.readUInt32LE(at + 42);
      const nameEnd = at + 46 + nameLength;
      const extraEnd = nameEnd + extraLength;
      if (extraEnd + commentLength > directory.length) throw invalid("damaged zip directory");
      const nameBytes = directory.subarray(at + 46, nameEnd);
      if (uncompressed === 0xffffffff || compressed === 0xffffffff || offset === 0xffffffff) {
        const extra = directory.subarray(nameEnd, extraEnd);
        for (let cursor = 0; cursor + 4 <= extra.length;) {
          const id = extra.readUInt16LE(cursor);
          const length = extra.readUInt16LE(cursor + 2);
          if (id === 0x0001) {
            let field = cursor + 4;
            const next = () => {
              if (field + 8 > cursor + 4 + length) throw invalid("damaged zip64 entry");
              const value = Number(extra.readBigUInt64LE(field));
              field += 8;
              return value;
            };
            if (uncompressed === 0xffffffff) uncompressed = next();
            if (compressed === 0xffffffff) compressed = next();
            if (offset === 0xffffffff) offset = next();
            break;
          }
          cursor += 4 + length;
        }
      }
      const name = flags & 0x800 ? nameBytes.toString("utf8") : nameBytes.toString("latin1");
      const unixType = madeBy >> 8 === 3 ? (external >>> 16) & 0o170000 : 0;
      const directoryEntry = /[\\/]$/.test(name) || unixType === 0o040000 || (madeBy >> 8 === 0 && (external & 0x10) !== 0);
      let type = directoryEntry ? "dir" : "file";
      if (unixType === 0o120000) type = "link";
      else if (unixType && unixType !== 0o100000 && unixType !== 0o040000) type = "special";
      entries.push({
        name, type, size: uncompressed, compressed, offset, method, crc,
        encrypted: (flags & 0x1) !== 0,
      });
      at = extraEnd + commentLength;
    }
    return { size, entries };
  } finally {
    await handle.close();
  }
}

// ── tar ────────────────────────────────────────────────────────────────

function cString(block, start, end) {
  const field = block.subarray(start, end);
  const zero = field.indexOf(0);
  return (zero < 0 ? field : field.subarray(0, zero)).toString("utf8");
}

function tarNumber(field) {
  if (field[0] & 0x80) {
    // base-256: a big-endian integer in the remaining bits
    let value = BigInt(field[0] & 0x7f);
    for (const byte of field.subarray(1)) value = (value << 8n) | BigInt(byte);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw tooLarge("an entry is too large");
    return Number(value);
  }
  const text = field.toString("latin1").replace(/\0.*$/s, "").trim();
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw invalid("damaged tar header");
  return Number.parseInt(text, 8);
}

function parseTarHeader(block) {
  let sum = 0;
  for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 32 : block[index];
  if (tarNumber(block.subarray(148, 156)) !== sum) throw invalid("not a tar archive");
  const name = cString(block, 0, 100);
  const ustar = block.subarray(257, 262).toString("latin1") === "ustar";
  const prefix = ustar ? cString(block, 345, 500) : "";
  const flag = block[156] === 0 ? "0" : String.fromCharCode(block[156]);
  return { name: prefix ? `${prefix}/${name}` : name, size: tarNumber(block.subarray(124, 136)), flag };
}

function paxRecords(buffer) {
  const out = {};
  let at = 0;
  while (at < buffer.length) {
    const space = buffer.indexOf(0x20, at);
    if (space < 0) break;
    const length = Number.parseInt(buffer.subarray(at, space).toString("latin1"), 10);
    if (!Number.isSafeInteger(length) || length <= 0 || at + length > buffer.length) break;
    const record = buffer.subarray(space + 1, at + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) out[record.slice(0, equals)] = record.slice(equals + 1);
    at += length;
  }
  return out;
}

/** Walk a tar (or gzip'd tar) stream. `visit(entry)` gets each real entry
 * with its ordinal and may return a sink `{ write(chunk), end() }` for its
 * data. The uncompressed stream itself is capped (gzip bombs). */
async function walkTar(file, kind, limits, visit) {
  const source = createReadStream(file);
  const stream = kind === "tgz" ? pipeline(source, zlib.createGunzip(), () => {}) : source;
  const streamCap = limits.maxTotalBytes + (limits.maxFiles + 64) * 1024 + 1024 * 1024;
  let pending = Buffer.alloc(0);
  let state = "header";
  let remaining = 0;
  let padding = 0;
  let sink = null;
  let meta = null;
  let overrides = {};
  let globalPax = {};
  let zeroBlocks = 0;
  let index = 0;
  let seen = 0;
  let done = false;
  let headers = 0;

  const finishData = async () => {
    if (meta) {
      const data = Buffer.concat(meta.chunks);
      if (meta.flag === "L") overrides.path = cString(data, 0, data.length);
      else if (meta.flag === "x") overrides = { ...overrides, ...paxRecords(data) };
      else if (meta.flag === "g") globalPax = { ...globalPax, ...paxRecords(data) };
      meta = null;
    } else if (sink) {
      await sink.end();
      sink = null;
    }
  };

  try {
    for await (const chunk of stream) {
      seen += chunk.length;
      if (seen > streamCap) throw tooLarge(`it unpacks to more than ${limits.maxTotalBytes} bytes`);
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let at = 0;
      while (!done) {
        if (state === "header") {
          if (pending.length - at < 512) break;
          const block = pending.subarray(at, at + 512);
          at += 512;
          if (block.every((byte) => byte === 0)) {
            zeroBlocks += 1;
            if (zeroBlocks >= 2) done = true;
            continue;
          }
          zeroBlocks = 0;
          headers += 1;
          if (headers > limits.maxFiles * 4 + 64) throw tooLarge(`more than ${limits.maxFiles} files`);
          const header = parseTarHeader(block);
          padding = (512 - (header.size % 512)) % 512;
          remaining = header.size;
          if (["x", "g", "L", "K"].includes(header.flag)) {
            if (header.size > TAR_META_MAX_BYTES) throw invalid("damaged tar header");
            meta = { flag: header.flag, chunks: [] };
          } else {
            const merged = { ...globalPax, ...overrides };
            overrides = {};
            const name = merged.path ?? header.name;
            const size = merged.size !== undefined && /^\d+$/.test(merged.size) ? Number(merged.size) : header.size;
            if (size !== header.size) throw invalid("damaged tar header");
            let type = "special";
            if (header.flag === "0" || header.flag === "7") type = name.endsWith("/") ? "dir" : "file";
            else if (header.flag === "5") type = "dir";
            else if (header.flag === "1" || header.flag === "2") type = "link";
            sink = (await visit({ index, name, type, size })) ?? null;
            index += 1;
          }
          state = "data";
          if (remaining === 0) {
            await finishData();
            state = padding ? "padding" : "header";
          }
        } else if (state === "data") {
          const take = Math.min(remaining, pending.length - at);
          if (take === 0) break;
          const slice = pending.subarray(at, at + take);
          at += take;
          remaining -= take;
          if (meta) meta.chunks.push(Buffer.from(slice));
          else if (sink) await sink.write(slice);
          if (remaining === 0) {
            await finishData();
            state = padding ? "padding" : "header";
          }
        } else {
          const take = Math.min(padding, pending.length - at);
          if (take === 0) break;
          at += take;
          padding -= take;
          if (padding === 0) state = "header";
        }
      }
      pending = pending.subarray(at);
      if (done) break;
    }
  } finally {
    source.destroy();
    if (stream !== source) stream.destroy();
  }
  if (!done && (state !== "header" || pending.length)) throw invalid("the archive is truncated");
  if (index === 0 && !done) throw invalid("not a tar archive");
}

// ── listing ────────────────────────────────────────────────────────────

/** Turn raw entries into a manifest and the plan of files to write. */
function plan(kind, archiveBytes, rawEntries, limits) {
  const entries = [];
  const skipped = [];
  let skippedCount = 0;
  const files = [];
  const filePaths = new Set();
  const dirPaths = new Set();
  let totalBytes = 0;
  let encrypted = false;
  let problem = null;
  const skip = (name, reason) => {
    skippedCount += 1;
    if (skipped.length < MANIFEST_MAX_SKIPPED) skipped.push({ path: String(name).slice(0, 300), reason });
  };
  for (const entry of rawEntries) {
    if (entry.encrypted) encrypted = true;
    if (entry.type === "link") { skip(entry.name, "link"); continue; }
    if (entry.type === "special") { skip(entry.name, "special"); continue; }
    const safe = safeEntryPath(entry.name, limits);
    if (!safe.path) {
      if (safe.reason !== "empty") skip(entry.name, safe.reason);
      continue;
    }
    if (isMetadata(safe.path)) continue;
    const key = safe.path.toLowerCase();
    if (entry.type === "dir") {
      if (filePaths.has(key)) { skip(entry.name, "duplicate"); continue; }
      dirPaths.add(key);
      continue;
    }
    if (kind === "zip" && entry.method !== 0 && entry.method !== 8 && !entry.encrypted) {
      skip(entry.name, "unsupported-compression");
      continue;
    }
    const parents = key.split("/").slice(0, -1).map((_, depth, all) => all.slice(0, depth + 1).join("/"));
    if (filePaths.has(key) || dirPaths.has(key) || parents.some((parent) => filePaths.has(parent))) {
      skip(entry.name, "duplicate");
      continue;
    }
    filePaths.add(key);
    for (const parent of parents) dirPaths.add(parent);
    totalBytes += entry.size;
    if (!problem && kind === "zip" && entry.size > limits.ratioFloorBytes && entry.size > Math.max(1, entry.compressed) * limits.maxRatio) {
      problem = `an entry is compressed more than ${limits.maxRatio} to 1`;
    }
    files.push({ ...entry, path: safe.path });
    if (entries.length < MANIFEST_MAX_ENTRIES) entries.push({ path: safe.path, size: entry.size });
  }
  if (!problem && files.length > limits.maxFiles) problem = `more than ${limits.maxFiles} files`;
  if (!problem && totalBytes > limits.maxTotalBytes) problem = `it unpacks to more than ${limits.maxTotalBytes} bytes`;
  if (!problem && totalBytes > limits.ratioFloorBytes && totalBytes > Math.max(1, archiveBytes) * limits.maxRatio) {
    problem = `it is compressed more than ${limits.maxRatio} to 1`;
  }
  const status = encrypted ? "encrypted" : problem ? "too-large" : "ok";
  const manifest = {
    version: 1,
    kind,
    status,
    ...(problem && !encrypted ? { reason: problem } : {}),
    files: files.length,
    dirs: dirPaths.size,
    totalBytes,
    archiveBytes,
    entries,
    truncated: files.length > entries.length,
    skipped,
    skippedCount,
  };
  return { manifest, files };
}

async function inspect(file, kind, limits) {
  const { size } = await fs.stat(file);
  if (kind === "zip") {
    const directory = await zipDirectory(file);
    return { ...plan("zip", size, directory.entries, limits), size };
  }
  const raw = [];
  await walkTar(file, kind, limits, async (entry) => {
    raw.push(entry);
    return null;
  });
  return { ...plan(kind, size, raw, limits), size };
}

function failedManifest(kind, archiveBytes, error) {
  const status = error instanceof ArchiveProblem ? error.status : "invalid";
  const reason = error instanceof ArchiveProblem ? error.reason : "the archive could not be read";
  return {
    version: 1, kind, status, reason, files: 0, dirs: 0, totalBytes: 0, archiveBytes,
    entries: [], truncated: false, skipped: [], skippedCount: 0,
  };
}

/** What is inside an archive, without unpacking anything. Never throws for
 * a bad archive: the manifest's status says what is wrong. */
export async function listArchive(file, options = {}) {
  const kind = options.kind ?? archiveKind(file);
  const limits = { ...ARCHIVE_LIMITS, ...options.limits };
  let archiveBytes = 0;
  try { archiveBytes = (await fs.stat(file)).size; } catch { /* reported below */ }
  if (kind === "7z") {
    return { ...failedManifest(kind, archiveBytes, null), status: "unsupported", reason: "Sagax does not open .7z archives" };
  }
  if (!kind) return failedManifest(kind, archiveBytes, invalid("not a supported archive"));
  try {
    return (await inspect(file, kind, limits)).manifest;
  } catch (error) {
    return failedManifest(kind, archiveBytes, error);
  }
}

// ── extraction ─────────────────────────────────────────────────────────

function targetFor(root, relative) {
  const target = path.resolve(root, ...relative.split("/"));
  const inside = path.relative(root, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) throw invalid("an entry leaves the folder");
  return target;
}

function budget(limits) {
  let total = 0;
  return (bytes) => {
    total += bytes;
    if (total > limits.maxTotalBytes) throw tooLarge(`it unpacks to more than ${limits.maxTotalBytes} bytes`);
  };
}

async function openTarget(root, relative) {
  const target = targetFor(root, relative);
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  return fs.open(target, "wx", 0o600);
}

async function extractZip(file, size, files, root, limits) {
  const count = budget(limits);
  const handle = await fs.open(file, "r");
  try {
    for (const entry of files) {
      const local = await readAt(handle, entry.offset, 30);
      if (local.length < 30 || local.readUInt32LE(0) !== 0x04034b50) throw invalid("damaged zip entry");
      const start = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      if (start + entry.compressed > size) throw invalid("damaged zip entry");
      const out = await openTarget(root, entry.path);
      let written = 0;
      let crc = 0;
      try {
        if (entry.compressed > 0) {
          const raw = createReadStream(file, { start, end: start + entry.compressed - 1 });
          const data = entry.method === 8 ? pipeline(raw, zlib.createInflateRaw(), () => {}) : raw;
          try {
            for await (const chunk of data) {
              written += chunk.length;
              if (written > entry.size) throw tooLarge("an entry is larger than its header says");
              count(chunk.length);
              if (typeof zlib.crc32 === "function") crc = zlib.crc32(chunk, crc);
              await out.write(chunk);
            }
          } finally {
            raw.destroy();
            if (data !== raw) data.destroy();
          }
        }
      } finally {
        await out.close();
      }
      if (written !== entry.size) throw invalid("damaged zip entry");
      if (typeof zlib.crc32 === "function" && (crc >>> 0) !== entry.crc) throw invalid("damaged zip entry (checksum)");
    }
  } finally {
    await handle.close();
  }
}

async function extractTar(file, kind, files, root, limits) {
  const count = budget(limits);
  const wanted = new Map(files.map((entry) => [entry.index, entry]));
  await walkTar(file, kind, limits, async (entry) => {
    const planned = wanted.get(entry.index);
    if (!planned) return null;
    if (planned.size !== entry.size || planned.name !== entry.name) throw invalid("the archive changed while unpacking");
    const out = await openTarget(root, planned.path);
    let written = 0;
    return {
      async write(chunk) {
        written += chunk.length;
        count(chunk.length);
        await out.write(chunk);
      },
      async end() {
        await out.close();
        if (written !== planned.size) throw invalid("damaged tar entry");
      },
    };
  });
}

/** Unpack `file` into `dest` (created; its parent must exist). Never throws
 * for a bad archive: `extracted` is false and the manifest says why. An
 * existing `dest` is left as is (the same upload unpacked before). */
export async function extractArchive(file, dest, options = {}) {
  const kind = options.kind ?? archiveKind(file);
  const limits = { ...ARCHIVE_LIMITS, ...options.limits };
  if (kind === "7z" || !kind) return { manifest: await listArchive(file, { kind, limits }), extracted: false };
  let inspected;
  try {
    inspected = await inspect(file, kind, limits);
  } catch (error) {
    let archiveBytes = 0;
    try { archiveBytes = (await fs.stat(file)).size; } catch { /* missing */ }
    return { manifest: failedManifest(kind, archiveBytes, error), extracted: false };
  }
  const { manifest, files, size } = inspected;
  if (manifest.status !== "ok") return { manifest, extracted: false };
  try {
    await fs.lstat(dest);
    return { manifest, extracted: true, existing: true };
  } catch { /* not unpacked yet */ }
  const partial = `${dest}.partial-${randomUUID()}`;
  await fs.mkdir(partial, { mode: 0o700 });
  try {
    if (kind === "zip") await extractZip(file, size, files, partial, limits);
    else await extractTar(file, kind, files, partial, limits);
    await fs.rename(partial, dest);
    return { manifest, extracted: true };
  } catch (error) {
    await fs.rm(partial, { recursive: true, force: true });
    const failed = failedManifest(kind, manifest.archiveBytes, error);
    return { manifest: { ...manifest, status: failed.status, reason: failed.reason }, extracted: false };
  }
}
