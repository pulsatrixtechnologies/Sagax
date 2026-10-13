import { describe, expect, it } from "vitest";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { assertContentMatches, checkUploadedFile, clamdScanFile, sniff, sniffModeFromEnv } from "./upload-content-check.ts";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
const pe = Buffer.from("MZ\x90\x00", "latin1");

describe("upload content check", () => {
  it("sniffs common kinds", () => {
    expect(sniff(png)).toBe("png");
    expect(sniff(zip)).toBe("zip");
    expect(sniff(elf)).toBe("elf");
    expect(sniff(pe)).toBe("pe");
    expect(sniff(Buffer.from("%PDF-1.7"))).toBe("pdf");
    expect(sniff(Buffer.from("hello, world\n"))).toBe("text");
  });

  it("accepts matching content", () => {
    expect(assertContentMatches("image/png", png, "enforce")).toBe("png");
    expect(assertContentMatches("application/zip", zip, "enforce")).toBe("zip");
    expect(assertContentMatches("application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip, "enforce")).toBe("zip");
    expect(assertContentMatches("text/markdown", Buffer.from("# hi"), "enforce")).toBe("text");
  });

  it("refuses executables disguised as archives, images or text", () => {
    expect(() => assertContentMatches("application/zip", elf, "enforce")).toThrow(/executable/);
    expect(() => assertContentMatches("application/x-7z-compressed", pe, "enforce")).toThrow(/executable/);
    expect(() => assertContentMatches("image/png", Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), "enforce")).toThrow(/executable/);
  });

  it("refuses mismatches", () => {
    expect(() => assertContentMatches("image/png", zip, "enforce")).toThrow(/does not match/);
    expect(() => assertContentMatches("application/pdf", Buffer.from("plain"), "enforce")).toThrow(/does not match/);
  });

  it("defaults to warn outside tests; warn and off never throw", () => {
    expect(assertContentMatches("application/zip", elf, "warn")).toBe("elf");
    expect(assertContentMatches("application/zip", elf, "off")).toBe("elf");
    expect(sniffModeFromEnv({})).toBe("warn");
    expect(sniffModeFromEnv({ VITEST: "true" })).toBe("off");
    expect(sniffModeFromEnv({ SAGAX_UPLOAD_SNIFF: "enforce" })).toBe("enforce");
  });

  it("scans through clamd INSTREAM", async () => {
    const dir = mkdtempSync(join(tmpdir(), "clamd-"));
    // Windows listens on a named pipe, not a socket file
    const pipe = (name: string) => process.platform === "win32" ? `\\\\.\\pipe\\${basename(dir)}-${name}` : join(dir, name);
    const sock = pipe("clamd.sock");
    const server = createServer((conn) => {
      let data = Buffer.alloc(0);
      conn.on("data", (d: Buffer) => {
        data = Buffer.concat([data, d]);
        if (data.subarray(-4).equals(Buffer.alloc(4))) {
          conn.end(data.includes(Buffer.from("EICAR")) ? "stream: Eicar-Test-Signature FOUND\0" : "stream: OK\0");
        }
      });
    });
    await new Promise<void>((r) => server.listen(sock, r));
    try {
      const clean = join(dir, "a.zip"); writeFileSync(clean, Buffer.concat([zip, Buffer.from("clean")]));
      const bad = join(dir, "b.zip"); writeFileSync(bad, Buffer.concat([zip, Buffer.from("EICAR")]));
      const config = { socket: sock, required: true, timeoutMs: 5000 };
      expect(await clamdScanFile(clean, config)).toEqual({ status: "clean" });
      expect(await clamdScanFile(bad, config)).toEqual({ status: "infected", signature: "Eicar-Test-Signature" });
      const env = { SAGAX_CLAMD_SOCKET: sock, SAGAX_UPLOAD_SNIFF: "enforce" };
      await expect(checkUploadedFile(clean, "application/zip", env)).resolves.toBeUndefined();
      await expect(checkUploadedFile(bad, "application/zip", env)).rejects.toThrow(/antivirus/);
      await expect(checkUploadedFile(clean, "application/zip", { SAGAX_CLAMD_SOCKET: pipe("none"), SAGAX_CLAMD_REQUIRED: "1" })).rejects.toThrow(/unavailable/);
    } finally { server.close(); }
  });
});
