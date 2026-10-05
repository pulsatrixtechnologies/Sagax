// The tools a bot gets in a person's server environment: run a command,
// read, write and list files, open a web page in a headless browser, and use
// the environment's desktop (computer use: see the screen, click, type). Each
// call becomes one exec in that person's sandbox through the manager; nothing
// here touches the Sagax server's own filesystem or processes.
//
// Computer use has the desktop bridge's shape (server/desktop-bridge-tools.ts):
// computer_list_tools, then computer_use with one of SANDBOX_COMPUTER_TOOLS,
// the same vocabulary as a cloud computer (server/drivers/chat-boat-tools.ts).
// The desktop starts on the first such call (deploy/sandbox/sagax-desktop).
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
  {
    name: "computer_list_tools",
    description: "List the computer-use tools of the desktop in your server environment (see the screen, click, type, scroll). Use computer_use to call one. The person can watch this desktop live in Sagax.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "computer_use",
    description: "Call one computer-use tool on the desktop of your server environment (from computer_list_tools). Take a screenshot first, then act at its pixel coordinates.",
    inputSchema: {
      type: "object",
      properties: { tool_name: { type: "string" }, arguments: { type: "object" } },
      required: ["tool_name"],
      additionalProperties: false,
    },
  },
] as const;

const coordinate = { type: "integer", minimum: 0, maximum: 32767 };
const computerTool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []) =>
  ({ name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } });

/** The desktop's computer-use tools (1280x800, Chromium, a terminal and a
 * file manager from the right-click menu). */
export const SANDBOX_COMPUTER_TOOLS = [
  computerTool("screenshot", "See the desktop of the server environment (a JPEG at native resolution)."),
  computerTool("get_screen_size", "Get the desktop width and height."),
  computerTool("click", "Click a point on the desktop.", { x: coordinate, y: coordinate, button: { type: "string", enum: ["left", "middle", "right"] }, count: { type: "integer", minimum: 1, maximum: 3 } }, ["x", "y"]),
  computerTool("move", "Move the mouse pointer.", { x: coordinate, y: coordinate }, ["x", "y"]),
  computerTool("drag", "Drag with the left button.", { x: coordinate, y: coordinate, to_x: coordinate, to_y: coordinate }, ["x", "y", "to_x", "to_y"]),
  computerTool("type_text", "Type Unicode text into the focused application.", { text: { type: "string", maxLength: 4000 } }, ["text"]),
  computerTool("key_press", "Press an X11 key or shortcut (Return, ctrl+l, alt+Tab).", { key: { type: "string", pattern: "^[A-Za-z0-9_+]+$", minLength: 1, maxLength: 100 } }, ["key"]),
  computerTool("scroll", "Scroll at a point on the desktop.", { x: coordinate, y: coordinate, direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: { type: "integer", minimum: 1, maximum: 30 } }, ["x", "y", "direction"]),
  computerTool("open_url", "Open an http or https address in the desktop's Chromium; take a screenshot to see it loaded.", { url: { type: "string", pattern: "^https?://", maxLength: 2000 } }, ["url"]),
] as const;

export type UserSandboxToolName = (typeof USER_SANDBOX_TOOLS)[number]["name"];

const MAX_WRITE_BYTES = 1024 * 1024;
const MAX_PATH = 4096;

