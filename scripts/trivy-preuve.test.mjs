import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { findingsFromScan, findingsSummary, parseTrivyignore } from "./trivy-ignore-guard.mjs";

const root = join(import.meta.dirname, "..");
const dir = join(root, "docs/preuve/trivy");

function load(name) {
  return JSON.parse(readFileSync(join(dir, name), "utf8"));
}

const FILES = ["amd64-before.json", "amd64-after.json", "arm64-before.json", "arm64-after.json"];

describe("raw Trivy preuve JSON", () => {
  it("stores amd64 and arm64 scans before and after as Trivy documents with a Results array", () => {
    for (const name of FILES) {
      const scan = load(name);
      expect(Array.isArray(scan.Results), name).toBe(true);
      expect(scan.Results.length, name).toBeGreaterThan(0);
    }
  });

  it("after amd64: 108 HIGH package rows are 35 unique HIGH plus CVE-2026-6653, matching .trivyignore", () => {
    const parsed = parseTrivyignore(readFileSync(join(root, ".trivyignore"), "utf8"));
    expect(parsed.errors).toEqual([]);
    const listed = parsed.entries.map((row) => row.id).sort();
    expect(listed).toHaveLength(36);

    const summary = findingsSummary(load("amd64-after.json"));
    expect(summary.ok).toBe(true);
    expect(summary.bySeverity.HIGH).toBe(108);
    expect(summary.bySeverity.CRITICAL).toBe(1);
    expect(summary.unique.HIGH).toHaveLength(35);
    expect(summary.unique.CRITICAL).toEqual(["CVE-2026-6653"]);
    expect([...summary.unique.CRITICAL, ...summary.unique.HIGH].sort()).toEqual(listed);

    const fixed = findingsFromScan(load("amd64-after.json")).filter(
      (row) => typeof row.FixedVersion === "string" && row.FixedVersion !== "",
    );
    expect(fixed).toEqual([]);
  });

  it("after arm64 unique HIGH+CRITICAL ids include the same .trivyignore list", () => {
    const parsed = parseTrivyignore(readFileSync(join(root, ".trivyignore"), "utf8"));
    const listed = new Set(parsed.entries.map((row) => row.id));
    const summary = findingsSummary(load("arm64-after.json"));
    expect(summary.ok).toBe(true);
    const unique = new Set([...summary.unique.CRITICAL, ...summary.unique.HIGH]);
    for (const id of listed) {
      expect(unique.has(id), id).toBe(true);
    }
  });
});
