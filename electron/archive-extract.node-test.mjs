// Safe listing and unpacking of attached archives (electron/archive-extract.mjs).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { archiveKind, extractArchive, extractedFolderName, listArchive, safeEntryPath } from "./archive-extract.mjs";
import { tarArchive, zipArchive } from "../server/testing/archive-fixtures.mjs";

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "sagax-archive-"));
const write = (dir, name, bytes) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, bytes);
  return file;
};
const tree = (root) => {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) out.push(`${relative}@`);
      else if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
      else out.push(relative);
    }
  };
  walk(root, "");
  return out;
};

test("kinds and folder names come from the file name", () => {
  assert.equal(archiveKind("a.ZIP"), "zip");
  assert.equal(archiveKind("a.tar.gz"), "tgz");
  assert.equal(archiveKind("a.tgz"), "tgz");
  assert.equal(archiveKind("a.tar"), "tar");
  assert.equal(archiveKind("a.7z"), "7z");
  assert.equal(archiveKind("a.gz"), null);
  assert.equal(archiveKind("a.docx"), null);
  assert.equal(extractedFolderName("abcd1234-project.zip"), "abcd1234-project");
  assert.equal(extractedFolderName("/x/9f0c-src.tar.gz"), "9f0c-src");
  assert.equal(extractedFolderName("x.tgz"), "x");
});

test("entry paths never leave the folder", () => {
  for (const bad of ["../evil", "a/../../evil", "/etc/passwd", "C:/Windows/x", "c:evil", "..\\..\\evil", "a\0b", "a/\u0001b"]) {
    assert.ok(!safeEntryPath(bad).path, bad);
  }
  assert.equal(safeEntryPath("./src/./main.c").path, "src/main.c");
  assert.equal(safeEntryPath("dir\\file.txt").path, "dir/file.txt");
  assert.equal(safeEntryPath("con.txt").path, "_con.txt");
  assert.equal(safeEntryPath("a?b").path, "a_b");
  assert.equal(safeEntryPath(Array.from({ length: 30 }, () => "d").join("/")).reason, "too-deep");
});

test("a zip lists its files and unpacks next to the archive", async () => {
  const dir = scratch();
  const file = write(dir, "abcd1234-project.zip", zipArchive([
    { name: "project/", data: "" },
    { name: "project/README.md", data: "# Hello" },
    { name: "project/src/main.c", data: "int main(){}", method: 0 },
    { name: "__MACOSX/project/._README.md", data: "junk" },
  ]));
  const manifest = await listArchive(file);
  assert.equal(manifest.status, "ok");
  assert.equal(manifest.files, 2);
  assert.deepEqual(manifest.entries.map((entry) => entry.path), ["project/README.md", "project/src/main.c"]);
  const dest = path.join(dir, extractedFolderName(file));
  const result = await extractArchive(file, dest);
  assert.equal(result.extracted, true);
  assert.deepEqual(tree(dest), ["project/README.md", "project/src/main.c"]);
  assert.equal(fs.readFileSync(path.join(dest, "project/README.md"), "utf8"), "# Hello");
  // a second call keeps what is there
  assert.equal((await extractArchive(file, dest)).existing, true);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["abcd1234-project", "abcd1234-project.zip"]);
});

test("zip-slip names, absolute paths and links are left out", async () => {
  const dir = scratch();
  const file = write(dir, "evil.zip", zipArchive([
    { name: "../../escaped.txt", data: "nope" },
    { name: "/etc/owned", data: "nope" },
    { name: "link", data: "/etc/passwd", symlink: true },
    { name: "ok.txt", data: "fine" },
  ]));
  const result = await extractArchive(file, path.join(dir, "evil"));
  assert.equal(result.extracted, true);
  assert.deepEqual(tree(path.join(dir, "evil")), ["ok.txt"]);
  assert.equal(result.manifest.skippedCount, 3);
  assert.deepEqual(result.manifest.skipped.map((entry) => entry.reason).sort(), ["link", "unsafe-path", "unsafe-path"]);
  assert.equal(fs.existsSync(path.join(dir, "..", "escaped.txt")), false);
  assert.equal(fs.existsSync(path.join(os.tmpdir(), "escaped.txt")), false);
});

