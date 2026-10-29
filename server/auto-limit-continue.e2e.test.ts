// A usage limit in the middle of an Auto turn, end to end through the real
// server and the fake Claude CLI (JC, 2026-10-29: "on switch à un modèle qui
// fonctionne sans aviser l'utilisateur, ça doit être transparent"). No
// provider is called.
//
// The first model Auto picks takes one step, then its own weekly window
// refuses it. The same turn goes on at once on another model Auto picks,
// told the step already taken so it does not run it again, and answers. The
// chat shows the person's message and the answer: no error, no line about
// the switch (that one is in the Events lens).
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { isTechnicalNoticeName } from "../shared/chat-notices.ts";
import { waitForExit } from "./testing/cleanup.ts";

const jsonLines = (path: string): any[] => existsSync(path)
  ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

it("continues an Auto turn on another model when its model hits a usage limit, with nothing in the chat", async () => {
  const fixture = await launchVerificationServer();
  const { dataDir, url, logPath } = fixture.info;
  const limitedModelFile = join(dataDir, "limited-model.txt");
  const claudePrompts = join(dataDir, "claude-prompts.jsonl");
  let server: ChildProcess | undefined;
  const api = async (method: string, path: string, body?: unknown): Promise<any> => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    const result = await response.json();
    expect(response.ok, `${method} ${path}: ${JSON.stringify(result)}`).toBe(true);
    return result;
  };
  try {
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.instances.claude.environment = {
      ...config.instances.claude.environment,
      FAKE_CLAUDE_PROMPTS: claudePrompts, FAKE_CLAUDE_TOOL_CALLS: "[]", FAKE_CLAUDE_LIMIT_MID_TURN_FILE: limitedModelFile,
    };
    writeFileSync(configPath, JSON.stringify(config));
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: verificationServerEnvironment({}, dataDir, Number(new URL(url).port)),
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);

    const { bot } = await runControlOmb(["new-bot", "--name", "Auto limit", "--url", url]) as any;
    const threadId = bot.activeTaskId;
    await api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { ...bot.modelSelection, auto: true } });
    const messages = async () => (await api("GET", `/api/threads/${threadId}/messages?limit=200`)).messages as any[];
    const busy = async () => (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id)
      .tasks.find((entry: any) => entry.threadId === threadId).busy;

    const ask = "SUMMARIZE_THE_REPORTS_7K";
    await api("POST", `/api/bots/${bot.id}/messages`, { text: ask, threadId });
    await expect.poll(async () => (await messages()).some((message) => message.role === "bot" && message.kind === "text" && message.text === "hello from fake claude"),
      { timeout: 60_000, interval: 250 }).toBe(true);
    await expect.poll(busy, { timeout: 30_000, interval: 200 }).toBe(false);
    const thread = await messages();

    // Two runs of the same turn: the limited model, then another one Auto picked.
    const limitedModel = readFileSync(limitedModelFile, "utf8").trim();
    const prompts = jsonLines(claudePrompts);
    expect(prompts.length).toBeGreaterThanOrEqual(2);
    const resumed = JSON.stringify(prompts.at(-1));
    expect(resumed).toContain(ask);
    // the next model is told the step already taken, so it never runs it again
    expect(resumed).toContain("reached its usage limit in the middle of the work");
    expect(resumed).toContain("ls /srv/reports");
    const task = (await api("GET", "/api/bots")).bots.find((entry: any) => entry.id === bot.id).tasks.find((entry: any) => entry.threadId === threadId);
    expect(task.autoModel?.model).toBeTruthy();
    expect(task.autoModel.model).not.toBe(limitedModel);

    // The person's message once, the answer, and nothing about the limit in the chat.
    expect(thread.filter((message) => message.role === "user" && message.text === ask)).toHaveLength(1);
    expect(thread.filter((message) => message.kind === "activity" && (message.tool?.name ?? "").startsWith("error:"))).toHaveLength(0);
    const limitRows = thread.filter((message) => message.tool?.limitFailover);
    expect(limitRows.length).toBeGreaterThanOrEqual(1);
    for (const row of limitRows) expect(isTechnicalNoticeName(row.tool.name)).toBe(true);
    expect(thread.filter((message) => message.kind === "activity" && (message.tool?.name ?? "").startsWith("recovery:"))).toHaveLength(0);
  } finally {
    await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
  }
}, 150_000);
