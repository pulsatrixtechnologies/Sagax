#!/usr/bin/env node
// GOX deploy gate for the Sagax server image (pulsa-bot-server).
//
// Refuses an image whose manifest is not engineSet "all" with every engine
// of engines.lock.json. After a switch, smoke-tests GET /healthz and the
// engine startup log. On failure, rolls back to the image recorded in
// /opt/pulsatrix/pulsabot-image.prev and recreates the edge:
//
//   docker compose up -d --force-recreate --no-deps pulsabot-caddy
//
// Image cleanup never removes the running image or that previous image,
// and removes nothing when the keep set is empty. Any log line containing
// engine_missing is an alert on stderr (`ALERT ...`) and a non-zero exit.
//
//   node scripts/gox-deploy.mjs check --image <ref>
//   node scripts/gox-deploy.mjs deploy --image <ref>
//   node scripts/gox-deploy.mjs prune
//   node scripts/gox-deploy.mjs alert --log server.log
//
// This script does not SSH anywhere. GOX runs it on the host that already
// holds the image. Env: PULSABOT_PREV_FILE, PULSABOT_IMAGE_FILE,
// PULSABOT_COMPOSE_DIR, PULSABOT_SERVICE, PULSABOT_CONTAINER.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assessHealthz, assessProductionManifest, assessStartupLog, productionEngineIds } from "./engine-image-gate.mjs";

export const PREV_FILE = "/opt/pulsatrix/pulsabot-image.prev";
export const IMAGE_FILE = "/opt/pulsatrix/pulsabot-image";
export const CADDY_SERVICE = "pulsabot-caddy";
export const SERVER_SERVICE = "pulsabot";
/** The edge recreate, exactly as GOX must run it after a rollback. */
export const CADDY_RECREATE_ARGV = ["docker", "compose", "up", "-d", "--force-recreate", "--no-deps", CADDY_SERVICE];
export const CADDY_RECREATE_COMMAND = "docker compose up -d --force-recreate --no-deps pulsabot-caddy";

const IMAGE_REPO = "pulsa-bot-server";

/** Lines a person or a pager should see. A line counts when it contains engine_missing. */
export function alertsFromLog(log) {
  return String(log ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("engine_missing"));
}

export function formatAlert(line) {
  return `ALERT ${String(line).trim()}`;
}

export function serviceUpArgv(service) {
  return ["docker", "compose", "up", "-d", "--force-recreate", "--no-deps", service];
}

function expandKeep(keep) {
  const values = new Set();
  for (const item of keep ?? []) {
    if (!item) continue;
    if (typeof item === "string") {
      if (item.trim()) values.add(item.trim());
      continue;
    }
    for (const key of ["ref", "id", "tag"]) {
      const value = item[key];
      if (typeof value === "string" && value.trim()) values.add(value.trim());
    }
  }
  return values;
}

/**
 * pulsa-bot-server images that are safe to delete. An empty keep set deletes
 * nothing. The running image and the previous image stay, matched by tag or id.
 */
export function imagesToPrune(images, keep) {
  const keepSet = expandKeep(keep);
  if (keepSet.size === 0) return [];
  return (images ?? []).filter((image) => {
    const repo = String(image?.repo ?? image?.repository ?? "");
    const ref = String(image?.ref ?? (image?.tag ? `${repo}:${image.tag}` : repo));
    if (!repo.includes(IMAGE_REPO) && !ref.includes(IMAGE_REPO)) return false;
    if (keepSet.has(ref) || keepSet.has(image?.id) || keepSet.has(image?.tag)) return false;
    return true;
  });
}

/** Second check before `docker image rm`: never the keep set, never when it is empty. */
export function assertNotKept(image, keep) {
  const keepSet = expandKeep(keep);
  if (keepSet.size === 0) throw new Error("refuse to prune when the keep set is empty");
  const names = [image?.ref, image?.id, image?.tag].filter((name) => typeof name === "string" && name);
  if (names.some((name) => keepSet.has(name))) {
    throw new Error(`refuse to remove kept image ${image?.ref || image?.id || ""}`.trim());
  }
}

function imageRef(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  return String(value.ref ?? value.tag ?? "").trim();
}

