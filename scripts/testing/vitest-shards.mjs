#!/usr/bin/env node
// Runs the vitest suite (or one group of it) as N concurrent vitest
// processes, each serial inside (vite.config.ts keeps fileParallelism off),
// and prints one summary. Exit code 1 when any shard fails.
//
//   node scripts/testing/vitest-shards.mjs                 every file
//   node scripts/testing/vitest-shards.mjs --group unit    no server boots
//   node scripts/testing/vitest-shards.mjs --group e2e     server-booting files
//   node scripts/testing/vitest-shards.mjs --shards 4 -- --bail=1
//   node scripts/testing/vitest-shards.mjs --list          print the selection
//
// Each shard writes its full output to <logs>/shard-<i>.log (a temp folder
// unless --logs is given). Each process gets its own Local VM test namespace
// from server/testing/global-setup.ts, and suites pick free ports themselves.
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, readFileSync, statSync, closeSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripVTControlCharacters } from "node:util";

import { balanceShards, isE2eTestFile, selectGroup } from "./test-groups.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const VITEST = join(ROOT, "node_modules", "vitest", "vitest.mjs");

function parseArgs(argv) {
  const options = { group: "all", shards: Math.max(2, Math.min(8, Math.floor(availableParallelism() / 2))), logs: null, list: false, extra: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") { options.extra = argv.slice(i + 1); break; }
    if (arg === "--list") options.list = true;
    else if (arg === "--group") options.group = argv[++i];
    else if (arg === "--shards") options.shards = Number(argv[++i]);
    else if (arg === "--logs") options.logs = resolve(argv[++i]);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!["all", "unit", "e2e"].includes(options.group)) throw new Error("--group must be all, unit or e2e");
  if (!Number.isInteger(options.shards) || options.shards < 1) throw new Error("--shards must be a positive integer");
  return options;
}

function listFiles() {
  const out = execFileSync(process.execPath, [VITEST, "list", "--filesOnly", "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.slice(out.indexOf("["))).map((entry) => entry.file);
}

function weigh(file) {
  const size = statSync(file).size;
  return isE2eTestFile(file) ? 20_000 + size * 4 : 2_000 + size;
}

function runShard(index, files, logsDir, extra) {
  const logPath = join(logsDir, `shard-${index + 1}.log`);
  const log = openSync(logPath, "w");
  const started = Date.now();
  const child = spawn(process.execPath, [VITEST, "run", "--reporter=dot", ...extra, ...files.map((file) => relative(ROOT, file))],
    { cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" }, stdio: ["ignore", log, log] });
  closeSync(log);
  return new Promise((done) => child.on("close", (code, signal) => done({ index, files: files.length, code: code ?? 1, signal, logPath, seconds: (Date.now() - started) / 1000 })));
}

function summarize(result) {
  // vitest 5 colors its summary even with FORCE_COLOR=0; strip any ANSI codes
  const text = stripVTControlCharacters(readFileSync(result.logPath, "utf8"));
  const line = (label) => text.match(new RegExp(`^\\s*${label}\\s+(.+)$`, "m"))?.[1]?.trim() ?? "?";
  const failures = [...new Set([...text.matchAll(/^\s*FAIL\s+(.+)$/gm)].map((match) => match[1].trim()))];
  return { files: line("Test Files"), tests: line("Tests"), failures };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = selectGroup(listFiles(), options.group);
  if (options.list) {
    for (const file of files) console.log(relative(ROOT, file));
    console.error(`${files.length} files in group ${options.group}`);
    return;
  }
  const shards = balanceShards(files, options.shards, weigh);
  const logsDir = options.logs ?? mkdtempSync(join(tmpdir(), "sagax-vitest-shards-"));
  mkdirSync(logsDir, { recursive: true });
  console.log(`vitest: ${files.length} files (${options.group}) in ${shards.length} shards; logs in ${logsDir}`);
  const started = Date.now();
  const results = await Promise.all(shards.map((shard, index) => runShard(index, shard, logsDir, options.extra)));
  let failed = false;
  for (const result of results) {
    const summary = summarize(result);
    const ok = result.code === 0;
    failed ||= !ok;
    console.log(`shard ${result.index + 1}/${shards.length} ${ok ? "ok" : "FAILED"} ${result.seconds.toFixed(0)}s  files: ${summary.files}  tests: ${summary.tests}`);
    for (const failure of summary.failures) console.log(`  FAIL ${failure}`);
    if (!ok && summary.failures.length === 0) console.log(`  exit ${result.signal ?? result.code}, see ${result.logPath}`);
  }
  console.log(`${failed ? "FAILED" : "passed"} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
