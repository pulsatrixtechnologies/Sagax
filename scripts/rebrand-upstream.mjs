#!/usr/bin/env node
// Re-applies the Sagax names to text that came from the upstream project.
// Also the draft codemod for step 2 of the rename (the mass rename): run it
// only after flipping bridgeLegacyEnv (electron/legacy-names.mjs) so the code
// reads SAGAX_*, and review every PROTECT entry against that step's plan.
//
// Sagax started as a modified distribution of an Apache-2.0 project (see
// NOTICE). Its identifiers, paths, environment variables and copy were
// renamed in one pass; an upstream merge brings the old names back in the
// files it touches. Run this after `git merge upstream/main` (AGENTS.md,
// "Upstream sync"), review the diff, then run the usual checks.
//
//   node scripts/rebrand-upstream.mjs           # report what would change
//   node scripts/rebrand-upstream.mjs --write   # rewrite files and git mv paths
//
// It never touches the legal files, vendored third-party code, lockfiles or
// binary files, nor the compatibility code that must keep reading the old
// names for one release (LEGACY_FILES). Some old spellings are protected on
// purpose (PROTECT): live endpoints and wire contracts of services this
// project does not run, store identities of shipped apps, and identifiers
// written into files people already have.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The old name, assembled so that this file does not rename itself.
const OLD = ["open", "maus", "bot"].join("");
const OLD_SHORT = ["open", "maus"].join("");
const OLD_TLA = ["o", "m", "b"].join("");

/** Files never rewritten: legal text, vendored code, generated lockfiles,
 * this script, and the compatibility shims that name the old spellings. */
const SKIP_EXACT = new Set([
  "LICENSE",
  "NOTICE",
  "LICENSING.md",
  "AGENTS.md",
  "pnpm-lock.yaml",
  "scripts/rebrand-upstream.mjs",
  // the compatibility layer (step 1): it names the old spellings on purpose
  "electron/legacy-names.mjs",
  "electron/legacy-names.d.mts",
  "electron/legacy-names.node-test.mjs",
  "electron/legacy-env-boot.mjs",
  "electron/keychain-migration.mjs",
  "electron/keychain-migration.node-test.mjs",
  "electron/user-data-location.mjs",
  "electron/user-data-location.test.mjs",
  "electron/data-dir-lease.mjs",
  "electron/data-dir-lease.node-test.mjs",
  "src/lib/environment-descriptor.ts",
  "src/lib/environment-descriptor.test.ts",
  "server/sagax-data-dir-migration.test.ts",
  "server/legacy-migration.test.ts",
  // deployed paths (OMB_DATA_DIR=/data/.openmausbot, /etc/openmausbot, ...):
  // existing volumes and hosts keep them; rename with a migration of their own
  "Dockerfile",
  "server/fleet.ts",
  "server/fleet.test.ts",
  "server/cloud-home-start.ts",
  "server/cloud-home-start.test.ts",
  // compose files read an operator's own .env (OMB_* interpolation)
  "compose.yaml",
  "compose.mail-test.yaml",
  ".env.example",
]);
/** Vendored code, deployed configuration and the native apps (renamed with a
 * store release of their own). */
const SKIP_PREFIX = ["third_party/", ".git/", "node_modules/", "deploy/", "ios/", "android/"];

const re = (source, flags = "g") => new RegExp(source, flags);

/** Kept verbatim everywhere. */
const PROTECT = [
  // live endpoints of the upstream's hosted services (not run by this project)
  re(`(?:[A-Za-z0-9-]+\\.)*${OLD_SHORT}(?:bot)?\\.com\\b`),
  // the upstream repositories (named only where the merge note needs them)
  re(`milind-soni/[A-Za-z0-9_.-]+`),
  // wire contracts of the upstream's hosted services
  re(`\\b[Xx]-[Oo]mb-(?:[Cc]loud|[Hh]osted)-[A-Za-z-]+`),
  // file magic and key-derivation labels of data people already have
  re(`OMB-WORKSPACE-1`),
  re(`${OLD}-phone-credential-v1`),
  re(`${OLD_TLA}-install:v1`),
  re(`aos[._]${OLD}_status(?:\\.v1|\\.py)?`),
  // credential and token prefixes: issued and accepted by hand (legacy-names)
  re(`(?<![A-Za-z0-9])(?:[a-z]+_)?${OLD_TLA}_[A-Za-z0-9_-]*`),
  // store identities of the shipped apps (bundle id, app group, Android id)
  re(`com\\.${OLD}\\.app(?!\\.desktop)(?:\\.[A-Za-z0-9-]+)*`),
  re(`group\\.com\\.${OLD}\\.shared`),
  re(`bundleIdPrefix: com\\.${OLD}`),
  re(`applicationId\\s*=\\s*"[^"]*"`),
  // file format ids, stored preference names and notification ids
  re(`${OLD_SHORT}\\.[a-z][A-Za-z0-9_.-]*`),
  // compatibility kept for one release (step 1 of the rename): both schemes,
  // the old protocol and links, the lease files old and new copies share,
  // the runtime name that names the keychain secret, the health word
  re(`sagax\\|${OLD}`),
  re(`\\[sagax, ${OLD}\\]`),
  re(`"${OLD}:"`),
  re(`LEGACY_[A-Z_]+ = "${OLD}://[a-z]+"`),
  re(`${OLD}-server\\.lease`),
  re(`\\.${OLD}-server-child`),
  re(`"name": "${OLD}"`),
  re(`\\bapp\\b[^\\n]{0,8}"${OLD}"`),
  // an engine's own environment variable
  re(`HERMES_${OLD_SHORT.toUpperCase()}_[A-Z_]+`),
  // the data folder lease capability and the migration breadcrumb (legacy-names)
  re(`${OLD.toUpperCase()}_INTERNAL_DATA_DIR_LEASE`),
  re(`MOVED_FROM_${OLD.toUpperCase()}`),
  // the native projects, not renamed with the rest (ios/, android/)
  re(`OpenMausCompanion[A-Za-z]*`),
];