/**
 * Switch to `image` only when its manifest passes the production gate.
 * Smoke failure rolls back to the previous image and recreates caddy.
 * The candidate is never written as the previous image before smoke succeeds.
 */
export async function deployImage({ image, lock }, io) {
  const manifest = await io.readManifest(image);
  const gate = assessProductionManifest(manifest, lock);
  if (!gate.ok) {
    const line = `engine_missing ${gate.errors.join("; ")}`;
    await io.alert?.([line]);
    return { ok: false, code: 1, refused: true, errors: gate.errors, alerts: [line] };
  }
  const runningRef = imageRef(await io.runningImage());
  if (runningRef) await io.writePrevious(runningRef);
  const previous = runningRef || imageRef(await io.readPrevious());
  await io.deploy(image);
  const smoke = await io.smoke();
  const log = smoke?.log ?? "";
  const alerts = alertsFromLog(log);
  const health = assessHealthz(smoke?.healthz ?? "");
  const startup = assessStartupLog(log, productionEngineIds(lock));
  if (smoke?.ok === false || !health.ok || !startup.ok) {
    if (!previous) {
      if (alerts.length) await io.alert?.(alerts);
      return { ok: false, code: 1, rolledBack: false, alerts, errors: [...health.errors, ...startup.errors] };
    }
    await io.deploy(previous);
    await io.recreateCaddy();
    if (alerts.length) await io.alert?.(alerts);
    return { ok: false, code: 1, rolledBack: true, previous, alerts, errors: [...health.errors, ...startup.errors] };
  }
  const keep = [image, smoke?.imageId, imageRef(await io.readPrevious())].filter(Boolean);
  const listed = (await io.listImages?.()) ?? [];
  const prune = imagesToPrune(listed, keep);
  for (const victim of prune) assertNotKept(victim, keep);
  if (prune.length) await io.prune?.(prune);
  return { ok: true, code: 0, pruned: prune.map((item) => item.ref || item.id) };
}

function run(args, options = {}) {
  const result = spawnSync(args[0], args.slice(1), { encoding: "utf8", ...options });
  if (result.error) throw result.error;
  return result;
}

