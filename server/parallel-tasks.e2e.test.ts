// Parallel tasks end to end (shared/parallel-tasks.ts): the real harness with
// the fake claude CLI in `slow` mode, where each prompt carrying [gate:NAME]
// holds its reply until the test drops that gate. A message sent while the
// conversation works can join the running turn (steer), wait for it (after)
// or run as its own task (parallel); parallel tasks run at once, finish in
// any order, answer in the conversation as replies to their own request,
// never see each other's words, can be stopped one by one and respect the
// per-person limit.
//
// POSIX-gated like the other CLI e2es (the fakes are shebang scripts).
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { freePortBlock } from "./testing/ports.ts";

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = join(SERVER_DIR, "testing", "fake-claude-cli.ts");
const posixOnly = describe.skipIf(process.platform === "win32");
const SEND_P1 = randomUUID();
const SEND_P2 = randomUUID();

posixOnly("parallel tasks e2e", () => {
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
  const messages = async (_botId: string, threadId: string): Promise<any[]> =>
    (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? [];
  const tasks = async (botId: string): Promise<any[]> => (await getBot(botId)).tasks ?? [];
  const open = (name: string) => writeFileSync(join(gates, name), "go");
  const waitFor = async (predicate: () => Promise<boolean>, what: string, ms = 30_000) => {
    const deadline = Date.now() + ms;
    while (!(await predicate())) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}. stderr: ${stderr.slice(-2000)}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  /** A bot on the gated fake, with its first turn running on `gate`. */
  const busyBot = async (gate: string) => {
    const bot = (await api("POST", "/api/bots")).body.bot;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "claude", model: "claude-fake" } });
    expect((await api("POST", `/api/bots/${bot.id}/messages`, { text: `[gate:${gate}] main work`, threadId: bot.threadId })).status).toBe(202);
    await waitFor(async () => (await getBot(bot.id)).busy === true, "the main turn to start");
    return bot as { id: string; threadId: string };
  };

  beforeAll(async () => {
    chmodSync(FAKE_CLAUDE, 0o755);
    home = mkdtempSync(join(tmpdir(), "omb-parallel-"));
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
    child.stderr!.on("data", (c) => (stderr += c));
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

  it("two parallel requests run beside the main turn, finish in any order and answer their own request", async () => {
    const bot = await busyBot("main1");
    const first = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:p1] summarize the logs", threadId: bot.threadId, busyMode: "parallel", sendId: SEND_P1 });
    const second = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:p2] draft the email", threadId: bot.threadId, busyMode: "parallel", sendId: SEND_P2 });
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(first.body.parallel).toMatchObject({ state: "running" });
    expect(second.body.parallel).toMatchObject({ state: "running" });
    const p1 = first.body.parallel.threadId as string;
    const p2 = second.body.parallel.threadId as string;
    expect(p1).not.toBe(p2);
    // a retry of the same send answers with the same request, no new task
    const retry = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:p1] summarize the logs", threadId: bot.threadId, busyMode: "parallel", sendId: SEND_P1 });
    expect(retry.body.message.id).toBe(first.body.message.id);
    expect((await tasks(bot.id)).filter((task) => task.parallelOf)).toHaveLength(2);

    // all three run at once: the main turn and both tasks
    await waitFor(async () => (await tasks(bot.id)).filter((task) => task.busy).length === 3, "three turns at once");
    const linked = (await tasks(bot.id)).filter((task) => task.parallelOf);
    expect(linked.map((task) => task.parallelOf.threadId)).toEqual([bot.threadId, bot.threadId]);

    // the conversation shows each request and its live card
    let main = await messages(bot.id, bot.threadId);
    const request1 = main.find((m) => m.id === first.body.message.id);
    expect(request1).toMatchObject({ role: "user", text: "[gate:p1] summarize the logs", parallelTask: { role: "request", threadId: p1 } });
    expect(main.filter((m) => m.parallelTask?.role === "card")).toHaveLength(2);

    // the second finishes first; its answer replies to its own request
    open("p2");
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.parallelTask?.role === "result" && m.parallelTask.threadId === p2), "the second result");
    main = await messages(bot.id, bot.threadId);
    const result2 = main.find((m) => m.parallelTask?.role === "result" && m.parallelTask.threadId === p2);
    expect(result2.replyToId).toBe(second.body.message.id);
    expect(result2.text).toContain("[gate:p2] draft the email");
    // no cross-talk: one task never reads the other's request
    expect(result2.text).not.toContain("gate:p1");
    expect(main.find((m) => m.parallelTask?.role === "card" && m.parallelTask.threadId === p2).parallelTask.state).toBe("done");
    expect((await getBot(bot.id)).busy).toBe(true);

    open("p1");
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.parallelTask?.role === "result" && m.parallelTask.threadId === p1), "the first result");
    main = await messages(bot.id, bot.threadId);
    const result1 = main.find((m) => m.parallelTask?.role === "result" && m.parallelTask.threadId === p1);
    expect(result1.replyToId).toBe(first.body.message.id);
    expect(result1.text).not.toContain("gate:p2");
    // each task kept its own engine session
    const sessions = (await tasks(bot.id)).filter((task) => task.parallelOf).map((task) => task.threadId);
    expect(new Set(sessions).size).toBe(2);

    // the main turn never saw either request and finishes on its own
    open("main1");
    await waitFor(async () => (await tasks(bot.id)).every((task) => !task.busy), "every turn to settle");
    main = await messages(bot.id, bot.threadId);
    const mainReply = main.find((m) => m.role === "bot" && m.kind === "text" && m.text.startsWith("reply to:") && !m.parallelTask);
    expect(mainReply.text).toContain("main work");
    expect(mainReply.text).not.toContain("summarize the logs");
  }, 60_000);

  it("after waits for the running turn; steer joins it", async () => {
    const bot = await busyBot("main2");
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.kind === "activity"), "the tool chip");
    const after = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:after2] then do this", threadId: bot.threadId, busyMode: "after" });
    expect(after.status).toBe(202);
    expect(after.body.queued).toBe(true);
    const steer = await api("POST", `/api/bots/${bot.id}/messages`, { text: "and keep it short", threadId: bot.threadId, busyMode: "steer" });
    expect(steer.body.steered).toBe(true);
    open("main2");
    // the queued line runs as the next turn, after the steered one settled
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.role === "user" && m.text === "[gate:after2] then do this"), "the queued line to drain");
    open("after2");
    await waitFor(async () => (await getBot(bot.id)).busy === false && (await messages(bot.id, bot.threadId)).filter((m) => m.role === "bot" && m.text?.startsWith("reply to:")).length === 2, "both turns");
    const replies = (await messages(bot.id, bot.threadId)).filter((m) => m.role === "bot" && m.text?.startsWith("reply to:")).map((m) => m.text);
    expect(replies[0]).toContain("steered: and keep it short");
    expect(replies[1]).toContain("then do this");
    expect((await tasks(bot.id)).some((task) => task.parallelOf)).toBe(false);
  }, 60_000);

  it("a parallel task stops on its own and says so in the conversation", async () => {
    const bot = await busyBot("main3");
    const sent = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:never3] long research", threadId: bot.threadId, busyMode: "parallel" });
    const taskThread = sent.body.parallel.threadId as string;
    await waitFor(async () => (await tasks(bot.id)).find((task) => task.threadId === taskThread)?.busy === true, "the task to run");
    const stopped = await api("POST", `/api/bots/${bot.id}/parallel/${taskThread}/stop`, {});
    expect(stopped.status).toBe(200);
    await waitFor(async () => (await messages(bot.id, bot.threadId)).some((m) => m.parallelTask?.role === "result" && m.parallelTask.threadId === taskThread), "the stopped result");
    const main = await messages(bot.id, bot.threadId);
    expect(main.find((m) => m.parallelTask?.role === "card" && m.parallelTask.threadId === taskThread).parallelTask.state).toBe("stopped");
    expect(main.find((m) => m.parallelTask?.role === "result").text).toContain("stopped");
    // the main turn kept going
    expect((await tasks(bot.id)).find((task) => task.threadId === bot.threadId)?.busy).toBe(true);
    expect((await api("POST", `/api/bots/${bot.id}/parallel/${taskThread}/stop`, {})).status).toBe(404);
    open("main3");
    await waitFor(async () => (await getBot(bot.id)).busy === false, "the main turn");
  }, 60_000);

  it("the per-person limit queues the next task until one of theirs finishes", async () => {
    expect((await api("PATCH", "/api/config", { threads: { maxParallelPerPerson: 1 } })).status).toBe(200);
    try {
      const bot = await busyBot("main4");
      const first = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:q1] first", threadId: bot.threadId, busyMode: "parallel" });
      const second = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:q2] second", threadId: bot.threadId, busyMode: "parallel" });
      expect(first.body.parallel.state).toBe("running");
      expect(second.body.parallel.state).toBe("queued");
      // a third waits too; past twice the limit waiting, a send is refused
      const third = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:q3] third", threadId: bot.threadId, busyMode: "parallel" });
      expect(third.body.parallel.state).toBe("queued");
      const refused = await api("POST", `/api/bots/${bot.id}/messages`, { text: "[gate:q4] fourth", threadId: bot.threadId, busyMode: "parallel" });
      expect(refused.status, JSON.stringify(refused.body)).toBe(409);
      expect(refused.body.code, JSON.stringify(refused.body)).toBe("parallel_limit");
      const q2 = second.body.parallel.threadId as string;
      await new Promise((r) => setTimeout(r, 500));
      expect((await tasks(bot.id)).find((task) => task.threadId === q2)?.busy).toBeFalsy();
      open("q1");
      await waitFor(async () => (await tasks(bot.id)).find((task) => task.threadId === q2)?.busy === true, "the queued task to start");
      open("q2");
      open("q3");
      open("main4");
      await waitFor(async () => (await messages(bot.id, bot.threadId)).filter((m) => m.parallelTask?.role === "result").length === 3, "three results");
      const results = (await messages(bot.id, bot.threadId)).filter((m) => m.parallelTask?.role === "result");
      expect(results.map((m) => m.replyToId)).toEqual([first.body.message.id, second.body.message.id, third.body.message.id]);
    } finally {
      await api("PATCH", "/api/config", { threads: { maxParallelPerPerson: null } });
    }
  }, 90_000);
});
