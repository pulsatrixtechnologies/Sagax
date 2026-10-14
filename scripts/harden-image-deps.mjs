#!/usr/bin/env node
// After the engine CLIs and agent-browser are on the image, replace the
// transitive packages Trivy reports as CRITICAL/HIGH when a compatible
// release exists. The installer pins the engine tarball; it cannot bump a
// nested piscina or PyJWT without rewriting that vendor's lock. This step
// is the image's own overlay: exact versions plus npm integrity, never
// `latest`.
//
//   node scripts/harden-image-deps.mjs --root /opt/sagax-engines --root /usr/local/lib/node_modules
import { execFileSync } from "node:child_process";
import { existsSync, globSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";

import { integrityMatches, npmTarballUrl } from "./install-engines.mjs";

/** Nested npm packages the production image overlays, with sha512 of the registry tarball. */
export const NPM_RUNTIME_PATCHES = [
  {
    name: "piscina",
    version: "4.9.4",
    integrity: "sha512-RyBDr2VheQ8ZfH3N8SzQZHztqVyOtadTwLnUYof6gdj5161/eu2wNhCbGl5GHnNKDpnkicJYpKtL2J+y/gk6XA==",
  },
  {
    name: "sharp",
    version: "0.35.5",
    integrity: "sha512-Ywn4OnzGukp7CDMrp08RQ50YKmuwG47brZgIVPTvBaaAfQlRlygrRqSrxdCiL9M+LlzLBiJ68IR1QqvzHyjC7g==",
  },
];

/** Hermes venv packages. Specs are exact; pip never sees `latest`. */
export const PIP_RUNTIME_PATCHES = [
  { name: "PyJWT", spec: "PyJWT==2.15.1" },
  { name: "httpx2", spec: "httpx2==2.13.1" },
  { name: "httpcore2", spec: "httpcore2==2.13.1" },
];

/** Numeric dotted versions only (`1.2.3`). Pre-releases compare as less than the same numbers. */
export function cmpVersion(left, right) {
  const parts = (value) => String(value ?? "").split(/[.+-]/).map((piece) => {
    const n = Number(piece);
    return Number.isFinite(n) ? n : 0;
  });
  const a = parts(left);
  const b = parts(right);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

export function needsBump(installed, wanted) {
  return cmpVersion(installed, wanted) < 0;
}

function absoluteFrom(root, found) {
  return isAbsolute(found) ? found : join(root, found);
}

/** Directories that hold `<name>/package.json` under a node_modules tree. */
export function findPackageDirs(root, name) {
  if (!root || !existsSync(root)) return [];
  const pattern = `**/node_modules/${name}/package.json`;
  return globSync(pattern, { cwd: root, absolute: true, nodir: true })
    .map((file) => dirname(absoluteFrom(root, file)))
    .sort();
}

export function readPackageVersion(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "";
  } catch {
    return "";
  }
}

async function fetchTarball(pkg, version, integrity) {
  const url = npmTarballUrl(pkg, version);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!integrityMatches(buffer, integrity)) {
    throw new Error(`integrity mismatch for ${pkg}@${version}`);
  }
  return buffer;
}

function extractTarball(buffer, dest) {
  const scratch = mkdtempSync(join(tmpdir(), "harden-npm-"));
  const archive = join(scratch, "package.tgz");
  writeFileSync(archive, buffer);
  rmSync(dest, { recursive: true, force: true });
  execFileSync("mkdir", ["-p", dest]);
  execFileSync("tar", ["-xzf", archive, "--strip-components=1", "--no-same-owner", "-C", dest]);
  rmSync(scratch, { recursive: true, force: true });
}

export async function patchNpmTree(root, patches = NPM_RUNTIME_PATCHES, { fetchPkg = fetchTarball, extract = extractTarball } = {}) {
  const applied = [];
  for (const patch of patches) {
    for (const dir of findPackageDirs(root, patch.name)) {
      const installed = readPackageVersion(dir);
      if (!needsBump(installed, patch.version)) continue;
      const tarball = await fetchPkg(patch.name, patch.version, patch.integrity);
      extract(tarball, dir);
      applied.push({ name: patch.name, from: installed, to: patch.version, dir });
    }
  }
  return applied;
}

export function findVenvPips(root) {
  if (!root || !existsSync(root)) return [];
  return globSync("**/venv/bin/pip", { cwd: root, absolute: true, nodir: true })
    .map((file) => absoluteFrom(root, file))
    .sort();
}

export function patchPipTrees(root, patches = PIP_RUNTIME_PATCHES, { runPip } = {}) {
  const specs = patches.map((patch) => patch.spec);
  if (specs.length === 0) return [];
  const applied = [];
  const pipRun = runPip ?? ((pip, args) => {
    execFileSync(pip, args, { stdio: "inherit" });
  });
  for (const pip of findVenvPips(root)) {
    pipRun(pip, ["install", "--no-cache-dir", "--disable-pip-version-check", "--upgrade", ...specs]);
    applied.push({ pip, specs });
  }
  return applied;
}

export function parseArgs(argv) {
  const roots = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--root") {
      const value = argv[++i];
      if (!value) throw new Error("--root needs a directory");
      roots.push(value);
    } else {
      throw new Error(`unknown argument: ${argv[i]}`);
    }
  }
  return { roots };
}

async function main() {
  const { roots } = parseArgs(process.argv.slice(2));
  if (roots.length === 0) throw new Error("usage: node scripts/harden-image-deps.mjs --root <dir>...");
  const npmApplied = [];
  const pipApplied = [];
  for (const root of roots) {
    npmApplied.push(...await patchNpmTree(root));
    pipApplied.push(...patchPipTrees(root));
  }
  for (const row of npmApplied) {
    console.log(`[harden] ${row.name}: ${row.from} -> ${row.to} (${row.dir})`);
  }
  for (const row of pipApplied) {
    console.log(`[harden] pip ${row.specs.join(" ")} (${row.pip})`);
  }
  console.log(`[harden] npm ${npmApplied.length} overlay(s), pip ${pipApplied.length} venv(s)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`[harden] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
