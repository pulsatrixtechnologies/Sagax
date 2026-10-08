// Organization server: the ACP rules every withheld turn shares (each
// engine's own profile is pinned beside it as it is admitted).
import { describe, expect, it } from "vitest";

import { acpHostToolRequest, sagaxMcpServerNames } from "../host-tools.ts";

describe("organization server: each admitted ACP engine withholds its own tools", () => {
  it("lets a call to one of Sagax's MCP tools through and declines commands, edits, moves and deletes", () => {
    expect(acpHostToolRequest({ kind: "execute", title: "echo hi" })).toBe(true);
    expect(acpHostToolRequest({ kind: "edit", title: "write notes.txt" })).toBe(true);
    expect(acpHostToolRequest({ kind: "delete", title: "rm" })).toBe(true);
    expect(acpHostToolRequest({ kind: "move", title: "mv" })).toBe(true);
    expect(acpHostToolRequest({ kind: "execute", title: "mcp__agents__list_bots" })).toBe(false);
    expect(acpHostToolRequest({ kind: "other", title: "anything" })).toBe(false);
    expect(acpHostToolRequest({ kind: "fetch", title: "mcp_notes_read" })).toBe(false);
  });

  it("names exactly the MCP servers Sagax passes a turn", () => {
    expect(sagaxMcpServerNames(undefined)).toEqual([]);
    expect(sagaxMcpServerNames({ agents: {}, browser: {}, custom: { notes: {}, agents: {} } })).toEqual(["agents", "browser", "notes"]);
  });
});