function must(args, options) {
  const result = run(args, options);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${args.join(" ")} failed`).trim().slice(0, 500));
  }
  return result;
}

function envConfig() {
  return {
    prevFile: process.env.PULSABOT_PREV_FILE || PREV_FILE,
    imageFile: process.env.PULSABOT_IMAGE_FILE || IMAGE_FILE,
    composeDir: process.env.PULSABOT_COMPOSE_DIR || "/opt/pulsatrix",
    service: process.env.PULSABOT_SERVICE || SERVER_SERVICE,
    container: process.env.PULSABOT_CONTAINER || SERVER_SERVICE,
  };
}

function readText(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

function dockerImageId(ref) {
  if (!ref) return "";
  const result = run(["docker", "image", "inspect", "-f", "{{.Id}}", ref]);
  return result.status === 0 ? result.stdout.trim() : "";
}

function listLocalImages() {
  const result = must(["docker", "image", "ls", "--no-trunc", "--format", "{{.Repository}}\t{{.Tag}}\t{{.ID}}"]);
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [repo, tag, id] = line.split("\t");
    const named = tag && tag !== "<none>";
    return { repo, tag: named ? tag : "", id, ref: named ? `${repo}:${tag}` : repo };
  });
}

function runningImage(container) {
  const result = run(["docker", "inspect", "-f", "{{.Config.Image}}\t{{.Image}}", container]);
  if (result.status !== 0) return "";
  const [ref] = result.stdout.trim().split("\t");
  return ref || "";
}

function smokeContainer(container) {
  const deadline = Date.now() + 90_000;
  let healthz = "";
  let healthOk = false;
  while (Date.now() < deadline) {
    const result = run(["docker", "exec", container, "curl", "-sf", "http://127.0.0.1:8799/healthz"]);
    if (result.status === 0) {
      healthz = result.stdout;
      healthOk = assessHealthz(healthz).ok;
      if (healthOk) break;
    }
    run(["sleep", "2"]);
  }
  const logDeadline = Date.now() + 120_000;
  let log = "";
  while (Date.now() < logDeadline) {
    const result = run(["docker", "logs", container]);
    log = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    if (log.includes("[engines] self-check:")) break;
    run(["sleep", "2"]);
  }
  const inspected = run(["docker", "inspect", "-f", "{{.Image}}", container]);
  return { ok: healthOk, healthz, log, imageId: inspected.status === 0 ? inspected.stdout.trim() : "" };
}

function composeUp(service, image, config) {
  writeFileSync(config.imageFile, `${image}\n`);
  const result = run(serviceUpArgv(service), {
    cwd: config.composeDir,
    env: { ...process.env, PULSABOT_IMAGE: image },
  });
  if (result.status !== 0) throw new Error((result.stderr || `${service} recreate failed`).trim().slice(0, 500));
}

function lockFile() {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "engines.lock.json");
}

function alertLines(lines) {
  for (const line of lines) console.error(formatAlert(line));
}

function dockerIo(config) {
  return {
    readManifest(image) {
      const result = must(["docker", "run", "--rm", "--entrypoint", "cat", image, "/app/engines/manifest.json"]);
      return JSON.parse(result.stdout);
    },
    runningImage() {
      return runningImage(config.container);
    },
    readPrevious() {
      return readText(config.prevFile);
    },
    writePrevious(ref) {
      writeFileSync(config.prevFile, `${ref}\n`);
    },
    deploy(image) {
      composeUp(config.service, image, config);
    },
    smoke() {
      return smokeContainer(config.container);
    },
    recreateCaddy() {
      const result = run(CADDY_RECREATE_ARGV, { cwd: config.composeDir });
      if (result.status !== 0) throw new Error((result.stderr || "caddy recreate failed").trim().slice(0, 500));
    },
    listImages() {
      return listLocalImages();
    },
    prune(images) {
      for (const image of images) {
        const ref = image.ref || image.id;
        must(["docker", "image", "rm", ref]);
      }
    },
    alert: alertLines,
  };
}

function keepForPrune(config) {
  const running = runningImage(config.container);
  const previous = readText(config.prevFile);
  return [running, dockerImageId(running), previous, dockerImageId(previous)].filter(Boolean);
}

function parseArgs(argv) {
  const options = { command: argv[0] ?? "", image: "", log: "" };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--image") options.image = argv[++index] ?? "";
    else if (arg === "--log") options.log = argv[++index] ?? "";
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.command) throw new Error("command required: check, deploy, prune, alert");
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const config = envConfig();
  if (options.command === "alert") {
    const log = options.log ? readFileSync(options.log, "utf8") : readFileSync(0, "utf8");
    const alerts = alertsFromLog(log);
    alertLines(alerts);
    return alerts.length ? 1 : 0;
  }
  if (options.command === "prune") {
    const keep = keepForPrune(config);
    const victims = imagesToPrune(listLocalImages(), keep);
    for (const victim of victims) assertNotKept(victim, keep);
    for (const victim of victims) must(["docker", "image", "rm", victim.ref || victim.id]);
    console.log(victims.length ? `pruned ${victims.map((item) => item.ref || item.id).join(" ")}` : "pruned nothing");
    return 0;
  }
  if (!options.image) throw new Error("--image is required");
  const lock = JSON.parse(readFileSync(lockFile(), "utf8"));
  if (options.command === "check") {
    const manifest = JSON.parse(must(["docker", "run", "--rm", "--entrypoint", "cat", options.image, "/app/engines/manifest.json"]).stdout);
    const gate = assessProductionManifest(manifest, lock);
    if (!gate.ok) {
      alertLines([`engine_missing ${gate.errors.join("; ")}`]);
      return 1;
    }
    console.log(`engine set ${gate.engineSet}: ${productionEngineIds(lock).length} engines`);
    return 0;
  }
  if (options.command === "deploy") {
    const result = await deployImage({ image: options.image, lock }, dockerIo(config));
    if (!result.ok) return result.code;
    console.log(`deployed ${options.image}`);
    return 0;
  }
  throw new Error(`unknown command: ${options.command}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(`[engines] ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
