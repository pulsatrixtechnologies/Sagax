// Every way a published page, an artifact or a widget opens and shows in the
// desktop app, end to end and headless: a real server (the verification
// fixture) with a bot, a page the bot proposed and an artifact it saved; the
// real Electron running electron/fixtures/pages-open.cjs, which drives the
// built UI through the real modules (preload, artifact-window.mjs,
// bundled-ui.cjs, page-frames.mjs) in both ways the desktop loads a server:
// its own page (direct) and this app's bundle on the server's origin
// (bundled). No window is ever shown.
//
// This is the barrier that was missing when four fixes in two days each
// patched one path while another broke (#1509, #1517, #1529, #1495): the
// chat card, the page over the conversation, Present, × and Escape, the
// Library, a page's own window, the reading link, an artifact's own window
// and its full screen, and a window nobody has written yet.
//
// Needs the built UI (dist/, `pnpm build` or `pnpm exec vite build`). Without
// it the test is skipped with a notice; SAGAX_UI_E2E=1 makes the missing
// build a failure. SAGAX_PAGES_OPEN_OUT keeps the captures (docs/screenshots);
// SAGAX_PAGES_OPEN_ELECTRON_DIR measures another checkout's electron/.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, type VerificationServer } from "../control-omb.ts";
import { removeTempDir } from "../../server/testing/cleanup.ts";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = process.env.SAGAX_PAGES_OPEN_DIST || join(root, "dist");
const built = existsSync(join(dist, "index.html"));
const required = process.env.SAGAX_UI_E2E === "1";
if (!built && !required) console.log("skipping pages-open: build the UI (pnpm exec vite build) to run the headless desktop check");

const PAGE_MARKER = "Rapport mensuel des demandes";
const ARTIFACT_TITLE = "Tableau des commandes";
const ARTIFACT_MARKER = "Commandes cette semaine: 128";

interface Line { check?: string; mode?: string; ok?: boolean; detail?: string; done?: boolean; failed?: number; error?: string; log?: string; console?: string; capture?: string; legacy?: boolean }

function runFixture(args: string[], timeoutMs: number): Promise<{ lines: Line[]; code: number | null; stderr: string }> {
  const electron = require("electron") as string;
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return new Promise((resolve, reject) => {
    const child = spawn(electron, [join(root, "electron", "fixtures", "pages-open.cjs"), ...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    const lines: Line[] = [];
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`the desktop fixture took more than ${timeoutMs} ms; lines so far: ${JSON.stringify(lines)}`)); }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      let index: number;
      while ((index = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, index).trim();
        stdout = stdout.slice(index + 1);
        if (!line.startsWith("{")) continue;
        try { lines.push(JSON.parse(line) as Line); } catch { /* not ours */ }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ lines, code, stderr }); });
  });
}