test("an encrypted zip is kept as is", async () => {
  const dir = scratch();
  const file = write(dir, "secret.zip", zipArchive([{ name: "secret.txt", data: "xxxx", encrypted: true, method: 0 }]));
  const result = await extractArchive(file, path.join(dir, "secret"));
  assert.equal(result.extracted, false);
  assert.equal(result.manifest.status, "encrypted");
  assert.deepEqual(result.manifest.entries.map((entry) => entry.path), ["secret.txt"]);
  assert.equal(fs.existsSync(path.join(dir, "secret")), false);
});

test("bombs: too many files, too many bytes, ratio and lying headers", async () => {
  const dir = scratch();
  const many = write(dir, "many.zip", zipArchive(Array.from({ length: 12 }, (_, index) => ({ name: `f${index}.txt`, data: "x" }))));
  assert.equal((await listArchive(many, { limits: { maxFiles: 10 } })).status, "too-large");

  const big = write(dir, "big.zip", zipArchive([{ name: "zeros.bin", data: Buffer.alloc(4 * 1024 * 1024) }]));
  const ratio = await extractArchive(big, path.join(dir, "big"), { limits: { ratioFloorBytes: 1024 * 1024 } });
  assert.equal(ratio.extracted, false);
  assert.equal(ratio.manifest.status, "too-large");
  assert.match(ratio.manifest.reason, /compressed more than/);
  assert.equal(fs.existsSync(path.join(dir, "big")), false);

  const total = await listArchive(big, { limits: { maxTotalBytes: 1024 * 1024 } });
  assert.equal(total.status, "too-large");

  // The directory claims 10 bytes; the data inflates to 4 MiB.
  const liar = write(dir, "liar.zip", zipArchive([{ name: "zeros.bin", data: Buffer.alloc(4 * 1024 * 1024), declaredSize: 10 }]));
  const lied = await extractArchive(liar, path.join(dir, "liar"));
  assert.equal(lied.extracted, false);
  assert.equal(lied.manifest.status, "too-large");
  assert.equal(fs.existsSync(path.join(dir, "liar")), false);
  assert.deepEqual(fs.readdirSync(dir).filter((name) => name.includes("partial")), []);
});

test("tar and tar.gz unpack, links and devices refused, long names kept", async () => {
  const dir = scratch();
  const long = `deep/${"n".repeat(120)}.txt`;
  for (const gzip of [false, true]) {
    const name = gzip ? "src.tar.gz" : "src.tar";
    const file = write(dir, name, tarArchive([
      { name: "src/", type: "dir" },
      { name: "src/a.txt", data: "alpha" },
      { name: "src/link", type: "symlink", linkname: "/etc/passwd" },
      { name: "src/hard", type: "hardlink", linkname: "src/a.txt" },
      { name: "src/pipe", type: "fifo" },
      { name: "../escape.txt", data: "nope" },
      { name: long, data: "long" },
    ], { gzip }));
    const dest = path.join(dir, extractedFolderName(name));
    const result = await extractArchive(file, dest);
    assert.equal(result.extracted, true, name);
    assert.deepEqual(tree(dest), [long, "src/a.txt"], name);
    assert.deepEqual(result.manifest.skipped.map((entry) => entry.reason).sort(), ["link", "link", "special", "unsafe-path"]);
  }
});

test("a gzip bomb stops at the byte limit", async () => {
  const dir = scratch();
  const file = write(dir, "bomb.tgz", tarArchive([{ name: "zeros", data: Buffer.alloc(3 * 1024 * 1024) }], { gzip: true }));
  const result = await extractArchive(file, path.join(dir, "bomb"), { limits: { maxTotalBytes: 1024 * 1024 } });
  assert.equal(result.extracted, false);
  assert.equal(result.manifest.status, "too-large");
  assert.equal(fs.existsSync(path.join(dir, "bomb")), false);
});

test("damaged archives and .7z are reported, not thrown", async () => {
  const dir = scratch();
  assert.equal((await listArchive(write(dir, "x.zip", "not a zip"))).status, "invalid");
  assert.equal((await listArchive(write(dir, "x.tar", Buffer.alloc(700, 7)))).status, "invalid");
  assert.equal((await listArchive(write(dir, "x.7z", "7z"))).status, "unsupported");
  assert.equal((await extractArchive(path.join(dir, "x.7z"), path.join(dir, "x"))).extracted, false);
});
