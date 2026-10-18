import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  detectCsvFormat,
  exportVaultItems,
  mergePatch,
  parseCsv,
  parseVaultImportFile,
  planVaultImport,
  readableTotpSeed,
  siteFromUrl,
  toCsv,
  VaultImportError,
  type VaultImportExisting,
  type VaultTransferItem,
} from "./credential-vault-transfer.ts";

// Every file and value here is fake test data (shared/fixtures/credential-vault-import).
const FIXTURES = fileURLToPath(new URL("./fixtures/credential-vault-import/", import.meta.url));
const fixture = (name: string) => new Uint8Array(readFileSync(join(FIXTURES, name)));
const read = (name: string) => parseVaultImportFile(fixture(name));
const summary = (items: readonly VaultTransferItem[]) => items.map((item) => `${item.kind}:${item.name}:${item.domains.join("|")}`);

describe("import formats", () => {
  it("reads an unencrypted Bitwarden JSON and says what it leaves out", async () => {
    const parsed = await read("bitwarden.json");
    expect(parsed.format).toBe("bitwarden-json");
    expect(summary(parsed.items)).toEqual(["login:Portail démo:portal.example.com|www.example.com", "note:Note Wi-Fi:", "apiKey:Clé API démo:api.example.net"]);
    expect(parsed.items[0]).toMatchObject({ username: "alex@example.com", password: "fake-pass-bw-1", notes: "Compte de test" });
    expect(parsed.items[0]!.totpSeed).toMatch(/^otpauth:\/\/totp\//);
    expect(parsed.items[2]).toMatchObject({ apiKey: "fake-api-key-0001" });
    expect(parsed.items[2]).not.toHaveProperty("password");
    expect(parsed.skipped).toEqual([
      { row: 3, name: "Carte démo", reason: "unsupported_type" },
      { row: 4, name: "Routeur", reason: "no_site" },
      { row: 6, name: "Ancien compte", reason: "deleted" },
    ]);
    expect(parsed.dropped).toEqual({ customFields: 1, attachments: 1, passkeys: 1 });
  });

  it("refuses an encrypted Bitwarden export", async () => {
    await expect(read("bitwarden-encrypted.json")).rejects.toMatchObject({ code: "encrypted" });
  });

  it("reads a Bitwarden CSV: several URIs in one cell, quotes, a note, a Sagax API key", async () => {
    const parsed = await read("bitwarden.csv");
    expect(parsed.format).toBe("bitwarden-csv");
    expect(summary(parsed.items)).toEqual(["login:Portail démo:portal.example.com|www.example.com", "note:Note Wi-Fi:", "apiKey:Clé API démo:api.example.net"]);
    expect(parsed.items[0]).toMatchObject({ password: "fake,pass\"bw-2", notes: "Ligne 1\nLigne 2", totpSeed: "JBSWY3DPEHPK3PXP" });
    expect(parsed.skipped).toEqual([{ row: 5, name: "Sans site", reason: "no_site" }]);
    expect(parsed.dropped).toEqual({ customFields: 1 });
  });

  it("reads a LastPass CSV: secure notes by http://sn, an unreadable seed counted", async () => {
    const parsed = await read("lastpass.csv");
    expect(parsed.format).toBe("lastpass-csv");
    expect(summary(parsed.items)).toEqual([
      "login:Courriel démo:mail.example.com",
      "note:Note sécurisée:",
      "login:Boutique démo:shop.example.org",
      "login:Courriel démo (copie):mail.example.com",
    ]);
    expect(parsed.items[0]).toMatchObject({ notes: "Note libre" });
    expect(parsed.items[2]).not.toHaveProperty("totpSeed");
    expect(parsed.dropped).toEqual({ totp: 1 });
  });

  it("reads an Apple Passwords CSV with its OTPAuth column and a localhost binding", async () => {
    const parsed = await read("apple-passwords.csv");
    expect(parsed.format).toBe("apple-csv");
    expect(summary(parsed.items)).toEqual(["login:example.com (alex):example.com", "login:Dev local:http://localhost:3000", "login:Intranet:intranet.example.net"]);
    expect(parsed.items[0]!.totpSeed).toMatch(/^otpauth:/);
  });

  it("reads a 1Password CSV, leaving archived items out", async () => {
    const parsed = await read("1password.csv");
    expect(parsed.format).toBe("onepassword-csv");
    expect(summary(parsed.items)).toEqual(["login:Compte démo:app.example.com|login.example.com"]);
    expect(parsed.skipped).toEqual([{ row: 3, name: "Archivé", reason: "archived" }]);
  });

  it("reads a 1Password 1PUX (zip): logins, notes, API credentials", async () => {
    const parsed = await read("1password.1pux");
    expect(parsed.format).toBe("onepassword-1pux");
    expect(summary(parsed.items)).toEqual(["login:Banque démo:bank.example.com|m.bank.example.com", "note:Note démo:", "apiKey:API démo:api.example.org"]);
    expect(parsed.items[0]).toMatchObject({ username: "pat@example.com", password: "fake-pass-1pux-1", totpSeed: "JBSWY3DPEHPK3PXP", notes: "Note factice" });
    expect(parsed.items[2]).toMatchObject({ apiKey: "fake-api-key-1pux" });
    expect(parsed.skipped.map((skip) => skip.reason)).toEqual(["archived", "unsupported_type", "unsupported_type"]);
    expect(parsed.dropped).toEqual({ customFields: 1 });
  });

  it("reads Chrome, Edge and Brave CSV (with a port) and Firefox CSV", async () => {
    const chrome = await read("chrome.csv");
    expect(chrome.format).toBe("chrome-csv");
    expect(summary(chrome.items)).toEqual(["login:example.com:accounts.example.com", "login:port.example.net:port.example.net:8443"]);
    expect(chrome.skipped).toEqual([{ row: 4, name: "Sans mot de passe", reason: "empty" }]);
    const firefox = await read("firefox.csv");
    expect(firefox.format).toBe("firefox-csv");
    // Firefox has no names: the site is the name
    expect(summary(firefox.items)).toEqual(["login:forum.example.org:forum.example.org", "login:sub.forum.example.org:sub.forum.example.org"]);
  });

  it("reads a generic CSV by its column names", async () => {
    const parsed = await read("generic.csv");
    expect(parsed.format).toBe("generic-csv");
    expect(parsed.items).toEqual([{ kind: "login", name: "Wiki démo", username: "lee", password: "fake-pass-gen-1", notes: "Fichier générique", domains: ["wiki.example.com"] }]);
  });

  it("refuses what it does not recognize, an empty file and one too large", async () => {
    await expect(parseVaultImportFile(new TextEncoder().encode("a,b,c\n1,2,3\n"))).rejects.toMatchObject({ code: "unknown_format" });
    await expect(parseVaultImportFile(new TextEncoder().encode("{\"hello\":1}"))).rejects.toMatchObject({ code: "unknown_format" });
    await expect(parseVaultImportFile(new TextEncoder().encode("{not json"))).rejects.toMatchObject({ code: "unreadable" });
    await expect(parseVaultImportFile(new Uint8Array())).rejects.toMatchObject({ code: "empty" });
    await expect(parseVaultImportFile(new Uint8Array(9 * 1024 * 1024))).rejects.toBeInstanceOf(VaultImportError);
  });
});

describe("pieces", () => {
  it("parses CSV like RFC 4180: BOM, CRLF, quotes, line breaks in quotes", () => {
    expect(parseCsv("﻿a,b\r\n\"x,1\",\"say \"\"hi\"\"\"\r\n\"multi\nline\",\n\n")).toEqual([["a", "b"], ["x,1", "say \"hi\""], ["multi\nline", ""]]);
    expect(parseCsv(toCsv([["a", " b", "c,d", "e\"f", "g\nh", undefined]]))).toEqual([["a", " b", "c,d", "e\"f", "g\nh", ""]]);
  });

  it("detects each manager's header", () => {
    expect(detectCsvFormat(["Title", "URL", "Username", "Password", "Notes", "OTPAuth"])).toBe("apple-csv");
    expect(detectCsvFormat(["name", "url", "username", "password", "note"])).toBe("chrome-csv");
    expect(detectCsvFormat(["name", "url", "username", "password"])).toBe("chrome-csv");
    expect(detectCsvFormat(["Title", "Url", "Username", "Password", "OTPAuth", "Favorite", "Archived", "Tags", "Notes"])).toBe("onepassword-csv");
    expect(detectCsvFormat(["a", "b"])).toBeNull();
  });

  it("takes a site from a URL as the vault binds it", () => {
    expect(siteFromUrl("https://Portal.Example.com/login?x=1#y")).toBe("portal.example.com");
    expect(siteFromUrl("example.com")).toBe("example.com");
    expect(siteFromUrl("https://example.com:8443/a")).toBe("example.com:8443");
    expect(siteFromUrl("http://example.com/")).toBe("example.com");
    expect(siteFromUrl("http://localhost:3000/x")).toBe("http://localhost:3000");
    expect(siteFromUrl("https://*.example.com/path")).toBe("example.com");
    for (const refused of ["androidapp://com.example", "http://sn", "http://192.168.0.1", "https://user:pw@example.com", "", undefined, "ftp://example.com"]) {
      expect(siteFromUrl(refused), String(refused)).toBeNull();
    }
  });

  it("knows which one-time code seeds the vault can read", () => {
    expect(readableTotpSeed("JBSWY3DPEHPK3PXP")).toBe(true);
    expect(readableTotpSeed("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=8")).toBe(true);
    expect(readableTotpSeed("otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP")).toBe(false);
    expect(readableTotpSeed("steam://FAKE")).toBe(false);
    expect(readableTotpSeed("otpauth://totp/x?secret=JBSWY3DPEHPK3PXP&digits=4")).toBe(false);
  });
});

describe("duplicates", () => {
  const login = (name: string, username: string, domains: string[], password = "fake-dup"): VaultTransferItem => ({ kind: "login", name, username, password, domains });
  const saved: VaultImportExisting[] = [
    { id: "aaaaaaaa01", kind: "login", name: "Saved mail", username: "Sam@Example.com", domains: ["mail.example.com"], source: "local" },
    { id: "aaaaaaaa02", kind: "note", name: "Wi-Fi", domains: [], source: "local" },
    { id: "aaaaaaaa03", kind: "login", name: "From 1Password", username: "pat", domains: ["bank.example.com"], source: "1password" },
  ];

  it("matches a login by site and user name, a note by name, and repeats in the file", () => {
    const items = [
      login("Mail", "sam@example.com", ["mail.example.com"]),
      login("Mail other user", "other", ["mail.example.com"]),
      { kind: "note", name: "wi-fi", notes: "fake note", domains: [] } as VaultTransferItem,
      login("Bank", "pat", ["bank.example.com"]),
      login("Shop", "kim", ["shop.example.org"]),
      login("Shop again", "KIM", ["shop.example.org", "www.shop.example.org"]),
    ];
    const skip = planVaultImport(items, saved, "skip");
    expect(skip.create.map((item) => item.name)).toEqual(["Mail other user", "Shop"]);
    expect(skip).toMatchObject({ duplicates: 3, inFile: 1, merge: [], overLimit: 0 });
    const merge = planVaultImport(items, saved, "merge");
    // a 1Password item is read-only here: never merged
    expect(merge.merge.map((row) => row.id)).toEqual(["aaaaaaaa01", "aaaaaaaa02"]);
    expect(merge.duplicates).toBe(1);
  });

  it("stops at the vault's capacity", () => {
    const items = [login("A", "a", ["a.example.com"]), login("B", "b", ["b.example.com"]), login("C", "c", ["c.example.com"])];
    expect(planVaultImport(items, [], "skip", 2)).toMatchObject({ overLimit: 1, create: [{ name: "A" }, { name: "B" }] });
  });

  it("merges filled fields and adds sites, keeping the rest", () => {
    expect(mergePatch({ domains: ["mail.example.com"] }, { kind: "login", name: "x", password: "fake-new", domains: ["mail.example.com", "webmail.example.com"] }))
      .toEqual({ domains: ["mail.example.com", "webmail.example.com"], password: "fake-new" });
  });
});

describe("export then import", () => {
  const items: VaultTransferItem[] = [
    { kind: "login", name: "Portail", username: "alex@example.com", password: "fake,\"pass\"\nline", totpSeed: "JBSWY3DPEHPK3PXP", notes: "Note, \"quoted\"", domains: ["portal.example.com", "*.example.net", "example.org:8443", "http://localhost:3000"] },
    { kind: "note", name: "Note", notes: "fake note\nsecond line", domains: [] },
    { kind: "apiKey", name: "Clé", apiKey: "fake-api-key-rt", domains: ["api.example.com"] },
  ];

  it("Bitwarden JSON and CSV come back exactly", async () => {
    for (const format of ["bitwarden-json", "bitwarden-csv"] as const) {
      const file = exportVaultItems(items, format);
      expect(file).toMatchObject({ count: 3, left: 0, totpLeft: 0 });
      const back = await parseVaultImportFile(new TextEncoder().encode(file.text));
      expect(back.format, format).toBe(format);
      // a wildcard comes back as its exact host: a file never creates one
      expect(back.items, format).toEqual(items.map((item) => ({ ...item, domains: item.domains.map((domain) => domain.replace(/^\*\./, "")) })));
      expect(back.skipped).toEqual([]);
      expect(back.dropped).toEqual({});
    }
  });

  it("keeps a spreadsheet from running a name or a note, never touching a password", () => {
    const file = exportVaultItems([{ kind: "login", name: "=HYPERLINK(1)", username: "+user", password: "=fake-pass", notes: "@note", domains: ["example.com"] }], "chrome-csv");
    expect(file.text.split("\r\n")[1]).toBe("'=HYPERLINK(1),https://example.com,+user,=fake-pass,'@note");
  });

  it("refuses a zip that claims to inflate far beyond its size", async () => {
    const big = new TextEncoder().encode(JSON.stringify({ accounts: [], pad: "x".repeat(400_000) }));
    const stream = new Blob([big]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const deflated = new Uint8Array(await new Response(stream).arrayBuffer());
    const name = new TextEncoder().encode("export.data");
    const u16 = (n: number) => [n & 255, (n >> 8) & 255];
    const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
    const local = [...u32(0x04034b50), ...u16(20), 0, 0, ...u16(8), 0, 0, 0, 0, 0, 0, 0, 0, ...u32(deflated.length), ...u32(big.length), ...u16(name.length), 0, 0, ...name, ...deflated];
    const central = [...u32(0x02014b50), ...u16(20), ...u16(20), 0, 0, ...u16(8), 0, 0, 0, 0, 0, 0, 0, 0, ...u32(deflated.length), ...u32(big.length), ...u16(name.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(0), ...name];
    const end = [...u32(0x06054b50), 0, 0, 0, 0, ...u16(1), ...u16(1), ...u32(central.length), ...u32(local.length), 0, 0];
    await expect(parseVaultImportFile(new Uint8Array([...local, ...central, ...end]))).rejects.toMatchObject({ code: "too_large" });
  });

  it("Chrome CSV keeps logins with their first site and says what it cannot hold", async () => {
    const file = exportVaultItems(items, "chrome-csv");
    expect(file).toMatchObject({ count: 1, left: 2, totpLeft: 1, extension: "csv" });
    expect(file.text.split("\r\n")[0]).toBe("name,url,username,password,note");
    const back = await parseVaultImportFile(new TextEncoder().encode(file.text));
    expect(back.format).toBe("chrome-csv");
    expect(back.items).toEqual([{ kind: "login", name: "Portail", username: "alex@example.com", password: "fake,\"pass\"\nline", notes: "Note, \"quoted\"", domains: ["portal.example.com"] }]);
  });
});
