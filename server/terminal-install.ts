import { readEnvName } from "../electron/legacy-names.mjs";
import { augmentedPath } from "./env-path.ts";
import { prepareVpsSsh } from "./vps-ssh.ts";
import { isValidSshAlias, type AppConfig } from "./config.ts";
import { createTerminalAuditLog } from "./terminal-audit.ts";
import { TerminalResourceRegistry } from "./terminal-resources/registry.ts";
import { testTerminalAdapter } from "./terminal-resources/adapters/test.ts";
import { createSshAliasAdapter, type SshAliasTerminalHost } from "./terminal-resources/adapters/ssh-alias.ts";
import { createTerminalSessionManager } from "./terminal-sessions.ts";
import { createTerminalRequestService } from "./terminal-requests.ts";
import { createTerminalRoutes } from "./routes/terminal.ts";
import { createTerminalInternalRoutes } from "./routes/terminal-internal.ts";
import type { Store } from "./store.ts";
import type { RequestAuth } from "./request-auth.ts";
import type { IncomingMessage } from "node:http";
import type { RouteHandler } from "./routes/table.ts";

export interface TerminalFeature {
  registry: TerminalResourceRegistry;
  sessions: ReturnType<typeof createTerminalSessionManager>;
  requests: ReturnType<typeof createTerminalRequestService>;
  wire(
    routes: RouteHandler[],
    options: {
      upgrade(req: IncomingMessage): { socket: import("node:net").Socket; head: Buffer; release(): void } | undefined;
      live(auth: RequestAuth): boolean;
    },
  ): void;
}

function sshArgv(dataDir: string, alias: string) {
  const ssh = prepareVpsSsh(dataDir, augmentedPath());
  const args = ["-tt", alias];
  if (ssh.configPath) args.unshift("-F", ssh.configPath);
  return { command: "ssh", args, env: { ...process.env, PATH: ssh.path } };
}

function configuredHosts(cfg: AppConfig): { ssh: SshAliasTerminalHost[]; unraid: SshAliasTerminalHost[] } {
  const ssh: SshAliasTerminalHost[] = [];
  const unraid: SshAliasTerminalHost[] = [];
  const raw = cfg.terminalShell?.hosts;
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const id = String((entry as { id?: unknown }).id ?? "").trim();
      const alias = String((entry as { alias?: unknown }).alias ?? "").trim();
      const label = String((entry as { label?: unknown }).label ?? id).trim();
      const hostLabel = String((entry as { hostLabel?: unknown }).hostLabel ?? alias).trim();
      const provider = String((entry as { provider?: unknown }).provider ?? "ssh").trim();
      if (!id || !isValidSshAlias(alias)) continue;
      const host = { id, alias, label, hostLabel };
      if (provider === "unraid") unraid.push(host);
      else ssh.push(host);
    }
  }
  const unraidAlias = readEnvName("SAGAX_UNRAID_SSH_ALIAS") || cfg.terminalShell?.unraidSshAlias;
  if (isValidSshAlias(unraidAlias) && !unraid.some((host) => host.alias === unraidAlias)) {
    unraid.push({
      id: "default",
      alias: unraidAlias,
      label: "Serveur unRAID",
      hostLabel: unraidAlias,
    });
  }
  const vpsAlias = cfg.vps?.sshAlias;
  if (isValidSshAlias(vpsAlias)) {
    ssh.push({
      id: `vps:${vpsAlias}`,
      alias: vpsAlias,
      label: "Serveur distant",
      hostLabel: vpsAlias,
    });
  }
  return { ssh, unraid };
}

export function installTerminalFeature(deps: {
  dataDir: string;
  store: Store;
  cfg: () => AppConfig;
  principalId: (auth: RequestAuth) => string | undefined;
  now?: () => number;
}): TerminalFeature {
  const now = deps.now ?? (() => Date.now());
  const audit = createTerminalAuditLog(deps.dataDir);
  const registry = new TerminalResourceRegistry();
  if (process.env.VITEST === "true" || process.env.SAGAX_TERMINAL_TEST === "1") {
    registry.register(testTerminalAdapter);
  }
  const hosts = () => configuredHosts(deps.cfg());
  registry.register(createSshAliasAdapter("ssh", () => hosts().ssh, (alias) => sshArgv(deps.dataDir, alias)));
  registry.register(createSshAliasAdapter("unraid", () => hosts().unraid, (alias) => sshArgv(deps.dataDir, alias)));

  const sessions = createTerminalSessionManager({ registry, audit, now });
  const requests = createTerminalRequestService({
    store: deps.store,
    registry,
    sessions,
    principalId: deps.principalId,
    audit,
    now,
  });

  const routeDeps = {
    registry,
    sessions,
    principalId: deps.principalId,
  };

  return {
    registry,
    sessions,
    requests,
    wire(routes, options) {
      routes.push(createTerminalRoutes({ ...routeDeps, upgrade: options.upgrade, live: options.live }));
      routes.push(createTerminalInternalRoutes({ requests, registry, principalId: deps.principalId }));
    },
  };
}