export interface ToolExec {
  exec(input: { argv: string[]; env?: Record<string, string>; timeoutSec?: number; maxOutputBytes?: number }): Promise<SandboxExecOutput>;
  overQuota(): Promise<boolean>;
  /** A refusal for a shell command, or null to run it (an admin who
   * manages this person's plugins and MCP servers: person-integrations.ts). */
  commandRefusal?(command: string): string | null;
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

const BUTTONS: Record<string, string> = { left: "1", middle: "2", right: "3" };
const SCROLL_BUTTONS: Record<string, string> = { up: "4", down: "5", left: "6", right: "7" };

function intArg(value: unknown, field: string, min: number, max: number, fallback?: number): string {
  if (value === undefined && fallback !== undefined) return String(fallback);
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${field} must be an integer from ${min} to ${max}`);
  return String(value);
}

/** One computer-use call as the exec it becomes: a fixed argv for
 * sagax-desktop, never a shell line; text and addresses travel in SAGAX_*
 * variables. Throws on bad arguments. */
export function sandboxComputerExec(name: string, args: Record<string, unknown>): { argv: string[]; env?: Record<string, string>; timeoutSec: number; maxOutputBytes?: number } {
  const point = () => [intArg(args.x, "x", 0, 32767), intArg(args.y, "y", 0, 32767)];
  switch (name) {
    case "screenshot":
      return { argv: ["sagax-desktop", "screenshot"], timeoutSec: 30, maxOutputBytes: 1024 * 1024 };
    case "get_screen_size":
      return { argv: ["sagax-desktop", "xdotool", "getdisplaygeometry"], timeoutSec: 30 };
    case "click": {
      const button = BUTTONS[String(args.button ?? "left")];
      if (!button) throw new Error("button must be left, middle or right");
      return { argv: ["sagax-desktop", "xdotool", "mousemove", "--sync", ...point(), "click", "--repeat", intArg(args.count, "count", 1, 3, 1), "--delay", "100", button], timeoutSec: 30 };
    }
    case "move":
      return { argv: ["sagax-desktop", "xdotool", "mousemove", "--sync", ...point()], timeoutSec: 30 };
    case "drag":
      return {
        argv: ["sagax-desktop", "xdotool", "mousemove", "--sync", ...point(), "mousedown", "1", "mousemove", "--sync",
          intArg(args.to_x, "to_x", 0, 32767), intArg(args.to_y, "to_y", 0, 32767), "mouseup", "1"],
        timeoutSec: 30,
      };
    case "type_text": {
      if (typeof args.text !== "string" || !args.text || args.text.length > 4000 || args.text.includes("\u0000")) throw new Error("text must be 1 to 4000 characters");
      return { argv: ["sagax-desktop", "type"], env: { SAGAX_TEXT: args.text }, timeoutSec: 120 };
    }
    case "key_press": {
      if (typeof args.key !== "string" || !/^[A-Za-z0-9_+]{1,100}$/.test(args.key)) throw new Error("key must be an X11 key name such as Return or ctrl+l");
      return { argv: ["sagax-desktop", "xdotool", "key", "--clearmodifiers", args.key], timeoutSec: 30 };
    }
    case "scroll": {
      const button = SCROLL_BUTTONS[String(args.direction)];
      if (!button) throw new Error("direction must be up, down, left or right");
      return { argv: ["sagax-desktop", "xdotool", "mousemove", "--sync", ...point(), "click", "--repeat", intArg(args.amount, "amount", 1, 30, 3), "--delay", "80", button], timeoutSec: 30 };
    }
    case "open_url":
      return { argv: ["sagax-desktop", "open-url"], env: { SAGAX_URL: browsableUrl(args.url) }, timeoutSec: 30 };
    default:
      throw new Error(`unknown computer-use tool ${name}; list them with computer_list_tools`);
  }
}

async function callSandboxComputerTool(name: string, args: Record<string, unknown>, exec: ToolExec): Promise<ToolResult> {
  const call = sandboxComputerExec(name, args);
  const result = await exec.exec(call);
  if (name === "screenshot") {
    const data = result.stdout.trim();
    if (result.exitCode !== 0 || !data || result.truncated || !/^[A-Za-z0-9+/=]+$/.test(data)) {
      return text(result.stderr.trim() || "The desktop could not be captured.", true);
    }
    return { content: [{ type: "image", data, mimeType: "image/jpeg" }] };
  }
  if (result.exitCode !== 0) return text(result.stderr.trim() || `${name} failed`, true);
  if (name === "get_screen_size") {
    const [width, height] = result.stdout.trim().split(/\s+/).map(Number);
    return text(JSON.stringify({ width, height }));
  }
  if (name === "open_url") return text("Opening the page in Chromium. Take a screenshot to see it loaded.");
  return text("done");
}

export async function callUserSandboxTool(name: string, args: Record<string, unknown>, exec: ToolExec): Promise<ToolResult> {
  try {
    if (name === "run_command") {
      const command = args.command;
      if (typeof command !== "string" || !command.trim() || command.length > 100_000) return text("command must be a non-empty string", true);
      const refused = exec.commandRefusal?.(command);
      if (refused) return text(refused, true);
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
    if (name === "computer_list_tools") return text(JSON.stringify({ tools: SANDBOX_COMPUTER_TOOLS }));
    if (name === "computer_use") {
      if (typeof args.tool_name !== "string" || !args.tool_name) return text("tool_name must name a tool from computer_list_tools", true);
      const toolArgs = args.arguments;
      if (toolArgs !== undefined && (!toolArgs || typeof toolArgs !== "object" || Array.isArray(toolArgs))) return text("arguments must be an object", true);
      return await callSandboxComputerTool(args.tool_name, (toolArgs ?? {}) as Record<string, unknown>, exec);
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
