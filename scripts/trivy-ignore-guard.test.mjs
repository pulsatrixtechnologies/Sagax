import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assessGatedScan,
  assessIgnoreGuard,
  findingsSummary,
  parseTrivyignore,
} from "./trivy-ignore-guard.mjs";

const script = join(import.meta.dirname, "trivy-ignore-guard.mjs");

/** Built at runtime so the source does not contain an identifier. */
const LISTED = ["CVE", "0000", "0001"].join("-");
const OTHER = ["CVE", "0000", "0002"].join("-");

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
          ...(Object.prototype.hasOwnProperty.call(row, "fixed") ? { FixedVersion: row.fixed } : {}),
          Status: "affected",
        })),
      },
    ],
  };
}

const listed = ignoreFile(`
# Debian no-dsa. Review 2026-11-13
${LISTED}
`);

function withTemp(run) {
  const dir = mkdtempSync(join(tmpdir(), "trivy-ignore-guard-"));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runGuard({ ignore, scan: scanDoc, gated, today, allowEmpty = false } = {}) {
  return withTemp((dir) => {
    const args = [];
    if (allowEmpty) args.push("--allow-empty");
    if (gated !== undefined) {
      const path = join(dir, "gated.json");
      writeFileSync(path, typeof gated === "string" ? gated : JSON.stringify(gated));
      args.push("--gated", path);
    } else {
      writeFileSync(join(dir, "exceptions.txt"), ignore ?? "");
      writeFileSync(join(dir, "scan.json"), typeof scanDoc === "string" ? scanDoc : JSON.stringify(scanDoc));
      args.push("--ignore", join(dir, "exceptions.txt"), "--scan", join(dir, "scan.json"));
    }
    if (today) args.push("--today", today);
    return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  });
}

describe("trivy ignore guard", () => {
  it("accepts listed CVEs that still have no FixedVersion before the review date", () => {
    const result = assessIgnoreGuard({
      ignoreText: listed,
      scan: scan([{ id: LISTED, severity: "CRITICAL" }]),
      today: "2026-10-14",
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.entries.map((row) => row.id)).toEqual([LISTED]);
    const cli = runGuard({
      ignore: listed,
      scan: scan([{ id: LISTED, severity: "CRITICAL" }]),
      today: "2026-10-14",
    });
    expect(cli.status, cli.stderr + cli.stdout).toBe(0);
    expect(cli.stdout).toMatch(/ok 1 exception/);
    expect(cli.stdout + cli.stderr).not.toContain(LISTED);
  });

  it("refuses a listed CVE that now has a FixedVersion", () => {
    const result = assessIgnoreGuard({
      ignoreText: listed,
      scan: scan([{ id: LISTED, severity: "CRITICAL", fixed: "2.14.5+dfsg-0.1" }]),
      today: "2026-10-14",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(LISTED);
    expect(result.errors.join("\n")).toMatch(/FixedVersion/);
    expect(result.errors.join("\n")).toMatch(/2\.14\.5\+dfsg-0\.1/);
  });

  it("refuses when the review date is past", () => {
    const result = assessIgnoreGuard({
      ignoreText: listed,
      scan: scan([{ id: LISTED, severity: "CRITICAL" }]),
      today: "2026-11-14",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/2026-11-13/);
    expect(result.errors.join("\n")).toMatch(/past/);
  });
});

describe("fail closed", () => {
  it("refuses an empty scan object {}", () => {
    const result = assessIgnoreGuard({ ignoreText: listed, scan: {}, today: "2026-10-14" });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/Results/);
    const cli = runGuard({ ignore: listed, scan: "{}", today: "2026-10-14" });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
  });

  it("refuses a scan whose Results is null", () => {
    const result = assessIgnoreGuard({
      ignoreText: listed,
      scan: { Results: null },
      today: "2026-10-14",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/Results/);
    const cli = runGuard({ ignore: listed, scan: { Results: null }, today: "2026-10-14" });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
  });

  it("refuses --gated on an empty scan object {}", () => {
    const result = assessGatedScan({});
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/Results/);
    const cli = runGuard({ gated: "{}" });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
    expect(cli.stdout).not.toMatch(/gated remaining: critical=0 high=0/);
  });

  it("refuses --gated when Results is null", () => {
    const result = assessGatedScan({ Results: null });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/Results/);
    const cli = runGuard({ gated: { Results: null } });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
    expect(cli.stdout).not.toMatch(/gated remaining: critical=0 high=0/);
  });

  it("refuses --gated when Results is an empty array", () => {
    const result = assessGatedScan({ Results: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/Results/);
    const cli = runGuard({ gated: { Results: [] } });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
    expect(cli.stdout).not.toMatch(/gated remaining: critical=0 high=0/);
    const raw = runGuard({ gated: '{"Results":[]}' });
    expect(raw.status, raw.stderr + raw.stdout).not.toBe(0);
    expect(raw.stdout).not.toMatch(/gated remaining: critical=0 high=0/);
  });

  it("refuses a listed CVE whose FixedVersion is only spaces", () => {
    const result = assessIgnoreGuard({
      ignoreText: listed,
      scan: scan([{ id: LISTED, severity: "CRITICAL", fixed: "   " }]),
      today: "2026-10-14",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/FixedVersion/);
    const cli = runGuard({
      ignore: listed,
      scan: scan([{ id: LISTED, severity: "CRITICAL", fixed: "   " }]),
      today: "2026-10-14",
    });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
  });

  it("refuses an invalid Review date 2099-99-99", () => {
    const ignore = ignoreFile(`
# Debian no-dsa. Review 2099-99-99
${LISTED}
`);
    const parsed = parseTrivyignore(ignore);
    expect(parsed.errors.join("\n")).toMatch(/invalid Review date 2099-99-99/);
    const result = assessIgnoreGuard({
      ignoreText: ignore,
      scan: scan([{ id: LISTED, severity: "CRITICAL" }]),
      today: "2026-10-14",
    });
    expect(result.ok).toBe(false);
    const cli = runGuard({
      ignore,
      scan: scan([{ id: LISTED, severity: "CRITICAL" }]),
      today: "2026-10-14",
    });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
  });

  it("refuses a comment that names two Review dates", () => {
    const ignore = ignoreFile(`
# Debian no-dsa. Review 2026-11-13 Review 2026-12-01
${LISTED}
`);
    const parsed = parseTrivyignore(ignore);
    expect(parsed.errors.join("\n")).toMatch(/more than one Review date/);
    const result = assessIgnoreGuard({
      ignoreText: ignore,
      scan: scan([{ id: LISTED, severity: "CRITICAL" }]),
      today: "2026-10-14",
    });
    expect(result.ok).toBe(false);
    const cli = runGuard({
      ignore,
      scan: scan([{ id: LISTED, severity: "CRITICAL" }]),
      today: "2026-10-14",
    });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
  });

  it("refuses an empty .trivyignore", () => {
    const parsed = parseTrivyignore("");
    expect(parsed.entries).toEqual([]);
    expect(parsed.errors.join("\n")).toMatch(/lists no CVE/);
    const result = assessIgnoreGuard({
      ignoreText: "",
      scan: scan([{ id: LISTED, severity: "CRITICAL" }]),
      today: "2026-10-14",
    });
    expect(result.ok).toBe(false);
    const cli = runGuard({
      ignore: "",
      scan: scan([{ id: LISTED, severity: "CRITICAL" }]),
      today: "2026-10-14",
    });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
  });

  it("refuses a finding whose severity is UNKNOWN", () => {
    const result = assessIgnoreGuard({
      ignoreText: listed,
      scan: scan([{ id: LISTED, severity: "UNKNOWN" }]),
      today: "2026-10-14",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/UNKNOWN/);
    const gated = assessGatedScan(scan([{ id: LISTED, severity: "UNKNOWN" }]));
    expect(gated.ok).toBe(false);
    expect(gated.errors.join("\n")).toMatch(/UNKNOWN/);
    const cli = runGuard({ gated: scan([{ id: LISTED, severity: "UNKNOWN" }]) });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
  });

  it("refuses --gated when a LOW finding has no VulnerabilityID", () => {
    const gated = {
      Results: [
        {
          Target: "openmausbot:ci (debian 13.7)",
          Class: "os-pkgs",
          Type: "debian",
          Vulnerabilities: [{ Severity: "LOW", PkgName: "tzdata", InstalledVersion: "1" }],
        },
      ],
    };
    const result = assessGatedScan(gated);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/VulnerabilityID|no identifier|missing id/i);
    const cli = runGuard({ gated });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
    expect(cli.stdout).not.toMatch(/gated remaining: critical=0 high=0/);
  });

  it("refuses a listed CVE that is absent from the scan", () => {
    const result = assessIgnoreGuard({
      ignoreText: listed,
      scan: scan([{ id: OTHER, severity: "HIGH" }]),
      today: "2026-10-14",
    });
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/absent from the scan/);
    const cli = runGuard({
      ignore: listed,
      scan: scan([]),
      today: "2026-10-14",
    });
    expect(cli.status, cli.stderr + cli.stdout).not.toBe(0);
    expect(cli.stderr).toMatch(/absent from the scan/);
    expect(cli.stderr + cli.stdout).not.toContain(LISTED);
  });

  it("accepts an empty ignore file when --allow-empty is set and still checks entries", () => {
    const empty = assessIgnoreGuard({
      ignoreText: "",
      scan: scan([{ id: OTHER, severity: "HIGH" }]),
      today: "2026-10-14",
      allowEmpty: true,
    });
    expect(empty.ok).toBe(true);
    expect(empty.entries).toEqual([]);
    const cli = runGuard({
      ignore: "# comments only\n",
      scan: scan([{ id: OTHER, severity: "HIGH" }]),
      today: "2026-10-14",
      allowEmpty: true,
    });
    expect(cli.status, cli.stderr + cli.stdout).toBe(0);
    expect(cli.stdout).toMatch(/ok 0 exception/);
    expect(cli.stdout + cli.stderr).not.toContain(OTHER);

    const stillChecked = assessIgnoreGuard({
      ignoreText: listed,
      scan: scan([{ id: LISTED, severity: "CRITICAL", fixed: "2" }]),
      today: "2026-10-14",
      allowEmpty: true,
    });
    expect(stillChecked.ok).toBe(false);
    expect(stillChecked.errors.join("\n")).toMatch(/FixedVersion/);
  });
});

describe("findingsSummary", () => {
  it("counts per-package rows separately from unique CVE ids", () => {
    const summary = findingsSummary(scan([
      { id: LISTED, severity: "CRITICAL", pkg: "libxml2" },
      { id: LISTED, severity: "CRITICAL", pkg: "libxml2-utils" },
      { id: OTHER, severity: "HIGH", pkg: "openssl" },
      { id: OTHER, severity: "HIGH", pkg: "libssl3" },
    ]));
    expect(summary.ok).toBe(true);
    expect(summary.bySeverity).toEqual({ CRITICAL: 2, HIGH: 2 });
    expect(summary.unique.CRITICAL).toEqual([LISTED]);
    expect(summary.unique.HIGH).toEqual([OTHER]);
  });
});

describe("parseTrivyignore", () => {
  it("refuses a duplicated CVE id", () => {
    const ignore = ignoreFile(`
# Debian no-dsa. Review 2026-11-13
${LISTED}
# Debian no-dsa. Review 2026-11-13
${LISTED}
`);
    const parsed = parseTrivyignore(ignore);
    expect(parsed.errors.join("\n")).toMatch(/more than once|duplicate/i);
  });

  it("reads explicit identifiers with a reason and one review date", () => {
    const second = ["CVE", "0000", "0003"].join("-");
    const ignore = ignoreFile(`
# Debian no-dsa. Review 2026-11-13
${LISTED}
# pas de correctif dans trixie. Review 2026-11-13
${second}
`);
    const parsed = parseTrivyignore(ignore);
    expect(parsed.errors).toEqual([]);
    expect(parsed.entries).toHaveLength(2);
    expect(parsed.entries.some((row) => /[*?]/.test(row.id))).toBe(false);
    for (const row of parsed.entries) {
      expect(row.id).toMatch(/^CVE-\d{4}-\d+$/);
      expect(row.reviewDate).toBe("2026-11-13");
      expect(/no-dsa/i.test(row.reason) || /pas de correctif dans trixie/i.test(row.reason)).toBe(true);
    }
    const ids = parsed.entries.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([LISTED, second]);
  });
});
