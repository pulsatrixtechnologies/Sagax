import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeVulnPredicates, severityCounts } from "./vuln-attestation.mjs";

function predicate(severities) {
  return {
    invocation: { parameters: null, uri: "", event_id: "", "builder.id": "" },
    scanner: {
      uri: "pkg:github/aquasecurity/trivy@v0.75.0",
      version: "0.75.0",
      db: { uri: "", version: "" },
      result: {
        SchemaVersion: 2,
        Results: [{ Target: "image", Vulnerabilities: severities.map((Severity) => ({ Severity })) }],
      },
    },
    metadata: { scanStartedOn: "2026-10-13T00:00:00.000Z", scanFinishedOn: "2026-10-13T00:00:01.000Z" },
  };
}

describe("vulnerability attestation summary", () => {
  it("counts only critical and high findings", () => {
    expect(severityCounts(predicate(["CRITICAL", "HIGH", "MEDIUM", "LOW", "CRITICAL"]))).toEqual({
      Critical: 2,
      High: 1,
    });
  });

  it("treats a scan with no vulnerabilities as zero", () => {
    const clean = predicate([]);
    clean.scanner.result.Results = [{ Target: "image" }];
    expect(severityCounts(clean)).toEqual({ Critical: 0, High: 0 });
    const empty = predicate([]);
    empty.scanner.result.Results = null;
    expect(severityCounts(empty)).toEqual({ Critical: 0, High: 0 });
  });

  it("merges platform scans into the summary the admission policy reads", () => {
    const merged = mergeVulnPredicates([
      predicate(["HIGH"]),
      predicate(["CRITICAL", "MEDIUM"]),
    ]);
    expect(merged.scanner.result.Results).toHaveLength(2);
    expect(merged.scanner.result.Summary).toEqual({ Critical: 1, High: 1 });
    expect(merged.scanner.uri).toBe("pkg:github/aquasecurity/trivy@v0.75.0");
    expect(merged.scanner.result.SchemaVersion).toBe(2);
  });

  it("refuses a predicate that is not a vulnerability record", () => {
    expect(() => mergeVulnPredicates([])).toThrow(/at least one/);
    expect(() => mergeVulnPredicates([{}])).toThrow(/missing scanner/);
  });

  it("exits 1 when the summary the policy compares is not zero", () => {
    const dir = mkdtempSync(join(tmpdir(), "vuln-attestation-"));
    const input = join(dir, "scan.json");
    const output = join(dir, "out.json");
    writeFileSync(input, JSON.stringify(predicate(["HIGH"])));
    const failed = spawnSync(process.execPath, ["scripts/vuln-attestation.mjs", output, input], {
      cwd: join(import.meta.dirname, ".."),
      encoding: "utf8",
    });
    expect(failed.status).toBe(1);
    expect(JSON.parse(readFileSync(output, "utf8")).scanner.result.Summary).toEqual({ Critical: 0, High: 1 });

    writeFileSync(input, JSON.stringify(predicate([])));
    const clean = spawnSync(process.execPath, ["scripts/vuln-attestation.mjs", output, input], {
      cwd: join(import.meta.dirname, ".."),
      encoding: "utf8",
    });
    expect(clean.status).toBe(0);
    expect(clean.stdout).toContain("critical=0 high=0");
  });
});
