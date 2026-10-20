import { describe, expect, it } from "vitest";

import type { TurnFacts } from "../shared/bot-act.ts";
import type { BotActService } from "./bot-act.ts";
import { sagaxInternalTool } from "./sagax-internal-tools.ts";
import { createSettingsActions, settingStepUpClasses, type SettingsActionDeps } from "./settings-actions.ts";

const PERSON: TurnFacts = { automation: false, guest: false, requestUsable: true, senderUnproven: false, provenPerson: "pr_owner", sharedServer: true };

function harness(over: Partial<SettingsActionDeps> & { mode?: "ask" | "auto" | "full"; facts?: TurnFacts; routeStatus?: number; answer?: unknown } = {}) {
  const planned: Array<{ effect: string; path: string; method: string; body?: unknown; stepUpClasses: readonly string[] }> = [];
  const audits: unknown[] = [];
  const screens: unknown[] = [];
  const acts = {
    async handlePlanned(input: Parameters<BotActService["handlePlanned"]>[0]) {
      planned.push({ effect: input.plan.effect, path: input.target.path, method: input.target.method, body: input.target.body, stepUpClasses: input.plan.stepUpClasses });
      if (input.target.method === "GET") return { status: 200, body: { text: JSON.stringify(over.answer ?? {}) } };
      if (input.plan.effect === "hold") return { status: 200, body: { held: true, text: "Approval needed." } };
      const status = over.routeStatus ?? 200;
      if (status < 400) input.plan.onDone?.("run");
      return status < 400 ? { status, body: { text: "{}" } } : { status, body: { error: "forbidden: not yours" } };
    },
    async handle() { return { status: 200, body: { held: true, text: "Approval needed." } }; },
  } as unknown as BotActService;
  const service = createSettingsActions({
    organization: () => false,
    facts: () => over.facts ?? PERSON,
    acts: () => acts,
    operatorId: () => "pr_operator",
    botOwner: (id) => (id === "theirs" ? "pr_other" : "pr_owner"),
    botOfThread: (id) => (id === "th1" ? "b1" : null),
    routineBot: (id) => (id === "r1" ? "b1" : id === "r2" ? "theirs" : null),
    groupOwner: () => "pr_owner",
    turnMode: () => over.mode ?? "auto",
    keyRequired: () => [],
    audit: (row) => audits.push(row),
    screen: (_facts, command, input) => { screens.push({ command, input }); return { status: 200, body: { text: "Done." } }; },
    ...over,
  });
  const call = (args: Record<string, unknown>) => service.handle({ args, botId: "b1", threadId: "th1", generation: "g", botName: "Scout", botColor: "#000" });
  return { call, planned, audits, screens };
}

