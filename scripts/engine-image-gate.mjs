#!/usr/bin/env node
// The production engine gate. A server image is fit to run only when its
// manifest says engineSet "all" and every engine of engines.lock.json is
// installed. On 2026-10-12 GOX deployed pulsa-bot-server:main-20004735 with
// engineSet "none" and installed [] because the image default and the build
// that omitted ENGINE_SET both meant "install nothing".
//
//   node scripts/engine-image-gate.mjs --manifest manifest.json --labels labels.json --sha <commit>
//   node scripts/engine-image-gate.mjs --startup-log server.log
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const UTC_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** True when the build asked the installer to refuse a short engine set. */
export function enginesRequired(value) {
  const flag = String(value ?? "").trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

/** Engine ids a production image must contain, in lock order. */
export function productionEngineIds(lock) {
  const engines = Array.isArray(lock?.engines) ? lock.engines : [];
  return engines.map((engine) => engine?.id).filter((id) => typeof id === "string" && id);
}

/**
 * Whether a baked manifest is the full production set.
 * `installed` entries count only when they name an id and a bin.
 */
export function assessProductionManifest(manifest, lock) {
  const errors = [];
  const set = String(manifest?.engineSet ?? "").trim();
  if (!set || set === "none") errors.push("engineSet is none");
  else if (set !== "all") errors.push("engineSet must be all");
  const installed = new Set(
    (Array.isArray(manifest?.installed) ? manifest.installed : [])
      .filter((engine) => engine && typeof engine.id === "string" && engine.id && typeof engine.bin === "string" && engine.bin)
      .map((engine) => engine.id),
  );
  const missing = productionEngineIds(lock).filter((id) => !installed.has(id));
  if (missing.length) errors.push(`missing engines: ${missing.join(",")}`);
  return { ok: errors.length === 0, errors, missing, engineSet: set || "none" };
}

/** OCI labels the image build must stamp: commit, engine set, build time. */
export function assessImageLabels(labels, { sha = "", engineSet = "all" } = {}) {
  const errors = [];
  const table = labels && typeof labels === "object" ? labels : {};
  const revision = String(table["org.opencontainers.image.revision"] ?? "");
  const created = String(table["org.opencontainers.image.created"] ?? "");
  const set = String(table["io.sagax.engine-set"] ?? "");
  if (sha) {
    if (revision !== sha) errors.push(`revision label is ${revision || "(empty)"}`);
  } else if (!/^[0-9a-f]{40}$/.test(revision)) errors.push("revision label is missing");
  if (!UTC_STAMP.test(created)) errors.push("created label is not a UTC timestamp");
  if (set !== engineSet) errors.push(`engine-set label is ${set || "(empty)"}`);
  return { ok: errors.length === 0, errors };
}

/** Boot log of a production container: image set all, every engine started, no engine_missing. */
export function assessStartupLog(log, requiredIds) {
  const lines = String(log ?? "").split(/\r?\n/);
  const errors = [];
  const alerts = lines.filter((line) => line.includes("engine_missing"));
  for (const alert of alerts) errors.push(alert);
  const summary = lines.find((line) => line.includes("[engines] self-check:") && line.includes("image set all"));
  if (!summary) errors.push("self-check did not report image set all");
  for (const id of requiredIds) {
    const line = lines.find((item) => item.includes(`[engines] ${id}:`));
    if (!line) errors.push(`missing startup line for ${id}`);
    else if (line.includes("FAILED")) errors.push(`${id} failed to start`);
  }
  return { ok: errors.length === 0, errors, alerts };
}

/** `GET /healthz` body: ok, and this app's name. */
export function assessHealthz(body) {
  const errors = [];
  let parsed = body;
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || parsed.ok !== true) errors.push("healthz not ok");
  if (!parsed || parsed.app !== "openmausbot") errors.push("healthz missing openmausbot");
  return { ok: errors.length === 0, errors };
}

function parseArgs(argv) {
  const options = { manifest: "", labels: "", sha: "", startupLog: "", lock: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--manifest") options.manifest = argv[++index] ?? "";
    else if (arg === "--labels") options.labels = argv[++index] ?? "";
    else if (arg === "--sha") options.sha = argv[++index] ?? "";
    else if (arg === "--startup-log") options.startupLog = argv[++index] ?? "";
    else if (arg === "--lock") options.lock = argv[++index] ?? "";
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.manifest && !options.labels && !options.startupLog) {
    throw new Error("--manifest, --labels or --startup-log is required");
  }
  return options;
}

function report(prefix, verdict) {
  if (verdict.ok) return 0;
  for (const error of verdict.errors) console.error(`${prefix}${error}`);
  return 1;
}

function main(argv) {
  const options = parseArgs(argv);
  const lockPath = options.lock || join(dirname(fileURLToPath(import.meta.url)), "..", "engines.lock.json");
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  let code = 0;
  if (options.manifest) {
    const manifest = JSON.parse(readFileSync(options.manifest, "utf8"));
    code |= report("[engines] engine_missing ", assessProductionManifest(manifest, lock));
  }
  if (options.labels) {
    const labels = JSON.parse(readFileSync(options.labels, "utf8"));
    const verdict = assessImageLabels(labels, { sha: options.sha });
    if (!verdict.ok) {
      for (const error of verdict.errors) console.error(`[engines] ${error}`);
      code = 1;
    }
  }
  if (options.startupLog) {
    const log = readFileSync(options.startupLog, "utf8");
    code |= report("[engines] ", assessStartupLog(log, productionEngineIds(lock)));
  }
  return code;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`[engines] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
