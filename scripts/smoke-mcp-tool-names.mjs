#!/usr/bin/env node
// Post-deploy smoke: the deployed MCP gate registers every connector tool
// under a name Grok admits and maps each call back to the server's own tool.
// Self-contained (no repo files needed), so it runs inside the server image:
//
//   docker exec -i -e SMOKE_GATE=/app/dist-server/mcp-gate.js pulsatrix-pulsabot-1 node - < scripts/smoke-mcp-tool-names.mjs
//
// Dev tree: `node scripts/smoke-mcp-tool-names.mjs` (uses server/mcp-gate.ts).
// Exit 0 = parity; anything else prints the mismatch and exits 1.
// The live half (a bot on Grok calling cw_psa__query read-only and listing each
// connector's tools) is in docs/mcp-tool-names.md.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const SERVER = "perspicax_profil_ottoline_limited";
const ADVERTISED = ["memory_search", "api_search", "cw_psa__query", "cw_psa__write", "cw_psa__action",
  "files.read", "ns:do", "_private", "with-dash", `${"long".repeat(60)}__end`, "cw_psa_query"];
const candidates = [process.env.SMOKE_GATE, "/app/dist-server/mcp-gate.js", join(process.cwd(), "dist-server/mcp-gate.js"), join(process.cwd(), "server/mcp-gate.ts")].filter(Boolean);
const gatePath = candidates.find((path) => existsSync(path));
if (!gatePath) { console.error("smoke: no mcp-gate found (set SMOKE_GATE)"); process.exit(1); }

const grokAdmits = (tool) => {
  const key = `${SERVER}__${tool}`;
  return /^[A-Za-z0-9_-]+$/.test(tool) && key.split("__").length === 2 && !key.includes("___") && key.length <= 256;
};

const dir = mkdtempSync(join(tmpdir(), "sagax-smoke-names-"));
const upstream = join(dir, "upstream.cjs");
writeFileSync(upstream, `
const { createInterface } = require("node:readline");
const names = JSON.parse(process.env.NAMES);
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "tools/list") return out({ jsonrpc: "2.0", id: msg.id, result: { tools: names.map((name) => ({ name, inputSchema: { type: "object" } })) } });
  if (msg.method === "tools/call") return names.includes(msg.params.name)
    ? out({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "ran " + msg.params.name }] } })
    : out({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "Tool not found: " + msg.params.name } });
  out({ jsonrpc: "2.0", id: msg.id, result: {} });
});`);
const gate = spawn(process.execPath, [...(gatePath.endsWith(".ts") ? ["--experimental-strip-types", "--no-warnings"] : []), gatePath], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1", SAGAX_GATE_NAME: SERVER, SAGAX_GATE_BUDGET: "0", SAGAX_GATE_TOOL_NAMES: "grok",
    SAGAX_GATE_REPORT_DIR: join(dir, "reports"),
    SAGAX_GATE_UPSTREAM: JSON.stringify({ command: process.execPath, args: [upstream], env: { NAMES: JSON.stringify(ADVERTISED) } }) },
});
let stderr = "";
gate.stderr.on("data", (chunk) => { stderr += chunk; });
const waiting = [];
createInterface({ input: gate.stdout }).on("line", (line) => waiting.shift()?.(JSON.parse(line)));
const rpc = (message) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`no answer to ${message.method}`)), 10_000);
  waiting.push((reply) => { clearTimeout(timer); resolve(reply); });
  gate.stdin.write(JSON.stringify(message) + "\n");
});

const problems = [];
try {
  const listed = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const registered = (listed.result?.tools ?? []).map((tool) => tool.name);
  if (registered.length !== ADVERTISED.length) problems.push(`advertised ${ADVERTISED.length}, registered ${registered.length}`);
  if (new Set(registered).size !== registered.length) problems.push("two tools share a registered name");
  for (const name of registered) if (!grokAdmits(name)) problems.push(`Grok would skip ${SERVER}__${name}`);
  const ran = [];
  for (const [i, name] of registered.entries()) {
    const reply = await rpc({ jsonrpc: "2.0", id: 10 + i, method: "tools/call", params: { name, arguments: {} } });
    const text = reply.result?.content?.[0]?.text;
    if (!text) problems.push(`calling ${name} failed: ${JSON.stringify(reply.error ?? reply)}`);
    else ran.push(text.replace(/^ran /, ""));
  }
  const missing = ADVERTISED.filter((name) => !ran.includes(name));
  if (missing.length) problems.push(`not callable: ${missing.join(", ")}`);
  const query = registered[ADVERTISED.indexOf("cw_psa__query")];
  console.log(`smoke: gate ${gatePath}`);
  console.log(`smoke: cw_psa__query registered as ${SERVER}__${query}`);
  const report = JSON.parse(readFileSync(join(dir, "reports", `${SERVER}.json`), "utf8"));
  if (report.status === "mismatch") problems.push(`report says mismatch: ${JSON.stringify(report.parity)}`);
} catch (error) {
  problems.push(String(error));
} finally {
  gate.kill();
  rmSync(dir, { recursive: true, force: true });
}
if (problems.length) {
  console.error(`smoke: FAIL\n- ${problems.join("\n- ")}\n${stderr}`);
  process.exit(1);
}
console.log(`smoke: OK, ${ADVERTISED.length}/${ADVERTISED.length} tools registered, admissible and callable`);
