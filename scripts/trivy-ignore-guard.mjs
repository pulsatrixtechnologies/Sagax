#!/usr/bin/env node
// Staleness check for .trivyignore. Trivy itself drops listed CVEs; this
// script reads a scan taken WITHOUT that file and fails when a listed CVE
// now has a FixedVersion, or when the review date has passed. Entries are
// explicit CVE ids (no wildcards), each with a reason and Review date.
//
//   node scripts/trivy-ignore-guard.mjs --ignore .trivyignore --scan scan.json
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CVE_LINE = /^CVE-\d{4}-\d+$/;
const REVIEW = /Review\s+(\d{4}-\d{2}-\d{2})/;
const REASON_OK = /no-dsa|pas de correctif dans trixie/i;

export function parseArgs(argv) {
  const out = { ignore: "", scan: "", today: "", gated: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[++i];
    if (flag === "--ignore") out.ignore = value ?? "";
    else if (flag === "--scan") out.scan = value ?? "";
    else if (flag === "--today") out.today = value ?? "";
    else if (flag === "--gated") out.gated = value ?? "";
    else throw new Error(`unknown argument: ${flag}`);
    if (!value) throw new Error(`${flag} needs a value`);
  }
  return out;
}

function utcToday(value) {
  if (value) return String(value);
  return new Date().toISOString().slice(0, 10);
}

/** Parse `.trivyignore`: one CVE per line, comment above with reason + Review date. */
export function parseTrivyignore(text) {
  const errors = [];
  const entries = [];
  const lines = String(text ?? "").split(/\r?\n/);
  let comments = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      comments.push(line.replace(/^#\s?/, ""));
      continue;
    }
    if (/[*?]/.test(line) || !CVE_LINE.test(line)) {
      errors.push(`wildcard or invalid CVE: ${line}`);
      comments = [];
      continue;
    }
    const reason = comments.join(" ").trim();
    const review = reason.match(REVIEW);
    if (!reason) errors.push(`${line} is missing a comment`);
    else if (!review) errors.push(`${line} is missing a Review date`);
    else if (!REASON_OK.test(reason)) {
      errors.push(`${line} comment must say Debian no-dsa or pas de correctif dans trixie`);
    }
    entries.push({
      id: line,
      reason,
      reviewDate: review ? review[1] : "",
    });
    comments = [];
  }
  return { entries, errors };
}

function fixedVersionOf(finding) {
  const value = finding?.FixedVersion;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

/** HIGH/CRITICAL rows from a Trivy JSON document. */
export function findingsFromScan(scan) {
  const rows = [];
  for (const result of Array.isArray(scan?.Results) ? scan.Results : []) {
    for (const finding of Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : []) {
      rows.push(finding);
    }
  }
  return rows;
}

/** Remaining CRITICAL/HIGH counts in a scan already filtered by `.trivyignore`. */
export function highCriticalCounts(scan) {
  const counts = { CRITICAL: 0, HIGH: 0 };
  for (const finding of findingsFromScan(scan)) {
    const severity = String(finding?.Severity ?? "").toUpperCase();
    if (severity === "CRITICAL" || severity === "HIGH") counts[severity] += 1;
  }
  return counts;
}

/**
 * Fail closed when a listed CVE gained a Debian/Trivy fix, or the review
 * date is past. `today` is YYYY-MM-DD (UTC).
 */
export function assessIgnoreGuard({ ignoreText, scan, today } = {}) {
  const parsed = parseTrivyignore(ignoreText);
  const errors = [...parsed.errors];
  const day = utcToday(today);
  const listed = new Map(parsed.entries.map((row) => [row.id, row]));
  for (const row of parsed.entries) {
    if (row.reviewDate && day > row.reviewDate) {
      errors.push(`${row.id} review date ${row.reviewDate} is past (today ${day})`);
    }
  }
  const nowFixed = [];
  for (const finding of findingsFromScan(scan)) {
    const id = finding?.VulnerabilityID;
    if (!id || !listed.has(id)) continue;
    const fixed = fixedVersionOf(finding);
    if (!fixed) continue;
    nowFixed.push({ id, fixed });
    errors.push(`${id} now has FixedVersion ${fixed}`);
  }
  return {
    ok: errors.length === 0,
    errors,
    entries: parsed.entries,
    nowFixed,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.gated) {
    const counts = highCriticalCounts(JSON.parse(readFileSync(args.gated, "utf8")));
    console.log(`gated remaining: critical=${counts.CRITICAL} high=${counts.HIGH}`);
    if (counts.CRITICAL || counts.HIGH) process.exit(1);
    return;
  }
  if (!args.ignore || !args.scan) {
    throw new Error("usage: node scripts/trivy-ignore-guard.mjs --ignore <file> --scan <trivy.json>");
  }
  const ignoreText = readFileSync(args.ignore, "utf8");
  const scan = JSON.parse(readFileSync(args.scan, "utf8"));
  const result = assessIgnoreGuard({ ignoreText, scan, today: args.today });
  for (const row of result.entries) {
    console.log(`[trivy-ignore] ${row.id} review ${row.reviewDate}`);
  }
  if (!result.ok) {
    for (const error of result.errors) console.error(`[trivy-ignore] ${error}`);
    process.exit(1);
  }
  console.log(`[trivy-ignore] ok ${result.entries.length} exception(s), none have a FixedVersion`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`[trivy-ignore] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
