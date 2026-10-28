// A separate process that reads logs and databases and writes a local
// report. It does not modify them, it does not call a model, and it does
// not open a ticket or write anywhere but the report file. It keeps going
// when a file is missing or the app is not running.
import { DatabaseSync } from "node:sqlite";
import { lstatSync, mkdirSync, openSync, readSync, closeSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { writeFileAtomic } from "./atomic.ts";

const TAIL_BYTES = 2_000_000;
const FAILURE_STATUSES = new Set(["failed"]);

export interface HealthGroup { key: string; count: number }
export interface HealthNote { file: string; note: string }
export interface HealthReport { scannedAt: string; groups: HealthGroup[]; notes: HealthNote[] }

function pushGroup(groups: Map<string, number>, key: string, count = 1): void {
  const safe = key.replace(/[\r\n]/g, " ").slice(0, 80);
  groups.set(safe, (groups.get(safe) ?? 0) + count);
}

function isLink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

function readTail(path: string): string | null {
  if (isLink(path)) return null;
  let fd: number | null = null;
  try {
    const size = lstatSync(path).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    fd = openSync(path, "r");
    readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8");
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

function scanNdjson(path: string, groups: Map<string, number>, notes: HealthNote[]): void {
  const text = readTail(path);
  if (text === null) {
    notes.push({ file: path, note: "could not read" });
    return;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let record: Record<string, unknown>;
    try { record = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (record.type !== "runtime.error") continue;
    const message = typeof record.message === "string" ? record.message : "";
    const key = /^[a-z][a-z0-9_]{0,40}$/.test(message) ? message : record.setup === true ? "setup" : record.terminal === true ? "terminal" : "runtime.error";
    pushGroup(groups, key);
  }
}

function scanDirectory(dir: string, groups: Map<string, number>, notes: HealthNote[]): void {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.endsWith(".ndjson")) continue;
    scanNdjson(join(dir, name), groups, notes);
  }
}

function openReadOnly(path: string): DatabaseSync | null {
  if (isLink(path)) return null;
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    db.exec("PRAGMA query_only = ON");
    return db;
  } catch {
    return null;
  }
}

function tableExists(db: DatabaseSync, table: string): boolean {
  const row = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { ok?: number } | undefined;
  return row?.ok === 1;
}

function scanDatabase(path: string, groups: Map<string, number>, notes: HealthNote[]): void {
  const db = openReadOnly(path);
  if (!db) {
    try { if (lstatSync(path).isFile()) notes.push({ file: path, note: "could not read" }); } catch { /* missing is fine */ }
    return;
  }
  try {
    if (tableExists(db, "assignments")) {
      const rows = db.prepare("SELECT json_extract(json, '$.outcome') AS outcome, COUNT(*) AS n FROM assignments WHERE status = 'failed' GROUP BY outcome").all() as Array<{ outcome: unknown; n: number }>;
      for (const row of rows) {
        const outcome = typeof row.outcome === "string" && /^[a-z0-9_]{1,40}$/i.test(row.outcome) ? row.outcome : "failed";
        if (FAILURE_STATUSES.has("failed")) pushGroup(groups, `failed ${outcome}`, Number(row.n) || 0);
      }
    }
    if (tableExists(db, "assignment_events")) {
      const rows = db.prepare("SELECT kind, COUNT(*) AS n FROM assignment_events WHERE kind LIKE '%fail%' OR kind LIKE '%error%' GROUP BY kind").all() as Array<{ kind: unknown; n: number }>;
      for (const row of rows) {
        if (typeof row.kind === "string" && /^[a-z0-9_.:-]{1,40}$/i.test(row.kind)) pushGroup(groups, `event ${row.kind}`, Number(row.n) || 0);
      }
    }
  } catch {
    notes.push({ file: path, note: "could not read" });
  } finally {
    db.close();
  }
}

function scanLogs(dir: string, groups: Map<string, number>): void {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { return; }
  for (const name of names) {
    if (!name.endsWith(".log") || name.includes("..")) continue;
    const text = readTail(join(dir, name));
    if (text === null) continue;
    const count = text.split("\n").filter((line) => /\berror\b/i.test(line)).length;
    if (count) pushGroup(groups, `log ${name}`, count);
  }
}

/** Read `dataDir` and group failures. Message text is not copied into the report. */
export function scanHealth(dataDir: string, now = new Date()): HealthReport {
  const groups = new Map<string, number>();
  const notes: HealthNote[] = [];
  scanDirectory(join(dataDir, "events"), groups, notes);
  scanDirectory(join(dataDir, "native"), groups, notes);
  scanDatabase(join(dataDir, "runtime.db"), groups, notes);
  scanDatabase(join(dataDir, "messages.db"), groups, notes);
  scanLogs(join(dataDir, "logs"), groups);
  return {
    scannedAt: now.toISOString(),
    groups: [...groups.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
    notes: notes.map((note) => ({ file: note.file.slice(dataDir.length + 1) || note.file, note: note.note })),
  };
}

export function formatHealthReport(report: HealthReport): string {
  const lines = [
    "# Health report",
    "",
    `Scanned: ${report.scannedAt}`,
    "",
    "This file is a local report. It does not change databases or logs.",
    "",
  ];
  if (!report.groups.length) lines.push("No failures in the files that could be read.", "");
  else {
    lines.push("Failures:", "");
    for (const group of report.groups) lines.push(`- ${group.key} (${group.count})`);
    lines.push("");
  }
  if (report.notes.length) {
    lines.push("Skipped:", "");
    for (const note of report.notes) lines.push(`- ${note.file}: ${note.note}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function writeHealthReport(dataDir: string, report: HealthReport): string {
  const dir = join(dataDir, "health-reports");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const text = formatHealthReport(report);
  const latest = join(dir, "latest.md");
  writeFileAtomic(latest, text, { mode: 0o600 });
  const stamp = report.scannedAt.replace(/[:.]/g, "-");
  writeFileAtomic(join(dir, `${stamp}.md`), text, { mode: 0o600 });
  return latest;
}

function dataDirFromArgs(argv: string[]): string {
  const index = argv.indexOf("--data");
  const given = index >= 0 ? argv[index + 1] : undefined;
  return resolve(given || process.env.SAGAX_DATA_DIR || join(homedir(), ".sagax"));
}

export function runHealthScan(argv: string[]): number {
  const dataDir = dataDirFromArgs(argv);
  try {
    if (!lstatSync(dataDir).isDirectory() || isLink(dataDir)) {
      process.stdout.write("No data directory to scan.\n");
      return 0;
    }
  } catch {
    process.stdout.write("No data directory to scan.\n");
    return 0;
  }
  const path = writeHealthReport(dataDir, scanHealth(dataDir));
  process.stdout.write(`${path}\n`);
  return 0;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  process.exitCode = runHealthScan(process.argv.slice(2));
}
