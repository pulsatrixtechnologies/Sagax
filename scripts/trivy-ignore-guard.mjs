#!/usr/bin/env node
// Staleness check for .trivyignore. Trivy itself drops listed CVEs; this
// script reads a scan taken WITHOUT that file and fails when a listed CVE
// now has a FixedVersion, or when the review date has passed. Entries are
// explicit CVE ids (no wildcards), each with a reason and Review date.
//
// Fail closed: an unusable scan, an empty Results array under --gated,
// an empty ignore file, a whitespace FixedVersion, an invalid calendar
// date, UNKNOWN severity, a listed id missing from the scan, a duplicated
// ignore id, or a --gated row with no VulnerabilityID (including LOW)
// is an error (non-zero exit).
//
//   node scripts/trivy-ignore-guard.mjs --ignore .trivyignore --scan scan.json
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CVE_LINE = /^CVE-\d{4}-\d+$/;
const REVIEW = /Review\s+(\d{4}-\d{2}-\d{2})/g;
const REASON_OK = /no-dsa|pas de correctif dans trixie/i;
const KNOWN_SEVERITY = new Set(["CRITICAL", "HIGH", "MEDIUM", "LOW", "NEGLIGIBLE"]);

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

/** True only for a real UTC calendar day (`2099-99-99` is not). */
export function isCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ""));
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function reviewDatesIn(reason) {
  return [...String(reason).matchAll(REVIEW)].map((match) => match[1]);
}

/** Parse `.trivyignore`: one CVE per line, comment above with reason + Review date. */
export function parseTrivyignore(text) {
  const errors = [];
  const entries = [];
  const source = String(text ?? "");
  const lines = source.split(/\r?\n/);
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
    if (entries.some((row) => row.id === line)) {
      errors.push(`${line} is listed more than once`);
    }
    const reason = comments.join(" ").trim();
    const reviews = reviewDatesIn(reason);
    if (!reason) errors.push(`${line} is missing a comment`);
    else if (reviews.length === 0) errors.push(`${line} is missing a Review date`);
    else if (reviews.length > 1) errors.push(`${line} has more than one Review date (${reviews.join(", ")})`);
    else if (!isCalendarDate(reviews[0])) errors.push(`${line} has an invalid Review date ${reviews[0]}`);
    else if (!REASON_OK.test(reason)) {
      errors.push(`${line} comment must say Debian no-dsa or pas de correctif dans trixie`);
    }
    entries.push({
      id: line,
      reason,
      reviewDate: reviews.length === 1 && isCalendarDate(reviews[0]) ? reviews[0] : "",
    });
    comments = [];
  }
  if (entries.length === 0) errors.push("ignore file lists no CVE");
  return { entries, errors };
}

/**
 * A FixedVersion of spaces is not "no fix". Only a missing or strictly
 * empty string counts as unfixed.
 */
export function fixedVersionOf(finding) {
  if (!finding || !Object.prototype.hasOwnProperty.call(finding, "FixedVersion")) return "";
  const value = finding.FixedVersion;
  if (value == null) return "";
  if (typeof value !== "string") return String(value);
  if (value === "") return "";
  return value.trim() || "<whitespace>";
}

function severityOf(finding) {
  return String(finding?.Severity ?? "").trim().toUpperCase();
}

/** HIGH/CRITICAL/… rows from a Trivy JSON document. `Results` must already be an array. */
export function findingsFromScan(scan) {
  const rows = [];
  for (const result of Array.isArray(scan?.Results) ? scan.Results : []) {
    for (const finding of Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : []) {
      rows.push(finding);
    }
  }
  return rows;
}

/**
 * Fail closed unless the document is an object with a `Results` array.
 * `{}` and `{ Results: null }` are not scans.
 */
export function usableScan(scan) {
  if (scan == null || typeof scan !== "object" || Array.isArray(scan)) {
    return { ok: false, errors: ["scan is not a Trivy document"] };
  }
  if (!Object.prototype.hasOwnProperty.call(scan, "Results") || !Array.isArray(scan.Results)) {
    return { ok: false, errors: ["scan Results is missing or not an array"] };
  }
  return { ok: true, errors: [] };
}

function unknownSeverityErrors(findings) {
  const errors = [];
  for (const finding of findings) {
    const severity = severityOf(finding);
    if (KNOWN_SEVERITY.has(severity)) continue;
    const id = finding?.VulnerabilityID ?? "(missing id)";
    errors.push(`${id} has unusable severity ${severity || "UNKNOWN"}`);
  }
  return errors;
}

/** A row with no CVE id is not a clean remainder, even at LOW. */
function missingIdErrors(findings) {
  const errors = [];
  for (const finding of findings) {
    const id = String(finding?.VulnerabilityID ?? "").trim();
    if (id) continue;
    const severity = severityOf(finding) || "UNKNOWN";
    errors.push(`finding with severity ${severity} has no VulnerabilityID`);
  }
  return errors;
}

