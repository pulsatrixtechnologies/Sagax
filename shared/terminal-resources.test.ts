import { describe, expect, it } from "vitest";
import { parseTerminalResourceKey, terminalResourceKey } from "./terminal-resources.ts";

describe("terminal resource keys", () => {
  it("round-trips provider and id", () => {
    expect(terminalResourceKey("unraid", "tower")).toBe("unraid:tower");
    expect(parseTerminalResourceKey("ssh:prod")).toEqual({ provider: "ssh", id: "prod" });
    expect(parseTerminalResourceKey("bad")).toBeNull();
  });
});
