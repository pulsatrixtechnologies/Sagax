#!/usr/bin/env node
// Install the engine CLIs pinned in engines.lock.json into the Sagax server
// image (the Dockerfile's engines step), verify each one starts, and write
// the manifest the server's startup self-check reads
// (server/engines-self-check.ts, SAGAX_ENGINES_MANIFEST).
//
//   node scripts/install-engines.mjs --lock engines.lock.json --manifest /app/engines/manifest.json
//   node scripts/install-engines.mjs --lock engines.lock.json --plan      (prints the selection, installs nothing)
//
// Selection, from the build arguments (the environment of the RUN step):
//   ENGINE_SET      none (default: the public image carries no engine),
//                   all (every engine of the lock: an organization server),
//                   open (only the redistributable ones), or engine ids
//                   ("claude codex grok").
//   ENGINES         legacy override: npm specs installed instead of the
//                   lock's npm engines ("none" drops them). Perspicax's
//                   PULSABOT_ENGINES lands here.
//   NATIVE_ENGINES  legacy override: native engine ids from the lock
//                   instead of the selected ones ("none" drops them).
//                   Perspicax's PULSABOT_NATIVE_ENGINES lands here.
//   TARGETARCH      amd64 or arm64 (Docker sets it).
//
// Runs as root during the build: npm installs globally, native engines land
// in /opt/sagax-engines/<id>/<version> with a link in /usr/local/bin, a
// Python engine gets its own virtual environment there. Every download is
// checked against the lock's SHA-256 before it is unpacked.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const ENGINES_ROOT = "/opt/sagax-engines";
const BIN_DIR = "/usr/local/bin";
const VERSION_TIMEOUT_MS = 90_000;

/** Split a build argument into words; "" and "none" are meaningful apart. */
function words(value) {
  return String(value ?? "").split(/[\s,]+/).map((word) => word.trim()).filter(Boolean);
}

/** `@scope/name@1.2.3` or `name@1.2.3` or a bare name, as {name, version}. */
export function parseNpmSpec(spec) {
  const at = spec.lastIndexOf("@");
  if (at > 0) return { name: spec.slice(0, at), version: spec.slice(at + 1) };
  return { name: spec, version: "" };
}

/** Which engines this build installs, and which it says are not here.
 * Pure: the unit test and --plan use it without touching the machine. */
