import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";

import type { TerminalProviderKind, TerminalResource, TerminalResourceScope } from "../../../shared/terminal-resources.ts";
import type { TerminalAttachment, TerminalOpenContext, TerminalResourceAdapter } from "../types.ts";

/** Deterministic shell for vitest: echoes lines prefixed with `$ `, and
 * answers `size` with the last size it was given. */
export function createTestTerminalAdapter(options: {
  kind?: TerminalProviderKind;
  id?: string;
  label?: string;
  scope?: TerminalResourceScope;
  /** Every open and resize, for assertions. */
  calls?: { opened: TerminalOpenContext[]; resized: { cols: number; rows: number }[] };
} = {}): TerminalResourceAdapter {
  const resource: TerminalResource = {
    id: options.id ?? "echo",
    provider: options.kind ?? "test",
    label: options.label ?? "Bac à sable",
    hostLabel: "test-echo",
    status: "online",
    scope: options.scope ?? "server",
  };
  return {
    kind: resource.provider,
    async list() {
      return [{ ...resource }];
    },
    async resolve(resourceId) {
      return resourceId === resource.id ? { ...resource } : null;
    },
    async open(resourceId, ctx: TerminalOpenContext): Promise<TerminalAttachment> {
      if (resourceId !== resource.id) throw new Error("unknown test resource");
      options.calls?.opened.push(ctx);
      const input = new PassThrough();
      const output = new PassThrough();
      const proc = spawn(process.execPath, ["-e", `
        const readline = require("node:readline");
        let size = "${ctx.cols}x${ctx.rows}";
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
        process.stdout.write("Sagax terminal test. Type quit to leave.\\r\\n");
        rl.on("line", (line) => {
          if (line.startsWith("\\u0000size ")) { size = line.slice(6); return; }
          if (line.trim() === "quit") process.exit(0);
          if (line.trim() === "size") { process.stdout.write("size " + size + "\\r\\n"); return; }
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
        resize(cols, rows) {
          options.calls?.resized.push({ cols, rows });
          proc.stdin.write(`\u0000size ${cols}x${rows}\n`);
        },
        close() {
          proc.kill("SIGTERM");
          input.destroy();
          output.destroy();
        },
      };
    },
  };
}

/** The default test shell: a server resource with id "echo". */
export const testTerminalAdapter: TerminalResourceAdapter = createTestTerminalAdapter();
