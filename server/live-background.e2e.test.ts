// Long work in the background, the conversation always free (2026-10-28).
// A bot that is handed long work opens it as its own task (start_thread
// report_back, THREADS_PROMPT in server/system-prompt.ts): the person keeps
// talking to the bot, which answers at once, and the task's result comes
// back in the conversation when it is done.
//
// The real harness with the fake claude CLI (`slow`): a turn whose prompt
// says BACKGROUND_ME calls start_thread the way the model does; the task's
// request carries [gate:bg] and holds until the test opens that gate.
//
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");

posixOnly("background work e2e", () => {
  let child: ChildProcess;
  let home: string;
  let base = "";
  let stderr = "";

  const api = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };
  const getBot = async (id: string) => (await api("GET", "/api/bots")).body.bots.find((b: any) => b.id === id);
  const messages = async (threadId: string): Promise<any[]> =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? [];
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-3000)}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "sagax-live-background-"));
    mkdirSync(join(home, ".sagax"), { recursive: true });
    mkdirSync(join(home, "gates"), { recursive: true });
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: {
            FAKE_CLAUDE_MODE: "slow",
            FAKE_CLAUDE_GATE_DIR: join(home, "gates"),
            FAKE_CLAUDE_MCP_CALLS: JSON.stringify([{ server: "agents", tool: "start_thread", when: "BACKGROUND_ME", arguments: { title: "Full audit", message: "[gate:bg] run the full audit of every invoice", report_back: true } }]),
          },
          config: { cli: FAKE_CLAUDE, permissionMode: "bypassPermissions" },
        },
      },
    }));
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(SERVER_DIR, "index.ts")], {
      cwd: join(SERVER_DIR, ".."),
      env: { ...(process.env.PATH ? { PATH: process.env.PATH } : {}), HOME: home, USERPROFILE: home, SAGAX_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr!.on("data", (c) => (stderr += c));
    child.stdout!.on("data", (c) => (stderr += c));
    const deadline = Date.now() + 20_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        /* not up yet */
      }
      if (Date.now() > deadline) throw new Error(`server never came up. stderr:\n${stderr}`);
      if (child.exitCode !== null) throw new Error(`server exited ${child.exitCode}. stderr:\n${stderr}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }, 30_000);

  afterAll(async () => {
    child?.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null) return resolve();
      child.on("close", () => resolve());
      setTimeout(() => (child.kill("SIGKILL"), resolve()), 5_000).unref?.();
    });
    rmSync(home, { recursive: true, force: true });
  });

  it("long work runs as its own task; the conversation answers at once and gets the result", async () => {
    const bot = (await api("POST", "/api/bots")).body.bot as { id: string; threadId: string };
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "claude-fake" } });
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: "BACKGROUND_ME audit every invoice this year", threadId: bot.threadId })).status).toBe(202);
    // the bot hands the work to a task of its own and its turn ends
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.parallelTask?.role === "card"), "the background task's card");
    const card = (await messages(bot.threadId)).find((m) => m.parallelTask?.role === "card");
    const task = card.parallelTask.threadId as string;
    await waitFor(async () => (await getBot(bot.id)).tasks.find((t: any) => t.threadId === task)?.busy === true, "the task to run");
    await waitFor(async () => (await getBot(bot.id)).tasks.find((t: any) => t.threadId === bot.threadId)?.busy !== true, "the conversation to be free");

    // the person keeps talking: an answer right away, the task still running
    const asked = Date.now();
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "how is it going?", threadId: bot.threadId, routeWhileBusy: true });
    expect(sent.status, JSON.stringify(sent.body)).toBe(202);
    expect(sent.body.queued).toBeUndefined();
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.role === "bot" && m.kind === "text" && m.text?.includes("how is it going?")), "the answer in the conversation", 5_000);
    console.log(`[measure] answer while the task runs: ${Date.now() - asked} ms`);
    expect((await getBot(bot.id)).tasks.find((t: any) => t.threadId === task)?.busy).toBe(true);

    // the task ends: its result comes back here, the card says so
    writeFileSync(join(home, "gates", "bg"), "go");
    await waitFor(async () => (await messages(bot.threadId)).some((m) => m.parallelTask?.role === "result"), "the result in the conversation");
    // one task of this conversation (the fixture's brief repeats the marker, so
    // the task itself may open more of its own: not this conversation's)
    expect((await getBot(bot.id)).tasks.filter((t: any) => t.parallelOf?.threadId === bot.threadId)).toHaveLength(1);
  }, 60_000);
});
