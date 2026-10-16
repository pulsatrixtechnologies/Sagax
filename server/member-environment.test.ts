import { describe, expect, it } from "vitest";

import { autoVerdict } from "./auto-approve.ts";
import { gateReadOnlyTools, isOwnEnvironmentMount } from "./drivers/acp/grok-approval-gate.ts";
import { memberBotAdminApproval } from "./engine-access.ts";
import { memberEnvironmentAutonomyAllowed, OWN_ENVIRONMENT_ENV, ownEnvironmentCall, ownEnvironmentTool } from "./member-environment.ts";
import { SPAWNED_PROXIES } from "./proxy-paths.ts";

const OWNER = "pr_owner";
const call = (over: Partial<Parameters<typeof ownEnvironmentCall>[0]> = {}) => ownEnvironmentCall({
  identity: "perspicax", policyAllowed: true, tool: "mcp__sagax-environment__run_command",
  environmentPrincipalId: OWNER, ownerPrincipalId: OWNER, guestDriven: false, ...over,
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

  it("is never an admin approval, and everything else keeps the admin route", () => {
    const base = { tool: "mcp__sagax-environment__run_command", workspaceRoot: "/tmp/none" };
    expect(memberBotAdminApproval(base)).toBe(true);
    expect(memberBotAdminApproval({ ...base, ownEnvironment: true })).toBe(false);
    expect(memberBotAdminApproval({ tool: "Bash", command: { command: "ls" }, workspaceRoot: "/tmp/none" })).toBe(true);
  });

  it("auto-approves after the safety hold and the person's deny and ask rules, never a widening or a gate card", () => {
    expect(autoVerdict("ask", "mcp__sagax-environment__run_command", { ownEnvironment: true })).toMatchObject({ source: "own-environment" });
    expect(autoVerdict("auto", "other", { ownEnvironment: true })).toMatchObject({ source: "own-environment" });
    expect(autoVerdict("ask", "x", { ownEnvironment: true, safetyHold: true }).approve).toBeNull();
    expect(autoVerdict("ask", "x", { ownEnvironment: true, customRule: { behavior: "deny", id: "r" } }).source).toBe("custom-rule-deny");
    expect(autoVerdict("ask", "x", { ownEnvironment: true, customRule: { behavior: "ask", id: "r" } }).source).toBe("custom-rule-ask");
    expect(autoVerdict("ask", "x", { ownEnvironment: true, requiresExplicitApproval: true }).approve).toBeNull();
    expect(autoVerdict("ask", "x", { ownEnvironment: true, sagaxGate: true }).approve).toBeNull();
    expect(autoVerdict("ask", "AskUserQuestion", { ownEnvironment: true }).approve).toBeNull();
    expect(autoVerdict("ask", "mcp__sagax-environment__run_command").approve).toBeNull();
  });

  it("lets the Grok gate pass a marked own-environment mount only", () => {
    const proxy = SPAWNED_PROXIES.userSandbox;
    const marked = { command: "node", args: [proxy], env: { [OWN_ENVIRONMENT_ENV]: "1" } };
    expect(isOwnEnvironmentMount(marked)).toBe(true);
    expect(gateReadOnlyTools({ name: "sagax-environment", builtin: false, spec: marked })).toContain("run_command");
    expect(gateReadOnlyTools({ name: "sagax-desktop", builtin: false, spec: { ...marked, env: { ...marked.env, SAGAX_TOOL_SERVER: "sagax-desktop" } } })).toEqual(["local_vm"]);
    expect(gateReadOnlyTools({ name: "sagax-environment", builtin: false, spec: { command: "node", args: [proxy], env: {} } })).toEqual([]);
    expect(gateReadOnlyTools({ name: "sagax-environment", builtin: false, spec: { command: "node", args: ["/tmp/other.mjs"], env: { [OWN_ENVIRONMENT_ENV]: "1" } } })).toEqual([]);
    expect(gateReadOnlyTools({ name: "github", builtin: false, spec: marked })).toEqual([]);
  });
});
