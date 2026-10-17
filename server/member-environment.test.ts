import { describe, expect, it } from "vitest";

import { autoVerdict } from "./auto-approve.ts";
import { gateReadOnlyTools } from "./drivers/acp/grok-approval-gate.ts";
import { memberBotAdminApproval } from "./engine-access.ts";
import { mcpServerNameError } from "./mcp-registry.ts";
import {
  memberEnvironmentAutonomyAllowed,
  ownEnvironmentAutonomy,
  ownEnvironmentCall,
  ownEnvironmentReadTool,
  ownEnvironmentSensitiveRead,
  ownEnvironmentTool,
  ownEnvironmentTurnOrigin,
} from "./member-environment.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";
import { USER_SANDBOX_MCP_NAME } from "./user-sandbox-routing.ts";
import { DESKTOP_BRIDGE_MCP_NAME } from "../shared/bot-workplace.ts";
import { callStepUpClasses } from "./step-up-gate.ts";

const OWNER = "pr_owner";
const MOUNTED = new Set([USER_SANDBOX_MCP_NAME, DESKTOP_BRIDGE_MCP_NAME]);
const call = (over: Partial<Parameters<typeof ownEnvironmentCall>[0]> = {}) => ownEnvironmentCall({
  identity: "perspicax", policyAllowed: true, tool: "mcp__sagax-environment__run_command",
  environmentPrincipalId: OWNER, ownerPrincipalId: OWNER, guestDriven: false, mountedServers: MOUNTED, ...over,
});
const origin = (over: Partial<Parameters<typeof ownEnvironmentTurnOrigin>[0]> = {}) => ownEnvironmentTurnOrigin({
  speaker: { origin: "person", principalId: OWNER }, ownerPrincipalId: OWNER,
  internalTurn: false, routineLineage: false, automation: false, unattended: false, ...over,
});
const autonomy = (over: Partial<Parameters<typeof ownEnvironmentAutonomy>[0]> = {}) => ownEnvironmentAutonomy({
  call: true, mode: "auto", tool: "mcp__sagax-environment__run_command", origin: "owner", stepUpRequired: [], ...over,
});

describe("the owner's own environment (2026-10-16)", () => {
  it("names the server environment's tools and the Local VM exactly", () => {
    expect(ownEnvironmentTool("mcp__sagax-environment__run_command")).toBe("server-environment");
    expect(ownEnvironmentTool("sagax-environment__write_file")).toBe("server-environment");
    expect(ownEnvironmentTool("sagax-desktop__local_vm")).toBe("local-vm");
    expect(ownEnvironmentTool("mcp__sagax-desktop__local_vm")).toBe("local-vm");
    // This computer, another server, a look-alike, an unknown tool: none.
    for (const name of ["sagax-desktop__run_command", "sagax-desktop__computer_use", "sagax-environment__unknown", "sagax-environment2__run_command",
      "my-sagax-environment__run_command", "sagax-environment__run_command x", "run_command", "Bash", "", undefined]) {
      expect(ownEnvironmentTool(name)).toBeNull();
    }
  });

  it("is on unless an admin turned it off", () => {
    expect(memberEnvironmentAutonomyAllowed(undefined)).toBe(true);
    expect(memberEnvironmentAutonomyAllowed({})).toBe(true);
    expect(memberEnvironmentAutonomyAllowed({ memberEnvironmentAutonomy: true })).toBe(true);
    expect(memberEnvironmentAutonomyAllowed({ memberEnvironmentAutonomy: false })).toBe(false);
  });

  it("holds only in the owner's own environment, on an organization server, while allowed", () => {
    expect(call()).toBe(true);
    expect(call({ environmentPrincipalId: "PR_OWNER " })).toBe(true);
    expect(call({ environmentPrincipalId: "pr_someone_else" })).toBe(false);
    expect(call({ environmentPrincipalId: null })).toBe(false);
    expect(call({ policyAllowed: false })).toBe(false);
    expect(call({ identity: "solo" })).toBe(false);
    expect(call({ guestDriven: true })).toBe(false);
    expect(call({ tool: "sagax-desktop__computer_use" })).toBe(false);
  });

  it("recognizes the environment by the mount Sagax made for this turn, never by the name alone", () => {
    // a person's own server under the reserved name, or no mount this turn
    expect(call({ mountedServers: new Set() })).toBe(false);
    expect(call({ mountedServers: new Set([DESKTOP_BRIDGE_MCP_NAME]) })).toBe(false);
    expect(call({ tool: "sagax-desktop__local_vm", mountedServers: new Set([USER_SANDBOX_MCP_NAME]) })).toBe(false);
    expect(call({ tool: "sagax-desktop__local_vm", mountedServers: new Set([DESKTOP_BRIDGE_MCP_NAME]) })).toBe(true);
    // and nobody may name a server like them
    expect(mcpServerNameError(USER_SANDBOX_MCP_NAME)).toMatch(/reserved/);
    expect(mcpServerNameError(DESKTOP_BRIDGE_MCP_NAME)).toMatch(/reserved/);
  });

  it("is never an admin approval, and everything else keeps the admin route", () => {
    const base = { tool: "mcp__sagax-environment__run_command", workspaceRoot: "/tmp/none" };
    expect(memberBotAdminApproval(base)).toBe(true);
    expect(memberBotAdminApproval({ ...base, ownEnvironment: true })).toBe(false);
    expect(memberBotAdminApproval({ tool: "Bash", command: { command: "ls" }, workspaceRoot: "/tmp/none" })).toBe(true);
  });
});

