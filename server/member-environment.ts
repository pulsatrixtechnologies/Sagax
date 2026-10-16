// A bot's commands in its owner's own isolated environment (JC, 2026-10-16).
//
// On an organization server a person's bots work in that person's own
// environment: their server environment (one isolated Linux sandbox per
// person, `sagax-environment`, docs/user-sandbox.md) or the Local VM on
// their own computer (the `local_vm` tool of `sagax-desktop`). Nothing there
// reaches the Sagax server or anyone else's space: the sandbox has no
// capabilities, no host mount and no private-network egress, and the Local
// VM is a VM on the person's own machine.
//
// So a call of one of those tools, made by a bot for the person who owns it
// in that person's own environment, is the owner's own work. While the
// organization allows it (`organization.memberEnvironmentAutonomy`, absent
// means on) it runs without a card, as Full access would, but bounded to
// that environment: it is never an admin approval, every call is still in
// the decision log (`own-environment`), and the safety holds, the person's
// own deny and ask rules, a sandbox widening and a guest's turn keep their
// card (server/auto-approve.ts).
//
// This computer (every other `sagax-desktop` tool: the person's real files,
// apps and network) is not an isolated environment and keeps today's rule.
//
// Names are matched exactly, never by prefix: `mcp__<server>__<tool>`
// (Claude), `<server>__<tool>` (ACP titles, Codex, chat engines' mcpTool).
import { DESKTOP_BRIDGE_MCP_NAME } from "../shared/bot-workplace.ts";
import { USER_SANDBOX_MCP_NAME } from "./user-sandbox-routing.ts";

/** The server environment's tools (server/user-sandbox-tools.ts). */
export const SERVER_ENVIRONMENT_TOOLS: ReadonlySet<string> = new Set([
  "run_command", "read_file", "write_file", "list_files", "browse", "computer_list_tools", "computer_use",
]);

/** The desktop bridge's one tool that acts in the isolated Local VM. */
export const LOCAL_VM_TOOL = "local_vm";

export type OwnEnvironment = "server-environment" | "local-vm";

/** Which of the owner's own environments a provider's tool name acts in, or
 * null (another tool, another server, This computer). */
export function ownEnvironmentTool(name: string | undefined): OwnEnvironment | null {
  const match = /^(?:mcp__)?([a-z][a-z-]{0,63})__([a-z][a-z0-9_]{0,63})$/.exec(name?.trim() ?? "");
  if (!match) return null;
  const [, server, tool] = match;
  if (server === USER_SANDBOX_MCP_NAME && SERVER_ENVIRONMENT_TOOLS.has(tool!)) return "server-environment";
  if (server === DESKTOP_BRIDGE_MCP_NAME && tool === LOCAL_VM_TOOL) return "local-vm";
  return null;
}

/** The organization's policy: on unless an admin turned it off. */
export function memberEnvironmentAutonomyAllowed(organization: { memberEnvironmentAutonomy?: unknown } | undefined): boolean {
  return organization?.memberEnvironmentAutonomy !== false;
}

/** Whether one permission request runs unasked in the owner's own
 * environment: the policy is on, the tool acts in an own environment, the
 * environment mounted for this turn belongs to the bot's owner, and no
 * guest drives the turn. */
export function ownEnvironmentCall(input: {
  identity: "solo" | "perspicax";
  policyAllowed: boolean;
  tool: string | undefined;
  /** Whose environment this turn mounted (its workplace decision), if any. */
  environmentPrincipalId: string | null | undefined;
  ownerPrincipalId: string;
  guestDriven: boolean;
}): boolean {
  if (input.identity !== "perspicax" || !input.policyAllowed || input.guestDriven) return false;
  if (!ownEnvironmentTool(input.tool)) return false;
  const environment = input.environmentPrincipalId?.trim().toLowerCase();
  return Boolean(environment) && environment === input.ownerPrincipalId.trim().toLowerCase();
}

/** The env marker Sagax puts on an own-environment mount, read by the Grok
 * approval gate (grok-approval-gate.ts). A person's own MCP server cannot
 * set it: every SAGAX_ variable is reserved (mcp-registry.ts). */
export const OWN_ENVIRONMENT_ENV = "SAGAX_OWN_ENVIRONMENT";
