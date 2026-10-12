import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";

import { isValidSshAlias } from "../../config.ts";
import type { TerminalAttachment, TerminalListContext, TerminalOpenContext, TerminalResourceAdapter } from "../types.ts";

export interface SshAliasTerminalHost {
  id: string;
  label: string;
  hostLabel: string;
  alias: string;
}

export function createSshAliasAdapter(
  kind: "ssh" | "unraid",
  hosts: () => readonly SshAliasTerminalHost[],
  sshArgv: (alias: string) => { command: string; args: string[]; env: NodeJS.ProcessEnv },
): TerminalResourceAdapter {
  return {
    kind,
    async list(_ctx: TerminalListContext) {
      return hosts().map((host) => ({
        id: host.id,
        provider: kind,
        label: host.label,
        hostLabel: host.hostLabel,
        status: "unknown" as const,
      }));
    },
    async resolve(resourceId, _ctx) {
      const host = hosts().find((item) => item.id === resourceId);
      if (!host || !isValidSshAlias(host.alias)) return null;
      return {
        id: host.id,
        provider: kind,
        label: host.label,
        hostLabel: host.hostLabel,
        status: "unknown",
      };
    },
    async open(resourceId, _ctx: TerminalOpenContext): Promise<TerminalAttachment> {
      const host = hosts().find((item) => item.id === resourceId);
      if (!host || !isValidSshAlias(host.alias)) throw new Error("Resource unavailable");
      const { command, args, env } = sshArgv(host.alias);
      const input = new PassThrough();
      const output = new PassThrough();
      const proc = spawn(command, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env,
      });
      proc.stdout.on("data", (chunk) => output.write(chunk));
      proc.stderr.on("data", (chunk) => output.write(chunk));
      input.on("data", (chunk) => proc.stdin.write(chunk));
      proc.on("close", () => {
        output.end();
        input.destroy();
      });
      return {
        input,
        output,
        proc,
        resize(cols, rows) {
          proc.stdin.write(`\x1b[8;${rows};${cols}t`);
        },
        close() {
          proc.kill("SIGTERM");
          setTimeout(() => proc.kill("SIGKILL"), 2_000).unref();
          input.destroy();
          output.destroy();
        },
      };
    },
  };
}
