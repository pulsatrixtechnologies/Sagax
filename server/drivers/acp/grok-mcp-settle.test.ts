import { describe, expect, it } from "vitest";

import { grokMcpSettled, waitForGrokMcpSettled } from "./grok.ts";

describe("grokMcpSettled", () => {
  it("waits for the session to resolve and for every enabled server to leave pending", () => {
    expect(grokMcpSettled({ sessionMcpResolved: false, servers: [] })).toBe(false);
    expect(grokMcpSettled({ sessionMcpResolved: true, servers: [{ name: "perspicax_x", session: { enabled: true, status: "pending" } }] })).toBe(false);
    expect(grokMcpSettled({ sessionMcpResolved: true, servers: [{ name: "perspicax_x", session: { enabled: true, status: "ready" } }] })).toBe(true);
    expect(grokMcpSettled({ sessionMcpResolved: true, servers: [{ name: "a", session: { enabled: true, status: "failed" } }] })).toBe(true);
    expect(grokMcpSettled({ sessionMcpResolved: true, servers: [{ name: "a", session: { enabled: false, status: "pending" } }] })).toBe(true);
    expect(grokMcpSettled(undefined)).toBe(false);
  });
});

describe("waitForGrokMcpSettled", () => {
  it("returns once Grok reports its servers connected", async () => {
    let calls = 0;
    const request = async () => {
      calls += 1;
      return { result: { sessionMcpResolved: calls >= 3, servers: [{ name: "p", session: { enabled: true, status: calls >= 3 ? "ready" : "pending" } }] } };
    };
    expect(await waitForGrokMcpSettled(request, "s", 5_000)).toBe(true);
    expect(calls).toBe(3);
  });
  it("gives up without throwing when Grok cannot answer or the budget runs out", async () => {
    expect(await waitForGrokMcpSettled(async () => { throw new Error("no such method"); }, "s", 5_000)).toBe(false);
    expect(await waitForGrokMcpSettled(async () => ({ result: { sessionMcpResolved: false, servers: [] } }), "s", 250)).toBe(false);
  });
});
