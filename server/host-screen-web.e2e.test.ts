// 2026-10-28: a person asked a bot on Auto for "the latest video of" someone
// and watched it open Chrome on their own screen and click through it. Web
// work now happens out of sight: on this computer the built-in (headless)
// browser stays mounted beside the screen, Claude Code never gets its own
// Chrome extension, and the prompt sends lookups to web search, fetch or that
// browser. The screen stays the person's to ask for: a turn that takes it is
// announced in the conversation and shown with Stop across the app.
// Real server, fake Claude CLI, a fake headless browser engine, a reachable
// CUA descriptor and no Local VM, so Auto lands on this computer.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createControlClient } from "./control-client.ts";
import { HOST_SCREEN_RULE } from "./surface.ts";
import { HOST_CONTROL_NOTICE } from "../shared/host-control.ts";
import { freePortBlock } from "./testing/ports.ts";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("web work stays out of sight on this computer", () => {
  let home = "";
  let data = "";
  let dumpFile = "";
  let finishFile = "";
  let stateFile = "";
  let output = "";
  let child: ChildProcess | null = null;
  let base = "";

  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(base + path, {
      method, headers: { "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  };
  const apiOk = async (method: string, path: string, body?: unknown) => {
    const result = await api(method, path, body);
    expect(result.status, `${method} ${path}: ${JSON.stringify(result.body)}`).toBeLessThan(400);
    return result.body;
  };
  async function until<T>(read: () => T | Promise<T>, accept: (value: T) => boolean): Promise<T> {
    const end = Date.now() + 20_000;
    for (;;) {
      const value = await read();
      if (accept(value)) return value;
      if (Date.now() >= end) throw new Error(`Fixture wait expired: ${JSON.stringify(value)}\n${output.slice(-2000)}`);
      await new Promise(resolve => setTimeout(resolve, 40));
    }
  }
  const dumpFor = (botId: string): Promise<any> => until((): any => {
    if (!existsSync(dumpFile)) return null;
    try {
      const sent = JSON.parse(readFileSync(dumpFile, "utf8"));
      return sent.mcpConfig?.mcpServers?.computer?.env?.SAGAX_CONTROL_URL?.includes(botId) ? sent : null;
    } catch { return null; }
  }, Boolean);
  const threadState = (botId: string, threadId: string) =>
    api("GET", "/api/bots?messages=0").then(({ body }) =>
      body.bots.find((bot: any) => bot.id === botId)?.tasks.find((task: any) => task.threadId === threadId));
  const busy = (botId: string, threadId: string) => until(() => threadState(botId, threadId), Boolean);
  const idle = (botId: string, threadId: string) => until(() => threadState(botId, threadId), task => !task?.busy);
  const notices = (threadId: string) => api("GET", `/api/threads/${threadId}/messages`).then(({ body }) =>
    (body.messages as any[]).filter(message => message.tool?.name === HOST_CONTROL_NOTICE));

  async function start() {
    const port = await freePortBlock([0, 1]);
    base = `http://127.0.0.1:${port}`;
    output = "";
    const browser = join(home, "agent-browser");
    const proc = spawn(process.execPath, ["--import", pathToFileURL(join(ROOT, "server/testing/group-local-vm-hooks.mjs")).href, join(ROOT, "server/index.ts")], {
      cwd: ROOT, env: { SAGAX_TEST_FIXED_WORKSPACE: "1", SAGAX_TEST_SEAMS: "1",
        PATH: dirname(process.execPath), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        HOME: home, USERPROFILE: home, SAGAX_LOCAL_VM_TEST_NAMESPACE: process.env.SAGAX_LOCAL_VM_TEST_NAMESPACE ?? "", SAGAX_DATA_DIR: data,
        APPDATA: join(home, "appdata"), LOCALAPPDATA: join(home, "localappdata"),
        TEMP: home, TMP: home, TMPDIR: home,
        SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1), SAGAX_STATIC_DIR: join(home, "static"), SAGAX_TEST_VM_STATE: stateFile,
        SAGAX_USER_DATA: join(home, "user-data"),
        SAGAX_AGENT_BROWSER_PATH: browser, AGENT_BROWSER_EXECUTABLE_PATH: browser,
      }, stdio: ["ignore", "pipe", "pipe"],
    });
    child = proc;
    proc.stdout!.on("data", chunk => { output += chunk; });
    proc.stderr!.on("data", chunk => { output += chunk; });
    await until(async () => {
      if (proc.exitCode !== null) throw new Error(`server exited during boot:\n${output}`);
      try { return (await fetch(base + "/api/health")).ok; } catch { return false; }
    }, Boolean);
  }
  async function stop() {
    if (!child) return;
    const proc = child;
    child = null;
    writeFileSync(finishFile, "finish");
    await waitForExit(proc, { signal: "SIGTERM" });
  }
  // Auto lands on the person's own desktop only on macOS and Windows.
  const itAutoHost = process.platform === "linux" ? it.skip : it;

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), "omb-host-screen-web-"));
    data = join(home, "data");
    stateFile = join(home, "vm.json");
    dumpFile = join(home, "dump.json");
    finishFile = join(home, "finish");
    writeFileSync(stateFile, JSON.stringify({ noContainers: true }));
    mkdirSync(data);
    mkdirSync(join(home, "static", "assets"), { recursive: true });
    writeFileSync(join(home, "static", "index.html"), "<title>Host screen web</title>");
    writeFileSync(join(home, "static", "assets", "test.css"), "body{}");
    mkdirSync(join(home, "user-data"), { recursive: true });
    writeFileSync(join(home, "user-data", "cua-connection.json"), JSON.stringify({
      mode: "embedded", status: "ready", socketPath: join(home, "cua.sock"),
      mcpCommand: "/fixture/cua-driver", mcpArgs: ["mcp"], mcpEnv: {},
    }), { mode: 0o600 });
    // A headless browser engine that answers MCP and opens no window.
    writeFileSync(join(home, "agent-browser"), [
      "#!/usr/bin/env node",
      'import { createInterface } from "node:readline";',
      "const args = process.argv.slice(2);",
      'if (args[0] === "mcp") {',
      '  createInterface({ input: process.stdin }).on("line", line => {',
      "    const message = JSON.parse(line); if (message.id === undefined) return;",
      '    const result = message.method === "initialize" ? { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "headless-browser", version: "1" } }',
      '      : message.method === "tools/list" ? { tools: [{ name: "agent_browser_open", inputSchema: { type: "object" } }] }',
      '      : { content: [{ type: "text", text: "opened out of sight" }] };',
      '    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\\n");',
      "  });",
      '} else if (args[0] === "session") process.stdout.write(JSON.stringify({ success: true, data: { sessions: [] } }));',
      'else process.stdout.write("1.0.0\\n");',
    ].join("\n"), { mode: 0o700 });
    writeFileSync(join(data, "config.json"), JSON.stringify({
      features: { browser: true },
      instances: { claude: {
        driver: "claudeAgent", config: { cli: join(ROOT, "server/testing/fake-claude-cli.ts") },
        environment: { FAKE_CLAUDE_MODE: "slow", FAKE_CLAUDE_DUMP: dumpFile, FAKE_CLAUDE_SLOW_FINISH_GATE: finishFile },
      } },
    }));
  });
  afterAll(async () => {
    await stop();
    if (home) await removeTempDir(home);
  });
  afterEach(async () => {
    await stop();
    rmSync(dumpFile, { force: true });
    rmSync(finishFile, { force: true });
  });

  itAutoHost("« montre-moi la dernière vidéo de X » gets an out-of-sight browser and no hold on the screen", async () => {
    await start();
    const { bot } = await apiOk("POST", "/api/bots", { name: "Video Finder" });
    const { task } = await apiOk("POST", `/api/bots/${bot.id}/tasks`, {});
    await apiOk("POST", `/api/bots/${bot.id}/messages`, { text: "Montre-moi la dernière vidéo de Lumière Studio.", threadId: task.threadId });
    await busy(bot.id, task.threadId);
    const sent = await dumpFor(bot.id);
    // The screen is still there for the person to ask for (not a restriction)…
    expect(sent.mcpConfig.mcpServers.computer).toBeTruthy();
    // …but web work has the headless browser beside it, the engine's own
    // Chrome extension is off, and the prompt sends lookups out of sight.
    expect(sent.mcpConfig.mcpServers.browser).toBeTruthy();
    expect(sent.argv).toContain("--no-chrome");
    expect(sent.systemPrompt).toContain(HOST_SCREEN_RULE.trim().slice(0, 120));
    expect(sent.systemPrompt).toContain("Two surfaces are mounted this turn: the built-in browser");
    expect(sent.systemPrompt).toContain("which runs out of sight inside Sagax");
    // Nothing took the screen: no line, no banner.
    expect((await apiOk("GET", "/api/computer/host-control")).bots).toEqual([]);
    expect(await notices(task.threadId)).toEqual([]);
    writeFileSync(finishFile, "finish");
    await idle(bot.id, task.threadId);
    expect(await notices(task.threadId)).toEqual([]);
  }, 60_000);

  itAutoHost("« ouvre ça dans mon Chrome » takes the screen: announced once in the chat, shown with Stop", async () => {
    await start();
    const { bot } = await apiOk("POST", "/api/bots", { name: "Chrome Opener" });
    const { task } = await apiOk("POST", `/api/bots/${bot.id}/tasks`, {});
    await apiOk("POST", `/api/bots/${bot.id}/messages`, { text: "Ouvre ça dans mon Chrome.", threadId: task.threadId });
    await busy(bot.id, task.threadId);
    const computer = (await dumpFor(bot.id)).mcpConfig.mcpServers.computer;
    // The first screen action, exactly as the mounted bridge checks it.
    const control = createControlClient({ url: computer.env.SAGAX_CONTROL_URL, token: computer.env.SAGAX_CONTROL_TOKEN });
    expect(await control.state(true)).toEqual({ held: false, helpOpen: false });
    expect(await control.state(true)).toEqual({ held: false, helpOpen: false });
    // One line in the conversation, however many calls follow.
    expect(await until(() => notices(task.threadId), list => list.length > 0)).toHaveLength(1);
    // The banner names the bot; its Stop is the ordinary task stop.
    const banner = await apiOk("GET", "/api/computer/host-control");
    expect(banner.bots).toEqual([{ id: bot.id, name: "Chrome Opener", threadId: task.threadId }]);
    await apiOk("POST", `/api/bots/${bot.id}/interrupt`, { threadId: task.threadId });
    await idle(bot.id, task.threadId);
    expect((await apiOk("GET", "/api/computer/host-control")).bots).toEqual([]);
    expect(await notices(task.threadId)).toHaveLength(1);
  }, 60_000);
});
