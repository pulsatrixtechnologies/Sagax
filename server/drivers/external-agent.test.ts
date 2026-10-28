import { afterEach, describe, expect, it } from "vitest";

import { adoptExternalAgent, forgetExternalAgent, listExternalBots, runExternalBot } from "./external-agent.ts";

afterEach(() => {
  for (const bot of listExternalBots()) forgetExternalAgent(bot.id);
});

describe("an external agent as a bot", () => {
  it("adopts a run function and answers a turn with its text", async () => {
    const bot = adoptExternalAgent({
      id: "helper",
      name: "Helper",
      run: async (turn) => ({ text: `saw ${turn.message}` }),
    });
    expect(bot).toEqual({ id: "helper", name: "Helper", driver: "external" });
    expect(listExternalBots()).toEqual([bot]);
    await expect(runExternalBot("helper", "hello")).resolves.toEqual({ text: "saw hello" });
    forgetExternalAgent("helper");
    await expect(runExternalBot("helper", "hello")).rejects.toThrow(/No external bot/);
  });

  it("refuses an agent with no id", () => {
    expect(() => adoptExternalAgent({ id: "", name: "Helper", run: async () => ({ text: "" }) })).toThrow(/id/);
  });
});