/** Per-package vs unique CVE ids, to reconcile Trivy row counts with `.trivyignore`. */
export function findingsSummary(scan) {
  const usable = usableScan(scan);
  if (!usable.ok) return { ok: false, errors: usable.errors, bySeverity: {}, unique: { CRITICAL: [], HIGH: [] } };
  const bySeverity = {};
  const unique = { CRITICAL: new Set(), HIGH: new Set() };
  for (const finding of findingsFromScan(scan)) {
    const severity = severityOf(finding);
    bySeverity[severity] = (bySeverity[severity] ?? 0) + 1;
    if (severity === "CRITICAL" || severity === "HIGH") {
      unique[severity].add(finding.VulnerabilityID);
    }
  }
  return {
    ok: true,
    errors: [],
    bySeverity,
    unique: {
      CRITICAL: [...unique.CRITICAL].sort(),
      HIGH: [...unique.HIGH].sort(),
    },
  };
}

/** Remaining CRITICAL/HIGH counts in a scan already filtered by `.trivyignore`. */
export function highCriticalCounts(scan) {
  const counts = { CRITICAL: 0, HIGH: 0 };
  for (const finding of findingsFromScan(scan)) {
    const severity = severityOf(finding);
    if (severity === "CRITICAL" || severity === "HIGH") counts[severity] += 1;
  }
  return counts;
}

/**
 * Gated remaining-count check. An unusable document, an empty Results
 * array, UNKNOWN severity, or a row without an id fails even when the
 * CRITICAL/HIGH counts are zero.
 */
export function assessGatedScan(scan) {
  const usable = usableScan(scan);
  if (!usable.ok) return { ok: false, errors: usable.errors, counts: { CRITICAL: 0, HIGH: 0 } };
  if (scan.Results.length === 0) {
    return { ok: false, errors: ["scan Results is empty"], counts: { CRITICAL: 0, HIGH: 0 } };
  }
  const findings = findingsFromScan(scan);
  const errors = [...unknownSeverityErrors(findings), ...missingIdErrors(findings)];
  const counts = highCriticalCounts(scan);
  if (counts.CRITICAL) errors.push(`gated remaining critical=${counts.CRITICAL}`);
  if (counts.HIGH) errors.push(`gated remaining high=${counts.HIGH}`);
  return { ok: errors.length === 0, errors, counts };
}

/**
 * Fail closed when a listed CVE gained a Debian/Trivy fix, the review
 * date is past, the scan cannot be read, a listed id is missing, or a
 * finding has UNKNOWN severity. `today` is YYYY-MM-DD (UTC).
 */
export function assessIgnoreGuard({ ignoreText, scan, today } = {}) {
  const usable = usableScan(scan);
  const parsed = parseTrivyignore(ignoreText);
  const errors = [...usable.errors, ...parsed.errors];
  if (!usable.ok) {
    return { ok: false, errors, entries: parsed.entries, nowFixed: [] };
  }
  const day = utcToday(today);
  const listed = new Map(parsed.entries.map((row) => [row.id, row]));
  for (const row of parsed.entries) {
    if (row.reviewDate && day > row.reviewDate) {
      errors.push(`${row.id} review date ${row.reviewDate} is past (today ${day})`);
    }
  }
  const findings = findingsFromScan(scan);
  errors.push(...unknownSeverityErrors(findings));
  const seen = new Set();
  const nowFixed = [];
  for (const finding of findings) {
    const id = finding?.VulnerabilityID;
    if (!id || !listed.has(id)) continue;
    seen.add(id);
    const fixed = fixedVersionOf(finding);
    if (!fixed) continue;
    nowFixed.push({ id, fixed });
    errors.push(`${id} now has FixedVersion ${fixed}`);
  }
  for (const row of parsed.entries) {
    if (!seen.has(row.id)) errors.push(`${row.id} is listed in .trivyignore but absent from the scan`);
  }
  return {
    ok: errors.length === 0,
    errors,
    entries: parsed.entries,
    nowFixed,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.gated) {
    const result = assessGatedScan(readJson(args.gated));
    if (!result.ok) {
      for (const error of result.errors) console.error(`[trivy-ignore] ${error}`);
      process.exit(1);
    }
    console.log(`gated remaining: critical=${result.counts.CRITICAL} high=${result.counts.HIGH}`);
    return;
  }
  if (!args.ignore || !args.scan) {
    throw new Error("usage: node scripts/trivy-ignore-guard.mjs --ignore <file> --scan <trivy.json>");
  }
  const ignoreText = readFileSync(args.ignore, "utf8");
  const scan = readJson(args.scan);
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
