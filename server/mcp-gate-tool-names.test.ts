// The gate as a real process in front of a connector whose tool names Grok
// cannot qualify. This is the CI parity check: every tool the server
// advertises must come out under exactly one name Grok admits, and calling
// that name must run the server's own tool. A mismatch fails the build.
// Regression: 2026-10-11, Perspicax profile perspicax_profil_jean_christophe_limited
// lost cw_psa__query, cw_psa__write and cw_psa__action on every bot on Grok.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { gateServer } from "./mcp-gate-config.ts";
import { removeTempDir } from "./testing/cleanup.ts";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "mcp-gate.ts");
const SERVER = "perspicax_profil_jean_christophe_limited";

/** The catalog a hostile-but-legal MCP server may advertise. */
const ADVERTISED = [
  "memory_search", "api_search", "cw_psa__query", "cw_psa__write", "cw_psa__action",
  "files.read", "files-read", "ns:do", "_private", "with-dash", "a___b", "2fa_enable",
  `${"long".repeat(60)}__end`, `${"long".repeat(60)}__other`, "cw_psa_query",
];

const UPSTREAM = `
const { createInterface } = require("node:readline");
const names = JSON.parse(process.env.NAMES);
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "tools/list") return send(msg.id, { tools: names.map((name) => ({ name, description: "upstream " + name, inputSchema: { type: "object" } })) });
  if (msg.method === "tools/call") {
    if (!names.includes(msg.params.name)) return process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32602, message: "Tool not found: " + msg.params.name } }) + "\\n");
    return send(msg.id, { content: [{ type: "text", text: "ran " + msg.params.name }] });
  }
  send(msg.id, {});
});
`;

/** Grok's documented admission rule (07-mcp-servers.md), independent of the code. */
const grokAdmits = (tool: string) => {
  const key = `${SERVER}__${tool}`;
  return /^[A-Za-z0-9_-]+$/.test(tool) && key.split("__").length === 2 && !key.includes("___") && key.length <= 256;
};

describe("mcp-gate tool names for Grok", () => {
  let scratch: string;
  let gate: ChildProcessWithoutNullStreams | undefined;
  let stderr = "";

  afterEach(async () => {
    if (gate && gate.exitCode === null && gate.signalCode === null) {
      const closed = once(gate, "close");
      gate.kill();
      await closed;
    }
    gate = undefined;
    await removeTempDir(scratch);
  });

  const startGate = (names: string[]) => {
    scratch = mkdtempSync(join(tmpdir(), "omb-gate-names-"));
    const upstream = join(scratch, "upstream.cjs");
    writeFileSync(upstream, UPSTREAM);
    gate = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", GATE], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        SAGAX_GATE_NAME: SERVER,
        SAGAX_GATE_BUDGET: "0",
        SAGAX_GATE_TOOL_NAMES: "grok",
        SAGAX_GATE_REPORT_DIR: join(scratch, "reports"),
        SAGAX_GATE_UPSTREAM: JSON.stringify({ command: process.execPath, args: [upstream], env: { NAMES: JSON.stringify(names) } }),
      },
    }) as ChildProcessWithoutNullStreams;
    gate.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const pending: Array<(line: string) => void> = [];
    createInterface({ input: gate.stdout }).on("line", (line) => pending.shift()?.(line));
    return (message: unknown) => new Promise<Record<string, any>>((resolve) => {
      pending.push((line) => resolve(JSON.parse(line)));
      gate!.stdin.write(`${JSON.stringify(message)}\n`);
    });
  };

  it("registers cw_psa__query from perspicax_profil_jean_christophe_limited and calls it through the map", async () => {
    const rpc = startGate(["memory_search", "cw_psa__query"]);
    const listed = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toEqual(["memory_search", "cw_psa_query"]);
    const called = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "cw_psa_query", arguments: {} } });
    expect(called.result.content[0].text).toBe("ran cw_psa__query");
    expect(stderr).toContain(`WARNING tool "cw_psa__query" is registered for Grok as "cw_psa_query"`);
    const report = JSON.parse(readFileSync(join(scratch, "reports", `${SERVER}.json`), "utf8"));
    expect(report).toMatchObject({ server: SERVER, engine: "grok", advertised: 2, registered: 2, status: "renamed", parity: [], unregistrable: [] });
  });

  it("parity: every advertised tool is registered once, admissible, and callable", async () => {
    const rpc = startGate(ADVERTISED);
    const listed = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const registered: string[] = listed.result.tools.map((tool: { name: string }) => tool.name);
    expect(registered).toHaveLength(ADVERTISED.length);
    expect(new Set(registered).size).toBe(ADVERTISED.length);
    for (const name of registered) expect(grokAdmits(name), name).toBe(true);
    const ran = new Set<string>();
    for (const [index, name] of registered.entries()) {
      const called = await rpc({ jsonrpc: "2.0", id: 10 + index, method: "tools/call", params: { name, arguments: {} } });
      ran.add(String(called.result?.content?.[0]?.text).replace(/^ran /, ""));
    }
    expect([...ran].sort()).toEqual([...ADVERTISED].sort());
    const report = JSON.parse(readFileSync(join(scratch, "reports", `${SERVER}.json`), "utf8"));
    expect(report.status).toBe("renamed");
    expect(report.parity).toEqual([]);
    expect(report.unregistrable).toEqual([]);
  });

  it("gateServer mounts a URL-less, unscoped server through the gate when the engine needs tool names", () => {
    const gated = gateServer({ name: SERVER, server: { command: "node", args: ["x.js"] }, threadId: "t", budget: 0, toolNames: "grok" });
    expect(gated?.env.SAGAX_GATE_TOOL_NAMES).toBe("grok");
    expect(gated?.env.SAGAX_GATE_REPORT_DIR).toMatch(/mcp-tool-names$/);
    expect(gateServer({ name: SERVER, server: { command: "node", args: ["x.js"] }, threadId: "t", budget: 0 })).toBeNull();
  });
});
