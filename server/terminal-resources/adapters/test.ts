import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";

import type { TerminalResource } from "../../../shared/terminal-resources.ts";
import type { TerminalAttachment, TerminalOpenContext, TerminalResourceAdapter } from "../types.ts";

const RESOURCE: TerminalResource = {
  id: "echo",
  provider: "test",
  label: "Bac à sable",
  hostLabel: "test-echo",
  status: "online",
};

/** Deterministic shell for vitest: echoes lines prefixed with `$ `. */
export const testTerminalAdapter: TerminalResourceAdapter = {
  kind: "test",
  async list() {
    return [RESOURCE];
  },
  async resolve(resourceId) {
    return resourceId === RESOURCE.id ? { ...RESOURCE } : null;
  },
  async open(resourceId, _ctx: TerminalOpenContext): Promise<TerminalAttachment> {
    if (resourceId !== RESOURCE.id) throw new Error("unknown test resource");
    const input = new PassThrough();
    const output = new PassThrough();
    const proc = spawn(process.execPath, ["-e", `
      const readline = require("node:readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
      process.stdout.write("Sagax terminal test. Type quit to leave.\\r\\n");
      rl.on("line", (line) => {
        if (line.trim() === "quit") process.exit(0);
        process.stdout.write("$ " + line + "\\r\\n");
      });
    `], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, TERM: "xterm-256color" } });
    proc.stdout.on("data", (chunk) => output.write(chunk));
    proc.stderr.on("data", (chunk) => output.write(chunk));
    input.on("data", (chunk) => proc.stdin.write(chunk));
    proc.on("close", () => {
      output.end();
      input.end();
    });
    return {
      input,
      output,
      proc,
      resize() { /* no-op in test */ },
      close() {
        proc.kill("SIGTERM");
        input.destroy();
        output.destroy();
      },
    };
  },
};
