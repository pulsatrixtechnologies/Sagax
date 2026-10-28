import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createDataArchive, restoreDataArchive, verifyDataArchive } from "./data-dir-archive.ts";

describe("sagax backup and restore --verify", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("copies sealed bytes, leaves the clear key out, and does not write without --apply", async () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-backup-"));
    dirs.push(root);
    const data = join(root, "data");
    const dest = join(root, "restored");
    const archive = join(root, "copy.sgbk");
    mkdirSync(data, { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(data, "messages.db"), "sealed-row-ciphertext", { mode: 0o600 });
    writeFileSync(join(data, "mcp-oauth.key"), "clear-key-material\n", { mode: 0o600 });
    writeFileSync(join(dest, "mcp-oauth.key"), "destination-key\n", { mode: 0o600 });
    const report = await createDataArchive(data, archive);
    expect(report.files).toBe(1);
    const bytes = readFileSync(archive);
    expect(bytes.includes(Buffer.from("sealed-row-ciphertext"))).toBe(true);
    expect(bytes.includes(Buffer.from("clear-key-material"))).toBe(false);
    expect(verifyDataArchive(archive)).toMatchObject({ ok: true, files: 1 });
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(archive, bytes);
    expect(verifyDataArchive(archive).ok).toBe(false);
    // the tamper stands: verify must not have written the destination
    expect(readFileSync(join(dest, "mcp-oauth.key"), "utf8")).toBe("destination-key\n");
    expect(restoreDataArchive(archive, dest, false).ok).toBe(false);
    expect(readFileSync(join(dest, "mcp-oauth.key"), "utf8")).toBe("destination-key\n");
  });

  it("writes only when apply is true, and keeps a key the archive did not carry", async () => {
    const root = mkdtempSync(join(tmpdir(), "sagax-backup-"));
    dirs.push(root);
    const data = join(root, "data");
    const dest = join(root, "restored");
    const archive = join(root, "copy.sgbk");
    mkdirSync(data, { recursive: true });
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(data, "messages.db"), "sealed-row-ciphertext");
    writeFileSync(join(data, "mcp-oauth.key"), "clear-key-material\n");
    writeFileSync(join(dest, "mcp-oauth.key"), "destination-key\n");
    await createDataArchive(data, archive);
    const checked = restoreDataArchive(archive, dest, false);
    expect(checked).toMatchObject({ ok: true, files: 1 });
    expect(readFileSync(join(dest, "mcp-oauth.key"), "utf8")).toBe("destination-key\n");
    expect(() => readFileSync(join(dest, "messages.db"))).toThrow();
    const applied = restoreDataArchive(archive, dest, true);
    expect(applied).toMatchObject({ ok: true, applied: true });
    expect(readFileSync(join(dest, "messages.db"), "utf8")).toBe("sealed-row-ciphertext");
    expect(readFileSync(join(dest, "mcp-oauth.key"), "utf8")).toBe("destination-key\n");
  });
});