export function selectEngines(lock, { engineSet = "", engines = "", nativeEngines = "", arch = "" } = {}) {
  const all = Array.isArray(lock?.engines) ? lock.engines : [];
  const byId = new Map(all.map((engine) => [engine.id, engine]));
  const set = String(engineSet).trim();
  let chosen;
  if (set === "" || set === "none") chosen = [];
  else if (set === "all") chosen = [...all];
  else if (set === "open") chosen = all.filter((engine) => engine.redistributable === true);
  else {
    chosen = words(set).map((id) => {
      const engine = byId.get(id);
      if (!engine) throw new Error(`ENGINE_SET names an engine the lock does not have: ${id}`);
      return engine;
    });
  }
  const unavailable = [];
  // ENGINES: the legacy npm list replaces the lock's npm engines.
  const legacyNpm = [];
  const npmOverride = String(engines).trim();
  if (npmOverride) {
    chosen = chosen.filter((engine) => engine.kind !== "npm");
    if (npmOverride !== "none") {
      for (const spec of words(npmOverride)) {
        const { name, version } = parseNpmSpec(spec);
        const known = all.find((engine) => engine.kind === "npm" && engine.package === name);
        legacyNpm.push(known
          ? { ...known, version: version || "latest", spec }
          : { id: name, name, drivers: [], kind: "npm", package: name, version: version || "latest", bin: "", spec });
      }
    }
  }
  // NATIVE_ENGINES: the legacy native list replaces the selected native ones.
  const nativeOverride = String(nativeEngines).trim();
  if (nativeOverride) {
    chosen = chosen.filter((engine) => engine.kind !== "native");
    if (nativeOverride !== "none") {
      for (const id of words(nativeOverride)) {
        const engine = byId.get(id);
        if (!engine || engine.kind !== "native") throw new Error(`unknown native engine: ${id}`);
        chosen.push(engine);
      }
    }
  }
  const install = [];
  const seen = new Set();
  for (const engine of [...chosen, ...legacyNpm]) {
    if (seen.has(engine.id)) continue;
    seen.add(engine.id);
    if (engine.kind === "native" && !engine.artifacts?.[arch]) {
      unavailable.push({ id: engine.id, name: engine.name, drivers: engine.drivers ?? [], reason: `No ${engine.name} build for ${arch || "this architecture"}.` });
      continue;
    }
    install.push(engine.spec ? engine : { ...engine, spec: engine.kind === "npm" ? `${engine.package}@${engine.version}` : undefined });
  }
  // What an image meant to carry engines says about the rest: the lock's
  // own list, and on an open image the engines its licence keeps out.
  if (set === "all" || set === "open") {
    for (const entry of lock.notPreinstalled ?? []) unavailable.push({ id: entry.id, name: entry.name, drivers: entry.drivers ?? [], reason: entry.reason });
    if (set === "open") {
      for (const engine of all) {
        if (engine.redistributable !== true && !seen.has(engine.id)) {
          unavailable.push({ id: engine.id, name: engine.name, drivers: engine.drivers ?? [], reason: `${engine.name} is under ${engine.license}, so this open image does not carry it.` });
        }
      }
    }
  }
  return { install, unavailable };
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function download(url, expected) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const actual = sha256(buffer);
  if (actual !== expected) throw new Error(`SHA-256 mismatch for ${url}: expected ${expected}, got ${actual}`);
  return buffer;
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function link(target, bin) {
  const path = join(BIN_DIR, bin);
  rmSync(path, { force: true });
  symlinkSync(target, path);
  return path;
}

function installNpm(engines) {
  if (!engines.length) return;
  const specs = engines.map((engine) => engine.spec);
  // npm 11 runs a dependency's install script only when the package is
  // named (Claude Code and Droid fetch their native binary that way), and
  // the platform binaries ride optional dependencies.
  const allow = engines.map((engine) => `--allow-scripts=${engine.package}`);
  run("npm", ["install", "-g", "--loglevel=error", "--include=optional", "--no-fund", "--no-audit", ...allow, ...specs], {
    env: { ...process.env, npm_config_update_notifier: "false" },
  });
}

async function installNative(engine, arch) {
  const artifact = engine.artifacts[arch];
  const buffer = await download(artifact.url, artifact.sha256);
  const dir = join(ENGINES_ROOT, engine.id, engine.version);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let target;
  if (artifact.format === "gz") {
    target = join(dir, engine.bin);
    writeFileSync(target, gunzipSync(buffer), { mode: 0o755 });
  } else if (artifact.format === "tar.gz") {
    const scratch = mkdtempSync(join(tmpdir(), `engine-${engine.id}-`));
    const archive = join(scratch, "package.tar.gz");
    writeFileSync(archive, buffer);
    run("tar", ["-xzf", archive, "--strip-components=1", "--no-same-owner", "-C", dir]);
    rmSync(scratch, { recursive: true, force: true });
    target = join(dir, artifact.entry ?? engine.bin);
  } else {
    throw new Error(`${engine.id}: unknown artifact format ${artifact.format}`);
  }
  run("chmod", ["-R", "a+rX,go-w", dir]);
  return link(target, engine.bin);
}

function ensurePython() {
  const probe = spawnSync("python3", ["-c", "import venv, ensurepip"], { stdio: "ignore" });
  if (probe.status === 0) return;
  run("apt-get", ["update"]);
  run("apt-get", ["install", "-y", "--no-install-recommends", "python3", "python3-venv"]);
  rmSync("/var/lib/apt/lists", { recursive: true, force: true });
  mkdirSync("/var/lib/apt/lists/partial", { recursive: true });
}

async function installPython(engine) {
  ensurePython();
  const buffer = await download(engine.source.url, engine.source.sha256);
  const root = join(ENGINES_ROOT, engine.id, engine.version);
  rmSync(root, { recursive: true, force: true });
  const src = join(root, "src");
  const venv = join(root, "venv");
  mkdirSync(src, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), `engine-${engine.id}-`));
  const archive = join(scratch, "source.tar.gz");
  writeFileSync(archive, buffer);
  run("tar", ["-xzf", archive, "--strip-components=1", "--no-same-owner", "-C", src]);
  rmSync(scratch, { recursive: true, force: true });
  run("python3", ["-m", "venv", venv]);
  // Hermes refuses to build a wheel ("distributed via the shell installer,
  // Docker image, or Nix") and documents the editable install of its
  // checkout instead, which is what its own installer does with uv.
  const extras = engine.extras?.length ? `[${engine.extras.join(",")}]` : "";
  run(join(venv, "bin", "pip"), ["install", "--no-cache-dir", "--disable-pip-version-check", "--quiet", "--editable", `${src}${extras}`]);
  run("chmod", ["-R", "a+rX,go-w", root]);
  return link(join(venv, "bin", engine.bin), engine.bin);
}

