// sagax_help through the real mounted agents MCP of a disposable fixture:
// the turn is shown find_tool and use_tool, use_tool calls sagax_help on
// the same path, the call reaches /api/internal/self-knowledge with the
// turn's capability, and the answer names the solo server.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";
import { COMPACT_CORE_AGENT_TOOL_NAMES } from "./drivers/agents-catalog.ts";
/** #1276: the bridge lists the heart of a chat turn by name, sorted, then find_tool and use_tool. */
function expectBridgeList(names: string[]): void {
  expect(names.slice(-2)).toEqual(["find_tool", "use_tool"]);
  const listed = names.slice(0, -2);
  expect(listed).toEqual([...listed].sort());
  expect(listed.every((name) => COMPACT_CORE_AGENT_TOOL_NAMES.has(name) || name === "shared_computer")).toBe(true);
}


it("answers sagax_help from the generated base in a real turn", async () => {
  const fixture = await launchVerificationServer({ FAKE_CLAUDE_MODE: "hang" });
  const proxies: ChildProcess[] = [];
  const cli = async (...args: string[]) => await runControlOmb(args, { env: { SAGAX_URL: fixture.info.url } }) as any;
  try {
    expect((await cli("doctor")).ok).toBe(true);
    const bot = (await cli("new-bot", "--name", "Helper")).bot;
    const dumpFile = join(fixture.info.dataDir, "fake-claude-dump.json");
    rmSync(dumpFile, { force: true });
    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Hold this verification turn open.");
    await expect.poll(() => existsSync(dumpFile), { timeout: 15_000 }).toBe(true);
    const mounted = JSON.parse(readFileSync(dumpFile, "utf8")).mcpConfig.mcpServers.agents;
    const proxy = spawn(mounted.command, mounted.args, { cwd: process.cwd(),
      env: { ...mounted.env, PATH: process.env.PATH, HOME: fixture.info.dataDir }, stdio: ["pipe", "pipe", "pipe"] });
    proxies.push(proxy);
    proxy.stderr!.resume();
    let sequence = 0;
    const pending = new Map<number, (value: any) => void>();
    createInterface({ input: proxy.stdout! }).on("line", (line) => {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
    const rpc = (method: string, params?: unknown): Promise<any> => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture MCP ${method} timed out`)); }, 10_000);
      pending.set(id, (result) => { clearTimeout(timer); resolve(result); });
      proxy.stdin!.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
    await rpc("initialize", { protocolVersion: "2024-11-05" });
    const listed = (await rpc("tools/list")).result.tools as Array<{ name: string }>;
    expectBridgeList(listed.map((tool) => tool.name));
    const answer = (await rpc("tools/call", { name: "use_tool", arguments: { name: "sagax_help", arguments: { question: "Où sont mes routines ?" } } })).result;
    expect(answer.isError).toBeFalsy();
    const text = answer.content[0].text as string;
    expect(text).toContain("a person's own Sagax (solo, no organization)");
    expect(text).toContain("Automations");
    expect(text.length).toBeLessThan(4000);
    // Without the turn's capability the route answers nothing.
    const refused = await fetch(`${fixture.info.url}/api/internal/self-knowledge`, { method: "POST",
      headers: { origin: fixture.info.url, "content-type": "application/json" }, body: JSON.stringify({ question: "x" }), signal: AbortSignal.timeout(10_000) });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(await refused.text()).not.toContain("knowledge");
  } finally {
    try { await Promise.all(proxies.map((proxy) => waitForExit(proxy, { signal: "SIGTERM" }))); } finally { await fixture.close(); }
  }
}, 90_000);
