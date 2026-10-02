// What a Claude turn pre-allows of the agents MCP (claude.ts agentsAllowedTools):
// everything but shared_computer, which acts on a person's own computer and
// so goes through the permission prompt (the bot's approval mode decides).
import { describe, expect, it } from "vitest";
import { agentsAllowedTools } from "./claude.ts";

describe("agents MCP pre-allow", () => {
  it("is the whole server while computer sharing is off", () => {
    expect(agentsAllowedTools({ SAGAX_BOT_ID: "b1" })).toEqual(["mcp__agents"]);
    expect(agentsAllowedTools(undefined)).toEqual(["mcp__agents"]);
  });

  it("names each tool but shared_computer while it is on", () => {
    const allowed = agentsAllowedTools({ SAGAX_BOT_ID: "b1", SAGAX_SHARED_COMPUTERS_ENABLED: "1" });
    expect(allowed).not.toContain("mcp__agents");
    expect(allowed).not.toContain("mcp__agents__shared_computer");
    expect(allowed).toContain("mcp__agents__list_shared_computers");
    expect(allowed).toContain("mcp__agents__list_bots");
    expect(allowed.every((name) => name.startsWith("mcp__agents__"))).toBe(true);
  });
});
