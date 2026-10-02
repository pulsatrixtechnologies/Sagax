// Per-turn MCP entry point for a person's server environment
// ("sagax-environment"). Only a turn-scoped capability crosses into the agent
// process; the provisioner address and its key stay in the Sagax server, which
// runs the call in the sandbox of the person the turn's capability names
// (the speaker, or the bot owner for routines).
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 2_097_152;
const MAX_OUTPUT_BYTES = 16_777_216;
const MAX_PENDING = 8;
type RpcId = string | number | null;

function failure(id: RpcId, method: unknown, message: string, code = -32603): unknown {
  return method === "tools/call"
    ? { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: message }], isError: true } }
    : { jsonrpc: "2.0", id, error: { code, message } };
}

export async function userSandboxProxyRequest(frame: unknown, connection: { url: string; token: string }, fetchImpl: typeof fetch = fetch): Promise<unknown | undefined> {
  if (!frame || typeof frame !== "object" || Array.isArray(frame)) return failure(null, null, "Invalid request.", -32600);
  const message = frame as { id?: RpcId; jsonrpc?: unknown; method?: unknown; params?: unknown };
  const id = message.id ?? null;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string" || (id !== null && typeof id !== "number" && typeof id !== "string")) return failure(null, null, "Invalid request.", -32600);
  if (!Object.hasOwn(message, "id")) return undefined;
  if (message.method === "initialize") return {
    jsonrpc: "2.0", id,
    result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "sagax-environment", version: "1" } },
  };
  if (message.method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (message.method !== "tools/list" && message.method !== "tools/call") return failure(id, message.method, "Method not found.", -32601);
  try {
    const url = new URL(connection.url);
    if (!connection.token || url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("The server environment is not connected. Start a new bot turn from Sagax.");
    }
    const body = JSON.stringify({ method: message.method, params: message.params ?? {} });
    if (Buffer.byteLength(body) > MAX_INPUT_BYTES) throw new Error("The request exceeded the size limit.");
    const response = await fetchImpl(new URL("/api/internal/sandbox/mcp", url), {
      method: "POST", redirect: "error",
      headers: { "content-type": "application/json", authorization: `Bearer ${connection.token}` },
      body, signal: AbortSignal.timeout(720_000),
    });
    const payload = await response.json().catch(() => null) as { result?: unknown; error?: unknown } | null;
    if (!response.ok || !payload || !Object.hasOwn(payload, "result")) {
      throw new Error(typeof payload?.error === "string" ? payload.error.slice(0, 2_000) : "The server environment is unavailable. Try again in a moment.");
    }
    return { jsonrpc: "2.0", id, result: payload.result };
  } catch (error) {
    const detail = error instanceof Error && !/fetch failed|abort|timeout/i.test(error.message)
      ? error.message : "The connection to the server environment was interrupted. Check the result before repeating the action.";
    return failure(id, message.method, detail);
  }
}

function run(): void {
  const connection = { url: process.env.SAGAX_HARNESS_URL ?? "", token: process.env.SAGAX_SANDBOX_TOKEN ?? "" };
  let input = Buffer.alloc(0);
  let pending = 0;
  const output = (message: unknown) => {
    if (message === undefined) return;
    const line = `${JSON.stringify(message)}\n`;
    if (Buffer.byteLength(line) > MAX_OUTPUT_BYTES) { process.stdin.destroy(); process.exitCode = 1; return; }
    process.stdout.write(line);
  };
  process.stdout.on("error", () => { process.stdin.destroy(); process.exitCode = 1; });
  process.stdin.on("data", (chunk: Buffer) => {
    input = Buffer.concat([input, chunk]);
    let newline: number;
    while ((newline = input.indexOf(10)) !== -1) {
      if (newline > MAX_INPUT_BYTES) { process.stdin.destroy(); process.exitCode = 1; return; }
      const line = input.subarray(0, newline).toString("utf8");
      input = input.subarray(newline + 1);
      if (!line.trim()) continue;
      let frame: unknown;
      try { frame = JSON.parse(line); } catch { output(failure(null, null, "Parse error.", -32700)); continue; }
      if (pending >= MAX_PENDING) {
        const request = frame as { id?: RpcId; method?: unknown } | null;
        if (request && Object.hasOwn(request, "id")) output(failure(request.id ?? null, request.method, "Too many pending requests."));
        continue;
      }
      pending++;
      void userSandboxProxyRequest(frame, connection).then(output).finally(() => { pending--; });
    }
    if (input.length > MAX_INPUT_BYTES) { process.stdin.destroy(); process.exitCode = 1; }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run();