/** Kept verbatim in the native apps only (keychain services, log subsystems). */
const PROTECT_NATIVE = [re(`com\\.${OLD}\\.[A-Za-z0-9.-]+`)];

/** [pattern, replacement], in order. Only the product name and the
 * environment variables: lowercase identifiers (storage keys, headers, IPC
 * channels, labels, the `openmausbot` command, host paths) are wire or
 * stored names and stay (AGENTS.md, "Legacy names kept for compatibility"). */
const RULES = [
  [re(`OpenMausBot Pro`), "Sagax Pro"],
  [re(`\\b([Aa])n (?=OpenMaus)`), "$1 "],
  [re(`${OLD.toUpperCase()}_`), "SAGAX_"],
  [re(`${OLD_SHORT.toUpperCase()}_`), "SAGAX_"],
  [re(`${OLD.toUpperCase()}`), "SAGAX"],
  [re(`(?<![A-Za-z0-9_])OMB_`), "SAGAX_"],
  [re(`(?<=\\\\[nt])OMB_`), "SAGAX_"],
  [re(`OpenMausBot`), "Sagax"],
  [re(`Openmausbot`), "Sagax"],
  [re(`OpenMaus`), "Sagax"],
  [re(`openMaus(?=[A-Z])`), "sagax"],
  [re(`~/\\.${OLD}(?![A-Za-z0-9-])`), "~/.sagax"],
];

function protectedSpans(text, patterns) {
  const spans = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) spans.push([m.index, m.index + m[0].length]);
  }
  spans.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

/** Rewrite one text, leaving protected spans as they are. */
export function rebrand(text, { native = false } = {}) {
  const spans = protectedSpans(text, native ? [...PROTECT, ...PROTECT_NATIVE] : PROTECT);
  let out = "";
  let at = 0;
  const apply = (chunk) => RULES.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), chunk);
  for (const [start, end] of spans) {
    out += apply(text.slice(at, start)) + text.slice(start, end);
    at = end;
  }
  return out + apply(text.slice(at));
}

const isNative = (file) => file.startsWith("ios/") || file.startsWith("android/");

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean);
}

function skipped(file) {
  return SKIP_EXACT.has(file) || SKIP_PREFIX.some((prefix) => file.startsWith(prefix));
}

function main(argv) {
  const write = argv.includes("--write");
  // --only a/,b/ limits the pass to those path prefixes (one category at a time)
  const onlyAt = argv.indexOf("--only");
  const only = onlyAt >= 0 ? argv[onlyAt + 1].split(",") : null;
  let changedFiles = 0;
  const moves = [];
  for (const file of trackedFiles()) {
    if (skipped(file) || (only && !only.some((prefix) => file.startsWith(prefix)))) continue;
    const path = join(ROOT, file);
    let buffer;
    try { buffer = readFileSync(path); } catch { continue; }
    if (!buffer.includes(0)) {
      const text = buffer.toString("utf8");
      const next = rebrand(text, { native: isNative(file) });
      if (next !== text) {
        changedFiles += 1;
        if (write) writeFileSync(path, next);
        else console.log(`edit ${file}`);
      }
    }
    const target = rebrand(file, { native: false });
    if (target !== file) moves.push([file, target]);
  }
  for (const [from, to] of moves) {
    if (write) {
      mkdirSync(join(ROOT, dirname(to)), { recursive: true });
      execFileSync("git", ["mv", "-k", from, to], { cwd: ROOT });
    } else console.log(`move ${from} -> ${to}`);
  }
  console.error(`${write ? "rewrote" : "would rewrite"} ${changedFiles} files, ${write ? "moved" : "would move"} ${moves.length} paths`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
