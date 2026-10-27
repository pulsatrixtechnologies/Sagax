// Command variables (2026-10-26): an API key of the vault the person chose,
// per key, to expose to their allowed bots' commands under a name they typed
// (CredentialVault.commandVariables). It is the person's choice in their own
// environment: the bot can read the variable in its shell, and Settings >
// Credentials says so on the key's row. Read again for every command, so a
// change or a revoke holds at the next command.
//
// Two places a bot's commands run get them:
//   - the person's server environment (organization server, run_command of
//     sagax-environment): the sandbox takes only SAGAX_* variables, so the
//     values ride SAGAX_CMDVAR_<n> and a fixed prelude, made of the names
//     only, exports each under its chosen name and unsets the carrier. The
//     values are never on the command line.
//   - the engine's own shell on this computer (Claude Code's Bash): the turn's
//     `commandEnvironment` joins the engine process's environment
//     (server/drivers/claude.ts), and a change starts a fresh process.
import { createHash } from "node:crypto";

import { parseCommandVariable } from "../shared/credential-vault.ts";

export interface SandboxExecLike {
  argv: string[];
  env?: Record<string, string>;
}

const CARRIER = "SAGAX_CMDVAR_";

/** Only names the vault accepts, never more than 16. */
export function cleanCommandVariables(vars: Record<string, string> | null | undefined): Array<[string, string]> {
  return Object.entries(vars ?? {})
    .filter(([name, value]) => typeof parseCommandVariable(name) === "string" && parseCommandVariable(name) === name && typeof value === "string" && value.length > 0 && !value.includes("\u0000"))
    .slice(0, 16);
}

/** A shell command of the person's server environment (`bash -lc <command>`)
 * with the variables exported first. Any other exec is left as it is. */
export function withCommandVariables<T extends SandboxExecLike>(input: T, vars: Record<string, string> | null | undefined): T & { env?: Record<string, string> } {
  const entries = cleanCommandVariables(vars);
  if (!entries.length) return input;
  const [shell, flag, command] = input.argv;
  if (input.argv.length !== 3 || shell !== "bash" || flag !== "-lc" || typeof command !== "string") return input;
  const env: Record<string, string> = { ...input.env };
  const prelude: string[] = [];
  entries.forEach(([name, value], index) => {
    env[`${CARRIER}${index}`] = value;
    prelude.push(`export ${name}="$${CARRIER}${index}"; unset ${CARRIER}${index};`);
  });
  return { ...input, env, argv: [shell, flag, `${prelude.join(" ")}\n${command}`] };
}

/** What a process contract keeps of the variables: a digest, never a value. */
export function commandVariablesDigest(vars: Record<string, string> | null | undefined): string | null {
  const entries = cleanCommandVariables(vars).sort(([left], [right]) => left.localeCompare(right));
  if (!entries.length) return null;
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}
