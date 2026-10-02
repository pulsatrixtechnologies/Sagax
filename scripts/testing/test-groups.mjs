// Splits the vitest suite into two groups without a hand-kept list:
//
//   e2e   files named *.e2e.test.ts, and any test that boots the real harness
//         server (server/index.ts) or launchVerificationServer. They spawn
//         fake provider CLIs and wait on real turns: most of the suite's time.
//   unit  everything else (pure modules, rendered components, route handlers
//         driven in process). Minutes, not tens of minutes.
//
// `pnpm test` still runs every file in one serial vitest run; the groups only
// serve the faster entry points (scripts/testing/vitest-shards.mjs).
import { readFileSync } from "node:fs";

const SERVER_BOOT = [
  /launchVerificationServer\(/,
  // spawn(process.execPath, [..., join(SERVER_DIR, "index.ts")]) and friends;
  // reading index.ts as text (a source guard) does not count
  /spawn\(process\.execPath,[^\n]*\bindex\.ts\b/,
];

/** True for a file that belongs to the e2e group. `source` defaults to the file's text. */
export function isE2eTestFile(file, source) {
  if (/\.e2e\.test\.[cm]?[jt]s$/.test(file)) return true;
  const text = source ?? readFileSync(file, "utf8");
  return SERVER_BOOT.some((pattern) => pattern.test(text));
}

/** Files of one group: "all", "unit" or "e2e". */
export function selectGroup(files, group, read = (file) => readFileSync(file, "utf8")) {
  if (group === "all") return [...files];
  if (group !== "unit" && group !== "e2e") throw new Error(`unknown test group: ${group}`);
  return files.filter((file) => isE2eTestFile(file, read(file)) === (group === "e2e"));
}

/**
 * Deals files into `count` shards, heaviest first onto the lightest shard, so
 * one shard does not collect every server-booting file. The weight is a
 * cheap proxy: e2e files cost far more than unit files of the same size.
 */
export function balanceShards(files, count, weigh) {
  const shards = Array.from({ length: Math.max(1, count) }, () => ({ files: [], weight: 0 }));
  const weighted = files.map((file) => ({ file, weight: weigh(file) }))
    .sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file));
  for (const { file, weight } of weighted) {
    const lightest = shards.reduce((best, shard) => (shard.weight < best.weight ? shard : best));
    lightest.files.push(file);
    lightest.weight += weight;
  }
  return shards.filter((shard) => shard.files.length > 0).map((shard) => shard.files.sort());
}
