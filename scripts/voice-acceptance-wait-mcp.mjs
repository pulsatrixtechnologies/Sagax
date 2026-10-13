#!/usr/bin/env node
// Tiny MCP server for the live duplex acceptance call: one `wait` tool so
// topic A stays botBusy long enough for B/C to fork (issue #292 / Review 3).
// Parallel A/B/C waits share this stdio: sleep concurrently, write replies
// one JSON-RPC line at a time so stdout never interleaves.
import { createInterface } from "node:readline";

let writeChain = Promise.resolve();
function reply(id, payload) {
  writeChain = writeChain.then(() => new Promise((resolve) => {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...payload })}\n`, () => resolve());
  }));
  return writeChain;
}

const lines = createInterface({ input: process.stdin });
lines.on("line", async (line) => {
  let request;
  try { request = JSON.parse(line); } catch { return; }
  if (request.id === undefined) return;
  if (request.method === "initialize") {
    await reply(request.id, { result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "wait", version: "1" } } });
    return;
  }
  if (request.method === "tools/list") {
    await reply(request.id, { result: {
      tools: [{
        name: "wait",
        description: "Wait for N seconds before returning. Use this when the person asks you to wait, then answer.",
        inputSchema: {
          type: "object",
          properties: { seconds: { type: "number", description: "How many seconds to wait" } },
          required: ["seconds"],
          additionalProperties: false,
        },
      }],
    } });
    return;
  }
  if (request.method === "tools/call" && request.params?.name === "wait") {
    const raw = request.params.arguments;
    const args = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
    const seconds = Math.min(60, Math.max(1, Number(args.seconds ?? args.duration) || 12));
    process.stderr.write(`[wait-mcp] sleep ${seconds} id=${request.id}\n`);
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    await reply(request.id, { result: { content: [{ type: "text", text: `waited ${seconds} seconds` }] } });
    return;
  }
  await reply(request.id, { error: { code: -32601, message: "Method not found" } });
});
