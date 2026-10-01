// The tools a bot gets in a person's server environment: run a command,
// read, write and list files, and open a web page in a headless browser. Each
// call becomes one exec in that person's sandbox through the manager; nothing
// here touches the Sagax server's own filesystem or processes.
import type { SandboxExecOutput } from "./sandboxd-core.ts";

export const USER_SANDBOX_TOOLS = [
  {
    name: "run_command",
    description: "Run a bash command in your server environment (an isolated Linux machine of your own on the server; /workspace persists). Not your computer and not the Sagax server.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "The bash command line." },
        timeout_seconds: { type: "number", description: "Stop after this many seconds (default 120, at most 600)." },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "read_file",
    description: "Read a text file in your server environment. Relative paths start at /workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, max_bytes: { type: "number", description: "Default 200000." } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "write_file",
    description: "Create or replace a file in your server environment. Relative paths start at /workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description: "List a directory in your server environment (default /workspace).",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, additionalProperties: false },
  },
  {
    name: "browse",
    description: "Open a public web page in a headless browser in your server environment and return its rendered HTML, or a PNG screenshot.",
    inputSchema: {
      type: "object",
      properties: { url: { type: "string" }, screenshot: { type: "boolean" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
] as const;

export type UserSandboxToolName = (typeof USER_SANDBOX_TOOLS)[number]["name"];

const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_PATH = 4096;

export interface ToolExec {
  exec(input: { argv: string[]; env?: Record<string, string>; timeoutSec?: number; maxOutputBytes?: number }): Promise<SandboxExecOutput>;
  overQuota(): Promise<boolean>;
}

type ToolContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ToolResult { content: ToolContent[]; isError?: boolean }

const text = (value: string, isError = false): ToolResult => ({ content: [{ type: "text", text: value }], ...(isError ? { isError: true } : {}) });

function validPath(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_PATH || value.includes("\u0000")) throw new Error("path must be a non-empty path");
  return value;
}

function commandOutput(result: SandboxExecOutput): ToolResult {
  const parts = [
    result.stdout,
    result.stderr ? `${result.stdout ? "\n" : ""}[stderr]\n${result.stderr}` : "",
    result.truncated ? "\n[output shortened]" : "",
    result.timedOut ? "\n[stopped: time limit reached]" : "",
    `\n[exit ${result.exitCode ?? "unknown"}]`,
  ];
  return text(parts.join("").trimStart(), result.exitCode !== 0);
}

/** A public http(s) URL only; the host egress policy also blocks private
 * destinations, this check just fails fast with a clear message. */
export function browsableUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("url must be an http or https address");
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("url must be an http or https address");
  if (url.username || url.password) throw new Error("url must not carry credentials");
  return url.href;
}

const CHROMIUM = ["chromium", "--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run", "--hide-scrollbars", "--user-data-dir=/tmp/sagax-chromium"];

export async function callUserSandboxTool(name: string, args: Record<string, unknown>, exec: ToolExec): Promise<ToolResult> {
  try {
    if (name === "run_command") {
      const command = args.command;
      if (typeof command !== "string" || !command.trim() || command.length > 100_000) return text("command must be a non-empty string", true);
      const timeout = typeof args.timeout_seconds === "number" ? args.timeout_seconds : 120;
      return commandOutput(await exec.exec({ argv: ["bash", "-lc", command], timeoutSec: timeout }));
    }
    if (name === "read_file") {
      const path = validPath(args.path);
      const max = Math.min(1_000_000, Math.max(1, Math.floor(typeof args.max_bytes === "number" ? args.max_bytes : 200_000)));
      const result = await exec.exec({ argv: ["head", "-c", String(max), "--", path], timeoutSec: 30, maxOutputBytes: max + 1024 });
      if (result.exitCode !== 0) return text(result.stderr.trim() || `could not read ${path}`, true);
      return text(result.stdout);
    }
    if (name === "write_file") {
      const path = validPath(args.path);
      if (typeof args.content !== "string") return text("content must be a string", true);
      const bytes = Buffer.from(args.content, "utf8");
      if (bytes.length > MAX_WRITE_BYTES) return text("content is larger than 1 MiB; write it in parts or generate it with run_command", true);
      if (await exec.overQuota()) return text("Your server environment is over its disk quota. Delete files in /workspace first.", true);
      const result = await exec.exec({
        argv: ["sh", "-c", 'mkdir -p -- "$(dirname -- "$SAGAX_PATH")" && printf %s "$SAGAX_CONTENT_B64" | base64 -d > "$SAGAX_PATH"'],
        env: { SAGAX_PATH: path, SAGAX_CONTENT_B64: bytes.toString("base64") },
        timeoutSec: 30,
      });
      return result.exitCode === 0 ? text(`wrote ${bytes.length} bytes to ${path}`) : text(result.stderr.trim() || `could not write ${path}`, true);
    }
    if (name === "list_files") {
      const path = args.path === undefined ? "/workspace" : validPath(args.path);
      return commandOutput(await exec.exec({ argv: ["ls", "-la", "--", path], timeoutSec: 30 }));
    }
    if (name === "browse") {
      const url = browsableUrl(args.url);
      if (args.screenshot === true) {
        const result = await exec.exec({
          argv: ["sh", "-c", `${CHROMIUM.join(" ")} --window-size=1280,900 --screenshot=/tmp/sagax-shot.png "$SAGAX_URL" >/dev/null 2>&1; base64 -w0 /tmp/sagax-shot.png; rm -f /tmp/sagax-shot.png`],
          env: { SAGAX_URL: url },
          timeoutSec: 90,
          maxOutputBytes: 1024 * 1024,
        });
        const data = result.stdout.trim();
        if (result.exitCode !== 0 || !data || result.truncated) return text("The page could not be captured.", true);
        return { content: [{ type: "image", data, mimeType: "image/png" }, { type: "text", text: `screenshot of ${url}` }] };
      }
      const result = await exec.exec({ argv: [...CHROMIUM, "--dump-dom", url], timeoutSec: 90, maxOutputBytes: 512 * 1024 });
      if (result.exitCode !== 0) return text(`The page could not be opened.${result.stderr ? `\n${result.stderr.slice(0, 2000)}` : ""}`, true);
      return text(`${result.stdout}${result.truncated ? "\n[page shortened]" : ""}`);
    }
    return text(`unknown tool ${name}`, true);
  } catch (error) {
    return text(error instanceof Error ? error.message : String(error), true);
  }
}

/** One JSON-RPC MCP request from the proxy (tools/list or tools/call). */
export async function handleUserSandboxMcp(method: string, params: unknown, exec: ToolExec): Promise<unknown> {
  if (method === "tools/list") return { tools: USER_SANDBOX_TOOLS };
  if (method === "tools/call") {
    const call = (params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof call.name !== "string") throw Object.assign(new Error("tools/call needs a tool name"), { status: 400 });
    const args = call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments) ? call.arguments as Record<string, unknown> : {};
    return callUserSandboxTool(call.name, args, exec);
  }
  throw Object.assign(new Error("method not found"), { status: 404 });
}
