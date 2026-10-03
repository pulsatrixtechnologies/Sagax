// Why a pooled engine process was relaunched: the changed fields of its
// spawn contract by name, never their values; and a call's per-turn tokens
// left out of the contract (server/drivers/spawn-contract.ts).
import { describe, expect, it } from "vitest";

import { contractChanges, withoutTurnTokens } from "./spawn-contract.ts";

describe("spawn contract", () => {
  it("names the fields that changed, never their values", () => {
    const before = { args: ["-p"], mcpServers: { agents: { env: { SAGAX_COMMS_TOKEN: "secret-one", SAGAX_BOT_ID: "b" } } }, model: "a" };
    const after = { args: ["-p"], mcpServers: { agents: { env: { SAGAX_COMMS_TOKEN: "secret-two", SAGAX_BOT_ID: "b" } } }, model: "b" };
    const changes = contractChanges(before, after);
    expect(changes).toEqual(["mcpServers.agents.env.SAGAX_COMMS_TOKEN", "model"]);
    expect(changes.join(" ")).not.toContain("secret");
    expect(contractChanges(before, structuredClone(before))).toEqual([]);
    expect(contractChanges({ a: 1, b: 2, c: 3 }, { a: 2, b: 3, c: 4 }, 2)).toHaveLength(2);
  });

  it("masks a turn token so two turns of one call make the same contract", () => {
    const turn = (token: string) => ({ agents: { command: "node", env: { SAGAX_COMMS_TOKEN: token, SAGAX_COMMS_TOKEN_FILE: "/x" } }, ogb: { command: "node" } });
    expect(JSON.stringify(withoutTurnTokens(turn("one")))).toBe(JSON.stringify(withoutTurnTokens(turn("two"))));
    expect(JSON.stringify(withoutTurnTokens(turn("one")))).not.toContain("one");
    // the original is left as it was (it is what the process is given)
    const servers = turn("one");
    withoutTurnTokens(servers);
    expect(servers.agents.env.SAGAX_COMMS_TOKEN).toBe("one");
  });
});
