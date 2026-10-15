import { describe, expect, it } from "vitest";
import { availableTools } from "./drivers/agents-catalog.ts";
import {
  MCP_PERMISSIONS,
  MCP_ROLES,
  decide,
  guardToolCall,
  permissionForTool,
  permissionModeFromEnv,
  principalFromEnv,
  scopeForCall,
  type McpAuditRecord,
} from "./mcp-permissions.ts";

const FULL = { externalRuntime: false, coordinating: true, ownThreadCreation: true, skillAuthoring: true, sharedComputers: true, voiceNotes: true, voiceCall: true, cloudHome: false, memoryEnabled: true, groupMemory: true, chief: true, botId: "b", agentApi: true };

describe("mcp permission registry", () => {
  it("names every permission resource:verb, once", () => {
    const keys = MCP_PERMISSIONS.map((x) => x.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(key).toMatch(/^[a-z]+:[a-z]+(\.[a-z]+)?$/);
  });

  it("covers every tool the catalog can show, so nothing is denied by omission", () => {
    const shown = new Set([...availableTools(FULL), ...availableTools({ ...FULL, externalRuntime: true, coordinating: false })].map((t) => t.name));
    for (const name of shown) expect(permissionForTool(name), name).toBeDefined();
  });

  it("maps a tool to one permission", () => {
    const tools = MCP_PERMISSIONS.map((x) => x.tool).filter(Boolean);
    expect(new Set(tools).size).toBe(tools.length);
  });
});

describe("decide", () => {
  const who = (role: string) => ({ id: "p", role });

  it("denies an unknown tool and an unknown role", () => {
    expect(decide(who("admin"), "no_such_tool").reason).toBe("unknown_tool");
    expect(decide(who("root"), "list_bots").reason).toBe("unknown_role");
  });

  it("gives a viewer reads and nothing else", () => {
    expect(decide(who("viewer"), "list_bots", "team").allowed).toBe(true);
    expect(decide(who("viewer"), "memory_update").reason).toBe("not_granted");
    expect(decide(who("viewer"), "ask_bot").allowed).toBe(false);
  });

  it("keeps a member to their own scope", () => {
    expect(decide(who("member"), "memory_update").allowed).toBe(true);
    expect(decide(who("member"), "ask_bot", "self").allowed).toBe(true);
    expect(decide(who("member"), "ask_bot", "team")).toMatchObject({ allowed: false, reason: "scope_too_narrow" });
    expect(decide(who("member"), "vm_exec").allowed).toBe(false);
  });

  it("lets an operator dispatch for a team but not administer", () => {
    expect(decide(who("operator"), "delegate_bot", "team").allowed).toBe(true);
    expect(decide(who("operator"), "delegate_bot", "org").allowed).toBe(false);
    expect(decide(who("operator"), "add_mcp_server").allowed).toBe(false);
  });

  it("lets an admin do everything at every scope", () => {
    for (const x of MCP_PERMISSIONS) if (x.tool) expect(decide(who("admin"), x.tool, "org").allowed, x.tool).toBe(true);
  });

  it("keeps a service to scoped automation", () => {
    expect(decide(who("service"), "send_prompt", "self").allowed).toBe(true);
    expect(decide(who("service"), "send_prompt", "team").allowed).toBe(false);
    expect(decide(who("service"), "vm_exec").allowed).toBe(false);
    expect(decide(who("service"), "act").allowed).toBe(false);
  });

  it("grants no role more than an admin", () => {
    for (const role of MCP_ROLES) for (const x of MCP_PERMISSIONS) {
      if (!x.tool) continue;
      if (decide(who(role), x.tool, "org").allowed) expect(decide(who("admin"), x.tool, "org").allowed).toBe(true);
    }
  });
});

describe("scopeForCall", () => {
  it("widens on another bot, a room or an org flag", () => {
    expect(scopeForCall({}, "b")).toBe("self");
    expect(scopeForCall({ bot_id: "b" }, "b")).toBe("self");
    expect(scopeForCall({ for_bot_id: "c" }, "b")).toBe("team");
    expect(scopeForCall({ room_id: "r" }, "b")).toBe("team");
    expect(scopeForCall({ scope: "org" }, "b")).toBe("org");
  });
});

describe("environment", () => {
  it("defaults to shadow and member", () => {
    expect(permissionModeFromEnv({})).toBe("shadow");
    expect(permissionModeFromEnv({ SAGAX_MCP_PERMISSIONS: "enforce" })).toBe("enforce");
    expect(permissionModeFromEnv({ SAGAX_MCP_PERMISSIONS: "junk" })).toBe("shadow");
    expect(principalFromEnv({ SAGAX_BOT_ID: "b" })).toMatchObject({ id: "b", role: "member" });
  });
});

describe("guardToolCall", () => {
  const setup = (mode: "off" | "shadow" | "enforce", role = "viewer") => {
    const records: McpAuditRecord[] = [];
    let ran = 0;
    const options = { principal: { id: "p", role }, mode, ownBotId: "b", audit: (r: McpAuditRecord) => records.push(r), now: () => new Date("2026-01-01T00:00:00Z") };
    const run = async () => { ran++; return { text: "ok" }; };
    return { records, options, run, ran: () => ran };
  };

  it("refuses and audits a denied call in enforce mode", async () => {
    const t = setup("enforce");
    const out = await guardToolCall(t.options, "memory_update", { text: "secret" }, t.run);
    expect(out).toMatchObject({ isError: true });
    expect(t.ran()).toBe(0);
    expect(t.records).toEqual([{ at: "2026-01-01T00:00:00.000Z", principal: "p", role: "viewer", tool: "memory_update", permission: "memory:save", scope: "self", decision: "denied", reason: "not_granted", enforced: true }]);
    expect(JSON.stringify(t.records)).not.toContain("secret");
  });

  it("audits an allowed call and runs it", async () => {
    const t = setup("enforce", "member");
    expect(await guardToolCall(t.options, "memory_update", {}, t.run)).toEqual({ text: "ok" });
    expect(t.records[0]).toMatchObject({ decision: "allowed", enforced: false });
  });

  it("only records a denial in shadow mode", async () => {
    const t = setup("shadow");
    expect(await guardToolCall(t.options, "memory_update", {}, t.run)).toEqual({ text: "ok" });
    expect(t.records[0]).toMatchObject({ decision: "denied", enforced: false });
  });

  it("denies an unregistered tool by default and skips everything when off", async () => {
    const e = setup("enforce", "admin");
    expect(await guardToolCall(e.options, "brand_new_tool", {}, e.run)).toMatchObject({ isError: true });
    const o = setup("off", "viewer");
    await guardToolCall(o.options, "memory_update", {}, o.run);
    expect(o.records).toEqual([]);
    expect(o.ran()).toBe(1);
  });

  it("holds a denial even if the audit sink throws", async () => {
    const t = setup("enforce");
    t.options.audit = () => { throw new Error("disk full"); };
    expect(await guardToolCall(t.options, "memory_update", {}, t.run)).toMatchObject({ isError: true });
    expect(t.ran()).toBe(0);
  });
});

describe("coverage doc", () => {
  it("states the registry's totals", async () => {
    const { readFileSync } = await import("node:fs");
    const doc = readFileSync(new URL("../docs/mcp/coverage.md", import.meta.url), "utf8");
    const covered = MCP_PERMISSIONS.filter((x) => x.tool).length;
    const gaps = MCP_PERMISSIONS.length - covered;
    expect(doc).toContain(`Totals: capabilities ${MCP_PERMISSIONS.length}, covered ${covered}, gaps ${gaps}.`);
    expect(doc.match(/\| MISSING \|/g)?.length).toBe(gaps);
  });
});