(built || required ? it : it.skip)("a page, an artifact and a widget open and show the same way everywhere in the desktop app, direct and bundled, headless", async () => {
  if (!built) throw new Error("Run pnpm exec vite build before the pages-open desktop check");
  const gates = mkdtempSync(join(tmpdir(), "omb-pages-open-"));
  const gate = join(gates, "finish");
  let fixture: VerificationServer | undefined;
  try {
    // the server, drawing the same built UI (direct mode loads it from here)
    fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_SLOW_FINISH_GATE: gate }, undefined, undefined, undefined, undefined, undefined, [], undefined, dist);
    const url = fixture.info.url;
    const api = async (method: string, path: string, body?: unknown, expected = 200, token?: string) => {
      const response = await fetch(url + path, {
        method, headers: { "content-type": "application/json", origin: url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = await response.json() as any;
      expect(response.status, `${method} ${path}: ${JSON.stringify(result)}`).toBe(expected);
      return result;
    };
    const bot = (await api("POST", "/api/bots", { name: "Scout" }, 201)).bot as { id: string; threadId: string };
    // a turn in flight gives the bot its capability to propose a page and save an artifact
    await runControlOmb(["send", "--bot", bot.id, "--task", bot.threadId, "--text", "Prepare the monthly report", "--url", url]);
    let token = "";
    await expect.poll(() => {
      try { token = JSON.parse(readFileSync(fixture!.fixtureDumpPath, "utf8")).mcpConfig.mcpServers.agents.env.SAGAX_COMMS_TOKEN; }
      catch { return false; }
      return Boolean(token);
    }, { timeout: 20_000 }).toBe(true);
    const content = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Rapport</title></head><body style="font:16px system-ui;padding:24px"><h1>${PAGE_MARKER}</h1><p>Octobre: 128 demandes, 96 % dans les délais.</p></body></html>`;
    const proposed = await api("POST", "/api/internal/options-card", { tool: "propose_page", title: "Rapport mensuel", kind: "html", content }, 201, token) as { pageId: string; version: number };
    expect(proposed.pageId).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
    const saved = (await api("POST", "/api/internal/artifacts", { tool: "save_artifact", args: { title: ARTIFACT_TITLE, html: `<body style="font:15px system-ui;padding:16px"><h3>${ARTIFACT_TITLE}</h3><p>${ARTIFACT_MARKER}</p></body>` } }, 201, token)).artifact as { id: string };
    // published with a reading link, so Share offers « Open in browser »
    await api("POST", `/api/pages/${proposed.pageId}/publish`, { version: proposed.version, access: "link", expiresAt: null });
    writeFileSync(gate, "finish");

    const out = process.env.SAGAX_PAGES_OPEN_OUT || join(fixture.info.dataDir, "pages-open-captures");
    const args = [
      `--server=${url}`, `--dist=${dist}`, `--out=${out}`, `--bot=${bot.id}`, `--page=${proposed.pageId}`, `--page-marker=${PAGE_MARKER}`,
      `--artifact=${saved.id}`, `--artifact-title=${ARTIFACT_TITLE}`, `--artifact-marker=${ARTIFACT_MARKER}`,
      ...(process.env.SAGAX_PAGES_OPEN_ELECTRON_DIR ? [`--electron-dir=${process.env.SAGAX_PAGES_OPEN_ELECTRON_DIR}`] : []),
      ...(process.env.SAGAX_PAGES_OPEN_MODES ? [`--modes=${process.env.SAGAX_PAGES_OPEN_MODES}`] : []),
    ];
    const run = await runFixture(args, 240_000);
    const checks = run.lines.filter((line) => line.check);
    const failures = checks.filter((line) => !line.ok).map((line) => `${line.mode}/${line.check}: ${line.detail}`);
    const notes = run.lines.filter((line) => line.log || line.console || line.error || line.capture);
    console.log(`pages-open: ${checks.length} checks, ${failures.length} failed; captures in ${out}`);
    for (const line of checks) console.log(`  ${line.ok ? "ok " : "FAIL"} ${line.mode}/${line.check}${line.detail ? `: ${line.detail}` : ""}`);
    if (notes.length) console.log(`  notes: ${JSON.stringify(notes.slice(0, 20))}`);
    const done = run.lines.find((line) => line.done);
    if (!done || done.failed || run.code !== 0) console.log(`  exit ${run.code}, done: ${JSON.stringify(done)}, stderr: ${run.stderr.slice(-3000)}`);
    expect(failures, run.stderr.slice(-2000)).toEqual([]);
    // both modes, every check, present (a mode that did not run is a failure too)
    const expected = ["app", "chat-card", "chat-panel", "present", "close-x", "close-escape", "library", "own-window", "reading-link", "artifact-window", "plain-window", "ui-source"];
    for (const mode of (process.env.SAGAX_PAGES_OPEN_MODES ?? "direct,bundled").split(",")) {
      expect(checks.filter((line) => line.mode === mode).map((line) => line.check)).toEqual(expected);
    }
    expect(run.lines.find((line) => line.done)?.failed).toBe(0);
    expect(run.code).toBe(0);
  } finally {
    await fixture?.close();
    await removeTempDir(gates);
  }
}, 360_000);