describe("sagax_settings", () => {
  it("applies the owner's own bot setting at Approve for me, without a card, and records it", async () => {
    const h = harness();
    const result = await h.call({ action: "set", key: "bot.approvalMode", target: "b2", value: "auto" });
    expect(result.body.text).toContain("Done");
    expect(h.planned).toEqual([expect.objectContaining({ effect: "run", method: "PATCH", path: "/api/bots/b2", body: { approvalMode: "auto" } })]);
    expect(h.audits).toEqual([expect.objectContaining({ key: "bot.approvalMode", value: "auto", how: "run", actor: "pr_owner" })]);
  });

  it("applies the managed teams of the owner's Primary Bot and a routine put in their own conversation", async () => {
    const h = harness();
    await h.call({ action: "set", key: "bot.managedSections", value: ["Built-in"] });
    await h.call({ action: "set", key: "routine.thread", target: "r1", value: "th1" });
    expect(h.planned.map((row) => row.effect)).toEqual(["run", "run"]);
    expect(h.planned[1]).toMatchObject({ path: "/api/routines/r1", body: { resultsThreadId: "th1" } });
  });

  it("keeps a card for Full, a deletion, a secret, another person and the organization", async () => {
    const h = harness({ mode: "full" });
    for (const args of [
      { key: "bot.approvalMode", value: "full" },
      { key: "routine.delete", target: "r1", value: true },
      { key: "credentials.item", value: { name: "x", password: "y" } },
      { key: "bot.share", value: { target: "user:pr_x", level: "use" } },
      { key: "org.allowFullAccess", value: true },
    ]) {
      const result = await h.call({ action: "set", ...args });
      expect(result.body.text, args.key).toContain("Approval needed.");
    }
    expect(h.planned.every((row) => row.effect === "hold")).toBe(true);
    expect(h.audits).toEqual([]);
  });

  it("keeps a card at Ask, and for someone else's routine", async () => {
    expect((await harness({ mode: "ask" }).call({ action: "set", key: "bot.name", value: "Owl" })).body.text).toContain("this bot is at Ask");
    expect((await harness().call({ action: "set", key: "routine.enabled", target: "r2", value: false })).body.text).toContain("not the person's own");
  });

  it("asks for the key when the person protects a class of the change", async () => {
    const h = harness({ keyRequired: (_person, classes) => classes.filter((name) => name === "rule-change") });
    expect((await h.call({ action: "set", key: "bot.approvalMode", target: "b2", value: "auto" })).body.text).toContain("security key");
    expect(h.planned[0]!.stepUpClasses).toContain("rule-change");
  });

  it("relays the route's own refusal: a member does not do by bot what they cannot do by hand", async () => {
    const result = await harness({ routeStatus: 403 }).call({ action: "set", key: "bot.name", value: "Owl" });
    expect(result.status).toBe(403);
    expect(result.body.error).toContain("forbidden");
  });

  it("refuses a routine or webhook turn, an unknown key and a value of the wrong kind, with what to do", async () => {
    const h = harness();
    expect((await h.call({ action: "set", key: "bot.nope", value: 1 })).body.error).toContain("action list");
    expect((await h.call({ action: "set", key: "bot.approvalMode", value: "sometimes" })).body.error).toContain("enum:");
    expect((await h.call({ action: "list", family: "routine" })).body.text).toContain("routine.schedule");
  });

  it("reads a setting with the person's rights", async () => {
    const h = harness({ answer: { bots: [{ id: "b1", modelSelection: { model: "m", effort: "low" } }] } });
    const read = await h.call({ action: "get", key: "bot.effort" });
    expect(JSON.parse(String(read.body.text))).toEqual({ key: "bot.effort", value: "low" });
    await h.call({ action: "set", key: "bot.effort", value: "high" });
    expect(h.planned.at(-1)).toMatchObject({ method: "PATCH", body: { modelSelection: { model: "m", effort: "high" } } });
  });

  it("sets a device preference in the person's open app at Approve for me, and asks at Ask", async () => {
    const h = harness();
    await h.call({ action: "set", key: "appearance.skin", value: "night" });
    expect(h.screens).toEqual([{ command: "setPreference", input: { key: "omb-skin", value: "night" } }]);
    expect((await harness({ mode: "ask" }).call({ action: "set", key: "appearance.skin", value: "night" })).body.text).toContain("Approval needed.");
  });

  it("classes the change for the key: a write is irreversible, Full carries every class", () => {
    expect(settingStepUpClasses(["own"], { method: "PATCH", path: "/api/bots/b1" })).toEqual(["irreversible"]);
    expect(settingStepUpClasses(["own"], { method: "PATCH", path: "/api/routines/r1" })).toContain("always-grant");
    expect(settingStepUpClasses(["rule-change"], { method: "PATCH", path: "/api/bots/b1" }, "full").length).toBeGreaterThan(4);
  });

  it("is Sagax's own tool on every engine: the engine's gate never asks twice (Claude, Grok, pi, chat engines)", () => {
    for (const spelling of ["mcp__agents__sagax_settings", "agents__sagax_settings", "agents.sagax_settings", "agents:sagax_settings"]) {
      expect(sagaxInternalTool(spelling), spelling).toBe("agents");
    }
    // a foreign server that spells the same name is not Sagax's
    expect(sagaxInternalTool("mcp__agents__sagax_settings", ["agents"])).toBeNull();
  });
});
