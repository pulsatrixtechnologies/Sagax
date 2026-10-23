import { describe, expect, it } from "vitest";
import { gatedMcpAsk } from "./gated-mcp-ask.ts";

const MOUNTS = new Set(["agents", "perspicax_quasar_agent", "sagax-environment"]);
// the exact shape grok 1.0.46 sent in production (2026-10-12T01:04:39Z)
const useTool = (tool: string, title = tool) => ({
  toolCallId: "call-1-0", kind: "other", title,
  rawInput: { variant: "UseTool", tool_name: tool, tool_input: {} },
  _meta: { "x.ai/tool": { version: 1, name: "use_tool", kind: "use_tool", namespace: "grok_build", label: "Use Tool", read_only: false } },
});

describe("gatedMcpAsk", () => {
  it("answers Grok's use_tool ask about a tool of a gated mount (production shape)", () => {
    expect(gatedMcpAsk(useTool("agents__list_bots"), MOUNTS)).toBe("agents__list_bots");
    expect(gatedMcpAsk(useTool("perspicax_quasar_agent__flow_action"), MOUNTS)).toBe("perspicax_quasar_agent__flow_action");
    expect(gatedMcpAsk(useTool("sagax-environment__write_file"), MOUNTS)).toBe("sagax-environment__write_file");
  });

  it("answers a direct MCP ask titled <server>__<tool> of a gated mount", () => {
    expect(gatedMcpAsk({ kind: "other", title: "agents__create_bot" }, MOUNTS)).toBe("agents__create_bot");
    expect(gatedMcpAsk({ title: "mcp__agents__list_bots" }, MOUNTS)).toBe("agents__list_bots");
  });

  it("keeps the card for anything that is not a call to a gated mount", () => {
    // no gate on this turn
    expect(gatedMcpAsk(useTool("agents__list_bots"), undefined)).toBeNull();
    expect(gatedMcpAsk(useTool("agents__list_bots"), new Set())).toBeNull();
    // a server this turn did not mount through the gate
    expect(gatedMcpAsk(useTool("github__create_issue"), MOUNTS)).toBeNull();
    expect(gatedMcpAsk({ kind: "other", title: "github__create_issue" }, MOUNTS)).toBeNull();
    // a prefix is not a server: "agentsX__…" is not "agents"
    expect(gatedMcpAsk(useTool("agentsX__list_bots"), MOUNTS)).toBeNull();
    // built-ins: commands, file changes, reads, fetches
    expect(gatedMcpAsk({ kind: "execute", title: "agents__list_bots" }, MOUNTS)).toBeNull();
    expect(gatedMcpAsk({ kind: "edit", title: "agents__list_bots" }, MOUNTS)).toBeNull();
    expect(gatedMcpAsk({ kind: "read", title: "agents__list_bots" }, MOUNTS)).toBeNull();
    expect(gatedMcpAsk({ kind: "other", title: "Run tests" }, MOUNTS)).toBeNull();
    // use_tool without a target, with a foreign target, or disagreeing with its title
    expect(gatedMcpAsk({ kind: "other", title: "Use Tool", rawInput: { variant: "UseTool" } }, MOUNTS)).toBeNull();
    expect(gatedMcpAsk(useTool("github__create_issue", "agents__list_bots"), MOUNTS)).toBeNull();
    expect(gatedMcpAsk(useTool("agents__list_bots", "agents__delete_bot"), MOUNTS)).toBeNull();
    // malformed
    expect(gatedMcpAsk(null, MOUNTS)).toBeNull();
    expect(gatedMcpAsk("agents__list_bots", MOUNTS)).toBeNull();
    expect(gatedMcpAsk(useTool("agents__"), MOUNTS)).toBeNull();
    expect(gatedMcpAsk(useTool("agents__a b"), MOUNTS)).toBeNull();
  });
});
