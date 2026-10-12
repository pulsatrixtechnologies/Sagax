// Background replies end to end (shared/background-reply.ts): a request that
// takes more than a quick answer gets a one-sentence acknowledgement before
// the engine is held, the conversation stays free for a short follow-up, and
// the result arrives later as its own message. Turning the bot off keeps the
// classic inline turn.
//
// POSIX-gated like the other CLI e2es (the fake is a shebang script).
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ackClaimsResult, frenchAnglicisms } from "../shared/background-reply.ts";
import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const ASK = "Peux tu m'affiche l'age des comptes de Alubar";

posixOnly("background replies e2e", () => {
  let child: ChildProcess;
  let home: string;
  let gates: string;
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
  const tasks = async (botId: string): Promise<any[]> => (await getBot(botId)).tasks ?? [];
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 80));
    }
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-bg-reply-"));
    gates = join(home, "gates");
    mkdirSync(gates, { recursive: true });
    mkdirSync(join(home, ".sagax"), { recursive: true });
    writeFileSync(join(home, ".sagax", "config.json"), JSON.stringify({
      instances: {
        claude: {
          driver: "claudeAgent",
          environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_GATE_DIR: gates },
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
    child.stderr!.on("data", (chunk) => (stderr += chunk));
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

  it("acknowledges a long request before the work finishes, and stays free for a quick follow-up", async () => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "claude-fake" } });
    const sent = api("POST", `/api/bots/${bot.id}/messages`, { text: `${ASK} [gate:work]`, threadId: bot.threadId });
    await waitFor(async () => (await messages(bot.threadId)).some((message) => message.backgroundReply === "ack"), "the acknowledgement");
    const early = await messages(bot.threadId);
    const ack = early.find((message) => message.backgroundReply === "ack");
    expect(ack.text).toBe("Je vérifie l'âge des comptes d'Alubar.");
    expect(ack.text).not.toContain("ConnectWise");
    expect(ackClaimsResult(ack.text)).toBe(false);
    expect(frenchAnglicisms(ack.text)).toEqual([]);
    expect(ack.timeToFirstMessageMs).toEqual(expect.any(Number));
    expect(ack.timeToFirstMessageMs).toBeLessThan(1000);
    await waitFor(async () => (await tasks(bot.id)).some((task) => task.parallelOf?.background === true && task.busy), "the background task to start");
    const parent = (await tasks(bot.id)).find((task) => task.threadId === bot.threadId);
    expect(parent.busy).not.toBe(true);
    expect(early.some((message) => message.parallelTask?.role === "result")).toBe(false);

    const posted = await sent;
    expect(posted.status).toBe(202);
    const hello = await api("POST", `/api/bots/${bot.id}/messages`, { text: "Bonjour", threadId: bot.threadId });
    expect(hello.status).toBe(202);
    await waitFor(
      async () => (await messages(bot.threadId)).some((message) => message.role === "bot" && message.text?.includes("Bonjour") && !message.backgroundReply),
      "the quick reply",
    );
    const during = await messages(bot.threadId);
    expect(during.filter((message) => message.backgroundReply === "ack")).toHaveLength(1);
    expect(during.find((message) => message.text?.includes("Bonjour") && message.role === "bot").backgroundReply).toBeUndefined();

    writeFileSync(join(gates, "work"), "go");
    await waitFor(
      async () => (await messages(bot.threadId)).some((message) => message.parallelTask?.role === "result"),
      "the result",
    );
    const done = await messages(bot.threadId);
    const result = done.find((message) => message.parallelTask?.role === "result");
    expect(result.text).toContain(ASK);
    expect(result.text).not.toBe(ack.text);
    expect(result.id).not.toBe(ack.id);
    const settled = (await tasks(bot.id)).find((task) => task.threadId === bot.threadId);
    expect(settled.unread).toBe(true);
  }, 60_000);

  it("keeps a bot that opted out on one inline turn", async () => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${bot.id}`, {
      modelSelection: { instanceId: "claude", model: "claude-fake" },
      backgroundReplies: false,
    });
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: ASK, threadId: bot.threadId });
    expect(sent.status).toBe(202);
    await waitFor(
      async () => (await messages(bot.threadId)).some((message) => message.role === "bot" && message.kind === "text" && message.text?.includes(ASK)),
      "the inline reply",
    );
    const transcript = await messages(bot.threadId);
    expect(transcript.some((message) => message.backgroundReply)).toBe(false);
    expect(transcript.some((message) => message.parallelTask)).toBe(false);
    expect((await tasks(bot.id)).some((task) => task.parallelOf)).toBe(false);
  }, 60_000);
});
