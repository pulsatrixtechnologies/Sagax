// Reads an engine's own slash commands without a model call, from a short
// lived CLI process started like a turn's (same folder, same isolation).
//
//   Claude Code: the stream-json control request `initialize` answers with
//   `commands` (built-ins, project commands and skills, plugin commands and
//   skills, MCP prompts). No user message is sent, so no model is called.
//   Codex: the app-server's `skills/list` for the turn's folder.
//
// The process is stopped as soon as the answer arrives, or at the timeout.
import { createInterface } from "node:readline";

import {
  claudeInitializeCommands,
  normalizeCodexSkills,
  type HarnessCommand,
} from "../../shared/harness-commands.ts";
import { killCliTree, spawnCli } from "../procs.ts";

export const CLAUDE_COMMANDS_REQUEST_ID = "sagax-commands";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface CommandProbeInput {
  cli: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs?: number;
}

/** Writes `lines` to a CLI's stdin and resolves with the first stdout JSON
 * line `pick` accepts. Stops the process either way. */
function probe<T>(input: CommandProbeInput, lines: unknown[], pick: (message: unknown) => T | null): Promise<T> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawnCli>;
    try {
      child = spawnCli(input.cli, input.args, { cwd: input.cwd, env: input.env, stdio: ["pipe", "pipe", "pipe"] });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let settled = false;
    const finish = (error: Error | null, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reader.close();
      void killCliTree(child).catch(() => {});
      if (error) reject(error);
      else resolve(value as T);
    };
    const timer = setTimeout(() => finish(new Error("the engine did not list its commands in time")), input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref?.();
    // stderr may carry account details: drained, never kept
    child.stderr.resume();
    child.on("error", (error) => finish(error));
    child.on("exit", (code) => finish(new Error(`the engine exited (${code ?? "signal"}) before listing its commands`)));
    child.stdin.on("error", () => {});
    const reader = createInterface({ input: child.stdout });
    reader.on("line", (line) => {
      if (settled || !line.trim().startsWith("{")) return;
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      try {
        const value = pick(message);
        if (value !== null) finish(null, value);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    for (const line of lines) child.stdin.write(`${JSON.stringify(line)}\n`);
  });
}

/** Claude Code's commands for a process started with `args` (the turn's
 * isolation flags; this adds the stream-json ones). */
export function probeClaudeCommands(input: CommandProbeInput): Promise<HarnessCommand[]> {
  const args = ["-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose", ...input.args];
  return probe({ ...input, args },
    [{ type: "control_request", request_id: CLAUDE_COMMANDS_REQUEST_ID, request: { subtype: "initialize" } }],
    (message) => claudeInitializeCommands(message, CLAUDE_COMMANDS_REQUEST_ID));
}

/** Codex's skills for `cwd`, through `codex app-server` started with `args`. */
export function probeCodexSkills(input: CommandProbeInput & { clientVersion: string }): Promise<HarnessCommand[]> {
  return probe(input, [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "openmausbot", title: "Sagax", version: input.clientVersion } } },
    { jsonrpc: "2.0", method: "initialized", params: {} },
    { jsonrpc: "2.0", id: 2, method: "skills/list", params: { cwds: [input.cwd] } },
  ], (message) => {
    const record = message as { id?: unknown; result?: unknown; error?: { message?: unknown } } | null;
    if (!record || record.id !== 2) return null;
    if (record.error) throw new Error(typeof record.error.message === "string" ? record.error.message : "skills/list failed");
    return normalizeCodexSkills(record.result);
  });
}
