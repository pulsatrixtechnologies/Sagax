#!/usr/bin/env node
// Knip ratchet for #1385. Unused files must not grow past the allowlist.
// Exports, types and duplicate exports are printed as a report so the next
// pass can turn them into a ratchet the same way unused-keys.allow.txt did
// for i18n.
//
//   pnpm check:unused
//   pnpm check:unused --write-allow   refresh the unused-files allowlist
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const allowPath = join(root, "scripts", "unused-files.allow.txt");
const writeAllow = process.argv.includes("--write-allow");

const knip = join(root, "node_modules", "knip", "bin", "knip.js");
const run = spawnSync(
  process.execPath,
  [knip, "--no-progress", "--reporter", "json", "--include", "files,exports,types,duplicates"],
  { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
);

if (run.error) {
  console.error(`knip failed to start: ${run.error.message}`);
  process.exit(1);
}

if (run.stderr && /error|ERROR/i.test(run.stderr) && run.status && run.status > 1) {
  console.error(run.stderr.trim());
  process.exit(run.status);
}

let report;
try {
  report = JSON.parse(run.stdout || "{}");
} catch {
  console.error("knip did not return JSON");
  if (run.stderr) console.error(run.stderr.trim());
  if (run.stdout) console.error(run.stdout.slice(0, 2000));
  process.exit(1);
}

const issues = Array.isArray(report.issues) ? report.issues : [];

function named(list, file) {
  const out = [];
  for (const item of list || []) {
    const name = typeof item === "string" ? item : item?.name;
    if (name) out.push(`${file}:${name}`);
  }
  return out;
}

const files = [];
const exports = [];
const types = [];
const duplicates = [];

for (const issue of issues) {
  if (typeof issue === "string") {
    files.push(issue);
    continue;
  }
  if (!issue || typeof issue !== "object" || typeof issue.file !== "string") continue;
  const file = issue.file;
  if (Array.isArray(issue.files) && issue.files.length > 0) files.push(file);
  exports.push(...named(issue.exports, file));
  types.push(...named(issue.types, file));
  duplicates.push(...named(issue.duplicates, file));
}

files.sort();
exports.sort();
types.sort();
duplicates.sort();

console.log(
  `knip report: files=${files.length} exports=${exports.length} types=${types.length} duplicates=${duplicates.length}`,
);
if (exports.length) {
  console.log(`unused exports (first 20 of ${exports.length}):`);
  for (const row of exports.slice(0, 20)) console.log(`  ${row}`);
}
if (types.length) {
  console.log(`unused types (first 10 of ${types.length}):`);
  for (const row of types.slice(0, 10)) console.log(`  ${row}`);
}
if (duplicates.length) {
  console.log(`duplicate exports (first 10 of ${duplicates.length}):`);
  for (const row of duplicates.slice(0, 10)) console.log(`  ${row}`);
}

if (writeAllow) {
  writeFileSync(allowPath, `${files.join("\n")}${files.length ? "\n" : ""}`);
  console.log(`wrote ${files.length} unused files to ${allowPath}`);
  process.exit(0);
}

const allowed = readFileSync(allowPath, "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));

const allowedSet = new Set(allowed);
const novel = files.filter((file) => !allowedSet.has(file));
const resolved = allowed.filter((file) => !files.includes(file));
const orderMismatch =
  !novel.length && !resolved.length && (allowed.length !== files.length || allowed.some((file, i) => file !== files[i]));

if (novel.length || resolved.length || orderMismatch) {
  if (novel.length) {
    console.error(
      `unused files grew by ${novel.length} (remove the file or add it with --write-allow after review):`,
    );
    for (const file of novel) console.error(`  + ${file}`);
  }
  if (resolved.length) {
    console.error(
      `unused files shrank by ${resolved.length} (drop them from scripts/unused-files.allow.txt):`,
    );
    for (const file of resolved) console.error(`  - ${file}`);
  }
  if (orderMismatch) {
    console.error("scripts/unused-files.allow.txt is out of order; run pnpm check:unused --write-allow");
  }
  process.exit(1);
}

console.log(`unused files ratchet OK (${files.length})`);
