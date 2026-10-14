import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { assessIgnoreGuard, parseTrivyignore } from "./trivy-ignore-guard.mjs";

const root = join(import.meta.dirname, "..");

function ignoreFile(body) {
  return String(body).replace(/^\n/, "");
}

function scan(findings) {
  return {
    Results: [
      {
        Target: "openmausbot:ci (debian 13.7)",
        Class: "os-pkgs",
        Type: "debian",
        Vulnerabilities: findings.map((row) => ({
          VulnerabilityID: row.id,
          Severity: row.severity,
          PkgName: row.pkg ?? "libxml2",
          InstalledVersion: "1",
          ...(row.fixed ? { FixedVersion: row.fixed } : {}),
          Status: "affected",
        })),
      },
    ],
  };
}

const listed = ignoreFile(`
# Debian no-dsa. Review 2026-11-13
CVE-2026-6653
`);

describe("trivy ignore guard", () => {
  it("accepts listed CVEs that still have no FixedVersion before the review date", () => {
    const result = assessIgnoreGuard({
      ignoreText: listed,
      scan: scan([{ id: "CVE-2026-6653", severity: "CRITICAL" }]),
      today: "2026-10-14",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.entries.map((row) => row.id)).toEqual(["CVE-2026-6653"]);
  });

  it("refuses a listed CVE that now has a FixedVersion", () => {
    const result = assessIgnoreGuard({
      ignoreText: listed,
      scan: scan([{ id: "CVE-2026-6653", severity: "CRITICAL", fixed: "2.14.5+dfsg-0.1" }]),
      today: "2026-10-14",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/CVE-2026-6653/);
    expect(result.errors.join("\n")).toMatch(/FixedVersion/);
    expect(result.errors.join("\n")).toMatch(/2\.14\.5\+dfsg-0\.1/);
  });

  it("refuses when the review date is past", () => {
    const result = assessIgnoreGuard({
      ignoreText: listed,
      scan: scan([{ id: "CVE-2026-6653", severity: "CRITICAL" }]),
      today: "2026-11-14",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/2026-11-13/);
    expect(result.errors.join("\n")).toMatch(/past/);
  });
});

describe("parseTrivyignore", () => {
  it("reads the repository ignore file as explicit CVEs with a reason and review date", () => {
    const parsed = parseTrivyignore(readFileSync(join(root, ".trivyignore"), "utf8"));
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries.length).toBeGreaterThan(0);
    expect(parsed.entries.some((row) => /[*?]/.test(row.id))).toBe(false);
    for (const row of parsed.entries) {
      expect(row.id).toMatch(/^CVE-\d{4}-\d+$/);
      expect(row.reviewDate).toBe("2026-11-13");
      expect(
        /no-dsa/i.test(row.reason) || /pas de correctif dans trixie/i.test(row.reason),
        row.id,
      ).toBe(true);
    }
    expect(parsed.entries.some((row) => row.id === "CVE-2026-6653")).toBe(true);
  });
});
