// Hand-built archives for tests, including the hostile ones no archiver
// would write (zip-slip names, links, lying sizes, encrypted flags).
import zlib from "node:zlib";

const crc32 = (data) => zlib.crc32(data) >>> 0;

/** entries: { name, data?, method? (0|8), encrypted?, symlink?, declaredSize? } */
export function zipArchive(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data ?? "");
    const method = entry.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const size = entry.declaredSize ?? data.length;
    const flags = 0x800 | (entry.encrypted ? 0x1 : 0);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = entry.symlink ? 0o120777 : entry.name.endsWith("/") ? 0o040755 : 0o100644;
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

function tarHeader(name, size, flag, linkname = "") {
  const block = Buffer.alloc(512);
  block.write(name.slice(0, 100), 0, "utf8");
  block.write("0000644\0", 100, "latin1");
  block.write("0000000\0", 108, "latin1");
  block.write("0000000\0", 116, "latin1");
  block.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "latin1");
  block.write("00000000000\0", 136, "latin1");
  block.write("        ", 148, "latin1");
  block.write(flag, 156, "latin1");
  block.write(linkname.slice(0, 100), 157, "utf8");
  block.write("ustar\0", 257, "latin1");
  block.write("00", 263, "latin1");
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "latin1");
  return block;
}

const pad = (length) => Buffer.alloc((512 - (length % 512)) % 512);

/** entries: { name, data?, type? ("file"|"dir"|"symlink"|"hardlink"|"fifo"), linkname?, pax? } */
export function tarArchive(entries, { gzip = false } = {}) {
  const parts = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? "");
    if (entry.pax || Buffer.byteLength(entry.name) > 100) {
      const record = (key, value) => {
        const body = ` ${key}=${value}\n`;
        const bytes = Buffer.byteLength(body);
        let length = bytes + 1;
        while (String(length).length + bytes !== length) length = String(length).length + bytes;
        return `${length}${body}`;
      };
      const pax = Buffer.from(record("path", entry.name), "utf8");
      parts.push(tarHeader("PaxHeader", pax.length, "x"), pax, pad(pax.length));
    }
    const flag = { file: "0", dir: "5", symlink: "2", hardlink: "1", fifo: "6" }[entry.type ?? "file"];
    const size = entry.type && entry.type !== "file" ? 0 : data.length;
    parts.push(tarHeader(entry.name, size, flag, entry.linkname ?? ""));
    if (size) parts.push(data, pad(size));
  }
  parts.push(Buffer.alloc(1024));
  const tar = Buffer.concat(parts);
  return gzip ? zlib.gzipSync(tar) : tar;
}
