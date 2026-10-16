import { isValidSshAlias } from "../../config.ts";
import { spawnScriptPty } from "../../../electron/script-pty.mjs";
import type { TerminalAttachment, TerminalListContext, TerminalOpenContext, TerminalResourceAdapter } from "../types.ts";

export interface SshAliasTerminalHost {
  id: string;
  label: string;
  hostLabel: string;
  alias: string;
}

/** A host of the server reached by its SSH alias (config.json). A server
 * resource: an organization admin's only (registry.ts). `ssh -t` runs in a
 * local terminal (electron/script-pty.mjs) so the remote one follows the
 * widget's size. */
export function createSshAliasAdapter(
  kind: "ssh" | "unraid",
  hosts: () => readonly SshAliasTerminalHost[],
  sshArgv: (alias: string) => { command: string; args: string[]; env: NodeJS.ProcessEnv },
): TerminalResourceAdapter {
  const row = (host: SshAliasTerminalHost) => ({
    id: host.id,
    provider: kind,
    label: host.label,
    hostLabel: host.hostLabel,
    status: "unknown" as const,
    scope: "server" as const,
  });
  return {
    kind,
    async list(_ctx: TerminalListContext) {
      return hosts().filter((host) => isValidSshAlias(host.alias)).map(row);
    },
    async resolve(resourceId, _ctx) {
      const host = hosts().find((item) => item.id === resourceId);
      if (!host || !isValidSshAlias(host.alias)) return null;
      return row(host);
    },
    async open(resourceId, ctx: TerminalOpenContext): Promise<TerminalAttachment> {
      const host = hosts().find((item) => item.id === resourceId);
      if (!host || !isValidSshAlias(host.alias)) throw new Error("Resource unavailable");
      const { command, args, env } = sshArgv(host.alias);
      return spawnScriptPty([command, ...args], { cols: ctx.cols, rows: ctx.rows, env });
    },
  };
}
