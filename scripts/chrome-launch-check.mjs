#!/usr/bin/env node
// Start Chrome the way agent-browser launches it on the server (headless,
// no sandbox, a fresh profile, DevTools on a free port) and fail unless it
// writes DevToolsActivePort with no crash handler FATAL on stderr.
// `chrome --version` alone never spawns chrome_crashpad_handler: the 0.5.2
// image passed it while every real launch logged
// FATAL ... spawn_subprocess.cc:231 posix_spawn .../chrome_crashpad_handler.
//
//   node scripts/chrome-launch-check.mjs /opt/openmausbot-browser/chrome
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The launch flags of agent-browser 0.38.2 that matter here. */
export function chromeLaunchArgs(profileDir) {
  return [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "about:blank",
  ];
}

const FATAL_LINE = /FATAL[^\n]*/;

export async function checkChromeLaunch(chromePath, { timeoutMs = 30_000, settleMs = 1_000 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "chrome-launch-check-"));
  const profile = join(root, "profile");
  const portFile = join(profile, "DevToolsActivePort");
  let stderr = "";
  let exited = null;
  const child = spawn(chromePath, chromeLaunchArgs(profile), { stdio: ["ignore", "ignore", "pipe"], detached: true });
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const spawnError = new Promise((resolve) => child.once("error", resolve));
  child.once("exit", (code, signal) => { exited = { code, signal }; });
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  try {
    const failed = await Promise.race([
      spawnError,
      (async () => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline && !exited && !(existsSync(portFile) && readFileSync(portFile, "utf8").trim())) await sleep(50);
        return null;
      })(),
    ]);
    if (failed) throw new Error(`chrome did not start: ${failed.message}`);
    const port = existsSync(portFile) ? readFileSync(portFile, "utf8").split("\n")[0].trim() : "";
    // The crash handler spawn fails a moment after the port file in some runs.
    if (port && !exited) await sleep(settleMs);
    const fatal = FATAL_LINE.exec(stderr)?.[0];
    if (fatal) throw new Error(`chrome logged ${fatal}`);
    if (!port) {
      const why = exited ? `exited (${exited.signal ?? exited.code})` : `timed out after ${timeoutMs} ms`;
      throw new Error(`chrome ${why} before writing DevToolsActivePort`);
    }
    return { port: Number(port) };
  } finally {
    if (!exited && child.pid) {
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ }
    }
    rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const chromePath = process.argv[2];
  if (!chromePath) throw new Error("usage: chrome-launch-check.mjs <chrome>");
  const { port } = await checkChromeLaunch(chromePath);
  console.log(`[chrome] started, DevToolsActivePort ${port}, no FATAL`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(() => process.exit(0), (error) => {
    console.error(`[chrome] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
