import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OPEN_PDF_MAX_BYTES, openPdfInDefaultApp, pdfBytesFrom, safePdfName, sweepStalePdfDirs, writeTempPdf } from "./open-pdf.mjs";

const pdf = (text = "%PDF-1.7\n1 0 obj") => new TextEncoder().encode(text);

let tmpdir;
beforeEach(() => {
  tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "open-pdf-test-"));
});
afterEach(() => {
  fs.rmSync(tmpdir, { recursive: true, force: true });
});

describe("desktop:open-pdf input checks", () => {
  it("takes only PDF bytes within the cap", () => {
    expect(pdfBytesFrom(pdf())).toBeInstanceOf(Uint8Array);
    expect(pdfBytesFrom(pdf().buffer)).toBeInstanceOf(Uint8Array);
    expect(pdfBytesFrom(pdf("\n\n %PDF-2.0"))).not.toBeNull();
    expect(pdfBytesFrom(pdf("MZ\x90\x00 an executable"))).toBeNull();
    expect(pdfBytesFrom("/etc/passwd")).toBeNull();
    expect(pdfBytesFrom({ length: 10 })).toBeNull();
    expect(pdfBytesFrom(null)).toBeNull();
    expect(pdfBytesFrom(new Uint8Array(OPEN_PDF_MAX_BYTES + 1).fill(0x25))).toBeNull();
    const late = new Uint8Array(2048);
    late.set(pdf("%PDF-1.4"), 1500);
    expect(pdfBytesFrom(late)).toBeNull();
  });

  it("cleans the name: no folders, no reserved characters, always .pdf", () => {
    expect(safePdfName("Contrat.pdf")).toBe("Contrat.pdf");
    expect(safePdfName("Rapport annuel")).toBe("Rapport annuel.pdf");
    expect(safePdfName("../../.ssh/authorized_keys")).toBe("authorized_keys.pdf");
    expect(safePdfName("C:\\Windows\\evil.exe")).toBe("evil.exe.pdf");
    expect(safePdfName("run.app")).toBe("run.app.pdf");
    expect(safePdfName("a<b>:c|d?*\u202egpj.pdf")).toBe("abcdgpj.pdf");
    expect(safePdfName("...")).toBe("document.pdf");
    expect(safePdfName("")).toBe("document.pdf");
    expect(safePdfName(42)).toBe("document.pdf");
    expect(safePdfName("CON")).toBe("_CON.pdf");
    expect(safePdfName("x".repeat(500))).toHaveLength(124);
  });
});

describe("desktop:open-pdf writes a private temp copy and opens only that", () => {
  it("writes a new 0600 file in a new 0700 folder and opens it", async () => {
    const openPath = vi.fn(async () => "");
    await expect(openPdfInDefaultApp(pdf(), "Facture 12.pdf", { openPath, tmpdir })).resolves.toBe(true);
    expect(openPath).toHaveBeenCalledTimes(1);
    const opened = openPath.mock.calls[0][0];
    expect(path.basename(opened)).toBe("Facture 12.pdf");
    expect(path.dirname(path.dirname(opened))).toBe(tmpdir);
    expect(path.basename(path.dirname(opened))).toMatch(/^sagax-pdf-/);
    expect(fs.readFileSync(opened, "utf8")).toBe("%PDF-1.7\n1 0 obj");
    if (process.platform !== "win32") {
      expect(fs.statSync(opened).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(opened)).mode & 0o777).toBe(0o700);
    }
  });

  it("two opens of the same name never share a file", async () => {
    const first = await writeTempPdf(pdf(), "a.pdf", { tmpdir });
    const second = await writeTempPdf(pdf(), "a.pdf", { tmpdir });
    expect(first).not.toBe(second);
  });

  it("refuses what is not a PDF without writing or opening anything", async () => {
    const openPath = vi.fn(async () => "");
    await expect(openPdfInDefaultApp(pdf("#!/bin/sh\nrm -rf ~"), "x.pdf", { openPath, tmpdir })).rejects.toThrow(/not a PDF/);
    await expect(openPdfInDefaultApp("/Users/someone/secret.pdf", "secret.pdf", { openPath, tmpdir })).rejects.toThrow(/not a PDF/);
    expect(openPath).not.toHaveBeenCalled();
    expect(fs.readdirSync(tmpdir)).toEqual([]);
  });

  it("reports when no app could open it", async () => {
    const openPath = vi.fn(async () => "no application");
    await expect(openPdfInDefaultApp(pdf(), "a.pdf", { openPath, tmpdir })).rejects.toThrow(/No app/);
  });

  it("removes its own folders older than a day, nothing else", async () => {
    const old = path.join(tmpdir, "sagax-pdf-old");
    const fresh = path.join(tmpdir, "sagax-pdf-new");
    const other = path.join(tmpdir, "someone-else");
    for (const dir of [old, fresh, other]) fs.mkdirSync(dir);
    const dayAgo = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(old, dayAgo, dayAgo);
    fs.utimesSync(other, dayAgo, dayAgo);
    await sweepStalePdfDirs({ tmpdir });
    expect(fs.readdirSync(tmpdir).sort()).toEqual(["sagax-pdf-new", "someone-else"]);
  });
});

describe("desktop:open-pdf wiring", () => {
  // A Windows checkout may hand these files over with CRLF line endings.
  const main = fs.readFileSync(new URL("./main.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const preload = fs.readFileSync(new URL("./preload.cjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");

  it("is a desktop-UI-only channel that opens through open-pdf.mjs", () => {
    expect(main).toMatch(/ipcMain\.handle\("desktop:open-pdf", desktopUiOnly\("desktop:open-pdf", async \(_event, bytes, name\) => \{\n\s+return openPdfInDefaultApp\(bytes, name, \{ openPath: \(file\) => shell\.openPath\(file\) \}\);/);
  });

  it("sends bytes and a name, never a path", () => {
    expect(preload).toMatch(/openPdf: \(bytes, name\) =>\n\s+ipcRenderer\.invoke\("desktop:open-pdf", bytes, typeof name === "string" \? name : ""\)/);
  });
});