/** `<bin> --version`, first non-empty line; throws when it does not start. */
export function versionOf(bin, env = process.env) {
  const home = mkdtempSync(join(tmpdir(), "engine-version-"));
  try {
    const result = spawnSync(bin, ["--version"], {
      env: { ...env, HOME: home, NO_COLOR: "1", CI: "1" },
      encoding: "utf8",
      timeout: VERSION_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${bin} --version exited ${result.status}: ${(result.stderr || result.stdout || "").trim().slice(0, 400)}`);
    return `${result.stdout}\n${result.stderr}`.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const options = { lock: "", manifest: "", plan: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--lock") options.lock = argv[++index] ?? "";
    else if (arg === "--manifest") options.manifest = argv[++index] ?? "";
    else if (arg === "--plan") options.plan = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.lock) throw new Error("--lock <engines.lock.json> is required");
  if (!options.plan && !options.manifest) throw new Error("--manifest <path> is required");
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const lock = JSON.parse(readFileSync(options.lock, "utf8"));
  const engineSet = process.env.ENGINE_SET ?? "";
  const arch = process.env.TARGETARCH || (process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "amd64" : process.arch);
  const { install, unavailable } = selectEngines(lock, {
    engineSet,
    engines: process.env.ENGINES ?? "",
    nativeEngines: process.env.NATIVE_ENGINES ?? "",
    arch,
  });
  if (options.plan) {
    console.log(JSON.stringify({ engineSet: engineSet || "none", arch, install: install.map(({ id, kind, version }) => ({ id, kind, version })), unavailable }, null, 2));
    return;
  }
  installNpm(install.filter((engine) => engine.kind === "npm"));
  for (const engine of install) {
    if (engine.kind === "native") await installNative(engine, arch);
    else if (engine.kind === "python") await installPython(engine);
  }
  const installed = [];
  for (const engine of install) {
    if (!engine.bin) {
      console.log(`[engines] ${engine.spec}: installed (legacy npm spec, no engine of the lock)`);
      continue;
    }
    const reported = versionOf(engine.bin);
    console.log(`[engines] ${engine.id} ${engine.version}: ${reported}`);
    installed.push({ id: engine.id, name: engine.name, drivers: engine.drivers ?? [], kind: engine.kind, version: engine.version, bin: engine.bin, reported });
  }
  mkdirSync(dirname(options.manifest), { recursive: true });
  writeFileSync(options.manifest, `${JSON.stringify({ lockVersion: lock.lockVersion, engineSet: engineSet || "none", arch, installed, notPreinstalled: unavailable }, null, 2)}\n`);
  console.log(`[engines] ${installed.length} engine(s) installed; manifest ${options.manifest}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`[engines] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
