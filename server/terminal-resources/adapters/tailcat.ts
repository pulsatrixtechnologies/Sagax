// A shell on the end user's computer through the Tailcat tunnel that already
// lives on this host (the session folder). The address is an argv element
// and is never returned to the client.
import { spawnScriptPty } from "../../../electron/script-pty.mjs";
import type { TerminalResource } from "../../../shared/terminal-resources.ts";
import type { TerminalAttachment, TerminalListContext, TerminalOpenContext, TerminalResourceAdapter } from "../types.ts";
import { readTunnel, tailcatPtyArgv } from "../../remote-session-probe.ts";
import { resolveTailcatBinary } from "../../tailcat-bin.ts";

export interface TailcatTerminalTarget {
  id: string;
  hostLabel: string;
  label: string;
}

export function createTailcatAdapter(deps: {
  home(): string;
  /** The folder of sessions Sagax opened itself (remote-support-local.ts). */
  supportDir?(): string;
  /** Connected sessions this person may open for this bot. */
  targets(principalId: string, botId: string | undefined): TailcatTerminalTarget[];
}): TerminalResourceAdapter {
  const row = (target: TailcatTerminalTarget): TerminalResource => ({
    id: target.id,
    provider: "tailcat",
    label: target.label,
    hostLabel: target.hostLabel,
    status: "online",
    scope: "personal",
  });
  const find = (resourceId: string, ctx: TerminalListContext) =>
    deps.targets(ctx.principalId, ctx.botId).find((target) => target.id === resourceId) ?? null;

  return {
    kind: "tailcat",
    async list(ctx) {
      return deps.targets(ctx.principalId, ctx.botId)
        .filter((target) => readTunnel(deps.home(), target.id, deps.supportDir?.()))
        .map(row);
    },
    async resolve(resourceId, ctx) {
      const target = find(resourceId, ctx);
      if (!target || !readTunnel(deps.home(), target.id, deps.supportDir?.())) return null;
      return row(target);
    },
    async open(resourceId, ctx: TerminalOpenContext): Promise<TerminalAttachment> {
      const target = find(resourceId, ctx);
      const tunnel = target ? readTunnel(deps.home(), target.id, deps.supportDir?.()) : null;
      if (!tunnel) throw new Error("This remote computer is not connected from here.");
      try {
        const bin = resolveTailcatBinary() ?? "tailcat";
        return spawnScriptPty(tailcatPtyArgv(bin, tunnel.keyPath, tunnel.address), {
          cols: ctx.cols,
          rows: ctx.rows,
        });
      } catch {
        throw new Error("This remote computer did not open a shell.");
      }
    },
  };
}
