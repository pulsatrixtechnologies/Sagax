import { describe, expect, it } from "vitest";

import { choiceFor, copiedTo, DEFAULT_JOIN_CHOICE, exportRequest, offeredBots, serverAddress, withChoice } from "./org-join";

const ME = "pr_11111111-1111-4111-8111-111111111111";
const DANA = "pr_22222222-2222-4222-8222-222222222222";

describe("org join helpers", () => {
  it("offers my bots and ownerless ones, never someone else's or hidden ones", () => {
    const bots = [
      { id: "a", name: "Atlas", ownerUserId: ME },
      { id: "b", name: "Bolt" },
      { id: "c", name: "Cleo", ownerUserId: DANA },
      { id: "d", name: "Hidden", hidden: true },
      { id: "e", name: "Legacy", ownerUserId: "local-owner" },
    ];
    expect(offeredBots(bots, ME).map((bot) => bot.id)).toEqual(["a", "b", "e"]);
  });

  it("defaults to memory on, threads off, not chosen; choosing a part chooses the bot", () => {
    expect(choiceFor({}, "a")).toEqual(DEFAULT_JOIN_CHOICE);
    expect(DEFAULT_JOIN_CHOICE).toEqual({ copy: false, threads: false, memory: true });
    const next = withChoice({}, "a", "threads", true);
    expect(next.a).toEqual({ copy: true, threads: true, memory: true });
    expect(withChoice(next, "a", "memory", false).a).toEqual({ copy: true, threads: true, memory: false });
  });

  it("asks the export for the chosen bots only, in list order", () => {
    const bots = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const choices = { c: { copy: true, threads: false, memory: false }, a: { copy: true, threads: true, memory: true }, b: { copy: false, threads: true, memory: true } };
    expect(exportRequest(bots, choices)).toEqual({ bots: [{ id: "a", threads: true, memory: true }, { id: "c", threads: false, memory: false }] });
  });

  it("accepts https anywhere and http only on this computer", () => {
    expect(serverAddress("sagax.example.com/path")).toBe("https://sagax.example.com");
    expect(serverAddress("http://localhost:19192/")).toBe("http://localhost:19192");
    expect(serverAddress("http://sagax.example.com")).toBeNull();
    expect(serverAddress("ftp://x")).toBeNull();
    expect(serverAddress("  ")).toBeNull();
  });

  it("lists each server copied to once, newest first", () => {
    expect(copiedTo([
      { iss: "i", sub: "1", serverOrigin: "https://a.test", linkedAt: 1 },
      { iss: "i", sub: "2", serverOrigin: "https://b.test", linkedAt: 3 },
      { iss: "i", sub: "3", serverOrigin: "https://a.test", linkedAt: 2 },
    ])).toEqual(["https://b.test", "https://a.test"]);
  });
});
