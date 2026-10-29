// #1329 (2026-10-29): "do not finish until" is checked after each 1:1 turn.
// A scripted fake engine leaves the condition unmet on its first reply: Sagax
// writes "relaunch 1/N" and starts the next turn on its own; the second
// reply says the condition is met and the run stops. A bot whose engine never
// meets it stops at its bound with one row that says so.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SERVER_DIR, "..");
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");

let child: ChildProcess;
let home = "";
let base = "";
let stderr = "";

const meetsReplies = [
  "I wrote the fix. The tests still fail on one case.",
  "I fixed the last case and ran the tests: all green.\n<sagax-finish>{\"status\":\"met\",\"detail\":\"42 tests pass\"}</sagax-finish>",
];

const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
};

type Row = { role: string; kind: string; text?: string; tool?: { name: string; finishUntil?: { status: string; round?: number; max?: number; detail?: string } } };
const messagesOf = async (botId: string): Promise<Row[]> =>
  (await api("GET", "/api/bots?messages=40")).body.bots.find((bot: { id: string }) => bot.id === botId)?.messages ?? [];
const busy = async (botId: string): Promise<boolean> =>
  Boolean((await api("GET", "/api/bots?messages=0")).body.bots.find((bot: { id: string }) => bot.id === botId)?.busy);

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-finish-until-"));
  const data = join(home, ".sagax");
  const staticDir = join(home, "static");
  mkdirSync(data, { recursive: true });
  mkdirSync(join(staticDir, "assets"), { recursive: true });
  writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>Finish until test</title>");
  writeFileSync(join(staticDir, "assets", "smoke.css"), "body{}");
  writeFileSync(join(data, "config.json"), JSON.stringify({
    instances: {
      meets: {
        driver: "claudeAgent",
        displayName: "Meets on the second turn",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify(meetsReplies),
          FAKE_CLAUDE_REPLY_STATE: join(home, "meets-replies.txt"),
          FAKE_CLAUDE_DUMP: join(home, "meets-dump.json"),
        },
        config: { cli: FAKE_CLAUDE },
      },
      never: {
        driver: "claudeAgent",
        displayName: "Never meets",
        environment: {
          FAKE_CLAUDE_MODE: "happy",
          FAKE_CLAUDE_REPLIES: JSON.stringify(["Still on it.", "Still on it.", "Still on it.", "Still on it.", "Still on it."]),
          FAKE_CLAUDE_REPLY_STATE: join(home, "never-replies.txt"),
        },
        config: { cli: FAKE_CLAUDE },
      },
    },
  }));
  const port = await freePortBlock([0, 1]);
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
    cwd: ROOT,
    env: {
      ...(process.env.PATH ? { PATH: process.env.PATH } : {}),
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      HOME: home,
      USERPROFILE: home,
      SAGAX_PORT: String(port),
      SAGAX_WEBHOOK_PORT: String(port + 1),
      SAGAX_STATIC_DIR: staticDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr!.on("data", (chunk) => (stderr += chunk));

  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}: ${stderr}`);
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) break;
    } catch {
      // Still starting.
    }
    if (Date.now() >= deadline) throw new Error(`server never became healthy: ${stderr}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}, 30_000);

afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

describe("do not finish until, checked after each turn (#1329)", () => {
  it("relaunches the bot while the condition is unmet and stops once its reply says it is met", async () => {
    const bot = (await api("POST", "/api/bots", {
      name: "Fixer",
      modelSelection: { instanceId: "meets", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    const patched = await api("PATCH", `/api/bots/${bot.id}`, { finishUntil: "the tests pass" });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    expect(patched.body.bot.finishUntil).toBe("the tests pass");

    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Fix the failing test" })).status).toBe(202);

    await expect.poll(async () => (await messagesOf(bot.id)).filter((row) => row.tool?.finishUntil).map((row) => row.tool!.finishUntil!.status),
      { timeout: 15_000 }).toEqual(["relaunch", "met"]);
    // nothing more starts on its own
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await busy(bot.id)).toBe(false);

    // from the person's message on (a new bot greets first)
    const all = await messagesOf(bot.id);
    const rows = all.slice(all.findIndex((row) => row.role === "user"));
    const visible = rows.filter((row) => (row.kind === "text") || row.tool?.finishUntil).map((row) =>
      row.tool?.finishUntil ? `${row.tool.finishUntil.status}:${row.tool.finishUntil.round}/${row.tool.finishUntil.max}` : `${row.role}:${row.text}`);
    expect(visible).toEqual([
      "user:Fix the failing test",
      "bot:I wrote the fix. The tests still fail on one case.",
      "relaunch:1/5",
      "bot:I fixed the last case and ran the tests: all green.",
      "met:1/5",
    ]);
    // the relaunch is not a message from the person, and the marker never shows
    expect(rows.filter((row) => row.role === "user")).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("sagax-finish");
    expect(rows.find((row) => row.tool?.finishUntil?.status === "met")?.tool?.finishUntil?.detail).toBe("42 tests pass");
    // the relaunch's words and the marker rule reached the model only
    const dump = readFileSync(join(home, "meets-dump.json"), "utf8");
    expect(dump).toContain("The condition is not met yet. Do not finish until: the tests pass");
    expect(dump).toContain("relaunch 1 of 5");
    expect(rows.find((row) => row.tool?.finishUntil?.status === "relaunch")?.tool?.name).toBe("Relaunch 1/5: not finished until the tests pass");
  }, 30_000);

  it("stops at the bot's bound with one row that says the condition is not met yet", async () => {
    const bot = (await api("POST", "/api/bots", {
      name: "Stubborn",
      modelSelection: { instanceId: "never", model: "claude-sonnet-5" },
      requireAvailableModel: true,
    })).body.bot;
    expect((await api("PATCH", `/api/bots/${bot.id}`, { finishUntil: "the report is sent", finishUntilMaxRounds: 2 })).status).toBe(200);

    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "Send the report" })).status).toBe(202);

    await expect.poll(async () => (await messagesOf(bot.id)).filter((row) => row.tool?.finishUntil).map((row) => row.tool!.finishUntil!.status),
      { timeout: 15_000 }).toEqual(["relaunch", "relaunch", "limit"]);
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    expect(await busy(bot.id)).toBe(false);

    const all = await messagesOf(bot.id);
    const rows = all.slice(all.findIndex((row) => row.role === "user"));
    expect(rows.filter((row) => row.role === "bot" && row.kind === "text")).toHaveLength(3);
    expect(rows.filter((row) => row.tool?.finishUntil).map((row) => `${row.tool!.finishUntil!.status}:${row.tool!.finishUntil!.round}/${row.tool!.finishUntil!.max}`))
      .toEqual(["relaunch:1/2", "relaunch:2/2", "limit:2/2"]);

    // clearing the condition (null bound back to the default) ends the check
    const cleared = await api("PATCH", `/api/bots/${bot.id}`, { finishUntil: "", finishUntilMaxRounds: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.bot.finishUntil).toBeUndefined();
    expect(cleared.body.bot.finishUntilMaxRounds).toBeUndefined();
  }, 30_000);
});