describe("own-environment autonomy, security review 2026-10-16", () => {
  it("only the owner's own request is the owner's turn", () => {
    expect(origin()).toBe("owner");
    expect(origin({ speaker: { origin: "operator" } })).toBe("owner");
    expect(origin({ speaker: { origin: "person", principalId: "PR_OWNER" } })).toBe("owner");
    // another bot (ask, delegate, coordinate, a peer ask)
    expect(origin({ speaker: { origin: "peer", fromBotId: "b2", principalId: OWNER } })).toBe("other");
    expect(origin({ internalTurn: true })).toBe("other");
    // a routine, a webhook, a typed trigger, an email, any automation
    expect(origin({ speaker: { origin: "owner-routine" } })).toBe("other");
    expect(origin({ routineLineage: true })).toBe("other");
    expect(origin({ automation: true })).toBe("other");
    expect(origin({ unattended: true })).toBe("other");
    // someone else, an unknown person, nothing known
    expect(origin({ speaker: { origin: "person", principalId: "pr_bob" } })).toBe("other");
    expect(origin({ speaker: { origin: "person" } })).toBe("other");
    expect(origin({ speaker: undefined })).toBe("other");
  });

  it("runs unasked only at Auto or Auto-accept edits, never at Ask", () => {
    expect(autonomy({ mode: "auto" })).toBe(true);
    expect(autonomy({ mode: "edits" })).toBe(true);
    expect(autonomy({ mode: "ask" })).toBe(false);
    expect(autonomy({ mode: "custom" })).toBe(false);
    expect(autonomy({ call: false })).toBe(false);
  });

  it("never when the person protects one of the call's classes with a security key", () => {
    expect(autonomy({ stepUpRequired: ["destructive"] })).toBe(false);
    expect(autonomy({ stepUpRequired: ["irreversible"], tool: "sagax-environment__read_file" })).toBe(false);
  });

  it("another bot's or an automation's turn gets the reads only", () => {
    expect(autonomy({ origin: "other" })).toBe(false);
    expect(autonomy({ origin: "other", tool: "sagax-environment__write_file" })).toBe(false);
    expect(autonomy({ origin: "other", tool: "sagax-environment__browse" })).toBe(false);
    expect(autonomy({ origin: "other", tool: "sagax-desktop__local_vm" })).toBe(false);
    expect(autonomy({ origin: "other", tool: "mcp__sagax-environment__read_file" })).toBe(true);
    expect(autonomy({ origin: "other", tool: "sagax-environment__list_files" })).toBe(true);
    expect(ownEnvironmentReadTool("sagax-environment__run_command")).toBe(false);
    expect(ownEnvironmentReadTool("sagax-desktop__read_file")).toBe(false);
  });

  it("auto-approves after the safety hold and the person's deny and ask rules, never a widening, a send or a keyed class", () => {
    expect(autoVerdict("auto", "mcp__sagax-environment__run_command", { ownEnvironment: true })).toMatchObject({ source: "own-environment" });
    expect(autoVerdict("edits", "other", { ownEnvironment: true })).toMatchObject({ source: "own-environment" });
    // Ask means the person sees every call
    expect(autoVerdict("ask", "mcp__sagax-environment__run_command", { ownEnvironment: true }).approve).toBeNull();
    expect(autoVerdict("auto", "x", { ownEnvironment: true, safetyHold: true }).approve).toBeNull();
    expect(autoVerdict("auto", "x", { ownEnvironment: true, customRule: { behavior: "deny", id: "r" } }).source).toBe("custom-rule-deny");
    expect(autoVerdict("auto", "x", { ownEnvironment: true, customRule: { behavior: "ask", id: "r" } }).source).toBe("custom-rule-ask");
    expect(autoVerdict("auto", "x", { ownEnvironment: true, requiresExplicitApproval: true }).approve).toBeNull();
    expect(autoVerdict("auto", "x", { ownEnvironment: true, stepUpRequired: ["destructive"] }).approve).toBeNull();
    expect(autoVerdict("auto", "AskUserQuestion", { ownEnvironment: true }).approve).toBeNull();
    expect(autoVerdict("auto", "mcp__sagax-environment__run_command").approve).toBeNull();
    // the Grok gate now sends these calls here: the same rules answer its card
    expect(autoVerdict("auto", "other", { ownEnvironment: true, sagaxGate: true, toolName: "sagax-environment__run_command" }).source).toBe("own-environment");
    expect(autoVerdict("ask", "other", { ownEnvironment: true, sagaxGate: true }).approve).toBeNull();
  });

  it("re-review 2026-10-17: another bot's or an automation's read never reaches a dotfile or a credential path", () => {
    const read = (path: unknown) => autonomy({ origin: "other", tool: "sagax-environment__read_file", input: JSON.stringify({ path }) });
    for (const path of [
      "/workspace/.git-credentials", ".git-credentials", "~/.config/gh/hosts.yml", "/home/u/.ssh/id_ed25519", "/workspace/.netrc",
      ".npmrc", "/root/.aws/credentials", "/home/u/.docker/config.json", ".kube/config", "/workspace/.env", "notes/../.ssh/id_rsa",
      "/workspace/../etc/shadow", "keys/server.pem", "/workspace/id_rsa", "/workspace/credentials.json", "/workspace/%2essh/x",
    ]) {
      expect(read(path), path).toBe(false);
      expect(ownEnvironmentSensitiveRead(JSON.stringify({ path })), path).toBe(true);
    }
    expect(read(42)).toBe(false);
    expect(autonomy({ origin: "other", tool: "sagax-environment__read_file", input: "not json" })).toBe(false);
    expect(autonomy({ origin: "other", tool: "sagax-environment__list_files", input: JSON.stringify({ path: "/workspace/.ssh" }) })).toBe(false);
    // ordinary reads still run, and a listing of the working folder
    expect(read("/workspace/report.csv")).toBe(true);
    expect(read("notes/today.md")).toBe(true);
    expect(autonomy({ origin: "other", tool: "sagax-environment__list_files", input: "{}" })).toBe(true);
    expect(autonomy({ origin: "other", tool: "sagax-environment__computer_list_tools" })).toBe(true);
    // the owner's own turn is not limited this way (their own key classes are)
    expect(autonomy({ origin: "owner", tool: "sagax-environment__read_file", input: JSON.stringify({ path: "~/.ssh/id_rsa" }) })).toBe(true);
  });

  it("re-review 2026-10-17: the Local VM's run is destructive and irreversible, like run_command", () => {
    const vm = callStepUpClasses({ tool: "other", mcpTool: "sagax-desktop__local_vm", input: JSON.stringify({ action: "run", command: "ls" }), summary: "" });
    const shell = callStepUpClasses({ tool: "other", mcpTool: "sagax-environment__run_command", input: JSON.stringify({ command: "ls" }), summary: "" });
    expect(vm).toEqual(expect.arrayContaining(["destructive", "irreversible"]));
    expect(shell).toEqual(expect.arrayContaining(["destructive", "irreversible"]));
    expect(callStepUpClasses({ tool: "other", mcpTool: "mcp__sagax-desktop__local_vm", input: JSON.stringify({ action: "run" }), summary: "" })).toEqual(expect.arrayContaining(["destructive", "irreversible"]));
    // status is not a command
    expect(callStepUpClasses({ tool: "other", mcpTool: "sagax-desktop__local_vm", input: JSON.stringify({ action: "status" }), summary: "" })).not.toContain("irreversible");
  });

  it("the Grok gate no longer lets the environment or Data through by itself", () => {
    const spec = { command: "node", args: [SPAWNED_PROXIES.userSandbox], env: { SAGAX_OWN_ENVIRONMENT: "1" } };
    expect(gateReadOnlyTools({ name: "sagax-environment", builtin: false, spec })).toEqual([]);
    expect(gateReadOnlyTools({ name: "sagax-desktop", builtin: false, spec })).toEqual([]);
    expect(gateReadOnlyTools({ name: "data", builtin: true })).toEqual([]);
  });
});
