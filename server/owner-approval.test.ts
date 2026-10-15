import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  destructiveKindOf,
  matchOwnerRule,
  normalizeRuleTool,
  ownerDecision,
  ruleCandidateFor,
  ruleScopeFor,
  type OwnerRule,
  type RuleCall,
} from "./owner-approval.ts";
import { OwnerApprovalStore } from "./owner-approval-store.ts";

const ALICE = "pr_alice";
const BOB = "pr_bob";
const CW_WRITE = "mcp__perspicax_gox__cw_psa__write";
const ticketUpdate = JSON.stringify({ resource: "service/tickets/4512", operation: "update", body: { status: "In progress" } });
const scheduleCreate = JSON.stringify({ resource: "schedule/entries", operation: "create", body: {} });
const ticketDelete = JSON.stringify({ resource: "service/tickets/4512", operation: "delete" });
const bulkClose = JSON.stringify({ resource: "service/tickets", operation: "update", ids: [1, 2, 3], body: { status: "Closed" } });
const smsSend = JSON.stringify({ resource: "Accounts/AC1/Messages", operation: "create", body: { To: "+15550001111" } });

const call = (input: string, extra: Partial<RuleCall> = {}): RuleCall => ({ ownerId: ALICE, botId: "bot-a", tool: CW_WRITE, input, ...extra });

function rule(over: Partial<OwnerRule> = {}): OwnerRule {
  const candidate = ruleCandidateFor({ tool: CW_WRITE, input: ticketUpdate });
  return {
    id: "r1", ownerId: ALICE, botId: "bot-a", tool: candidate.tool, scope: candidate.scope, behavior: "allow",
    description: candidate.description, createdAt: 1, updatedAt: 1, ...over,
  };
}

describe("rule granularity: the tool and its target, not the whole tool", () => {
  it("reads the target from the arguments, without record ids", () => {
    expect(ruleScopeFor(ticketUpdate)).toEqual({ resource: "service/tickets", operation: "update" });
    expect(ruleScopeFor(JSON.stringify({ url: "https://github.com/acme/repo/pull/3" }))).toEqual({ host: "github.com" });
    expect(ruleScopeFor("not json")).toEqual({});
  });
  it("reads a gateway api_write call as api, resource and verb, like the MCP permission key (#508)", () => {
    const update = JSON.stringify({ api: "CW", resource: "ticket", verb: "update", body: {} });
    const create = JSON.stringify({ api: "cw", resource: "ticket", verb: "create", body: {} });
    expect(ruleScopeFor(update)).toEqual({ api: "cw", resource: "ticket", verb: "update" });
    expect(ruleScopeFor(JSON.stringify({ api: "cw", resource: "ticket", action: "close" }))).toEqual({ api: "cw", resource: "ticket", action: "close" });
    const tool = "mcp__perspicax_gox__api_write";
    const candidate = ruleCandidateFor({ tool, input: update });
    const saved: OwnerRule = { id: "g1", ownerId: ALICE, botId: "bot-a", tool: candidate.tool, scope: candidate.scope, behavior: "allow", description: candidate.description, createdAt: 1, updatedAt: 1 };
    expect(matchOwnerRule([saved], { ownerId: ALICE, botId: "bot-a", tool, input: update })?.id).toBe("g1");
    expect(matchOwnerRule([saved], { ownerId: ALICE, botId: "bot-a", tool, input: create })).toBeUndefined();
  });
  it("treats mcp__srv__tool and srv__tool as one tool", () => {
    expect(normalizeRuleTool(CW_WRITE)).toBe(normalizeRuleTool("perspicax_gox__cw_psa__write"));
    expect(normalizeRuleTool("WebSearch")).toBe("WebSearch");
  });
  it("describes the rule in plain words with its target", () => {
    const candidate = ruleCandidateFor({ tool: CW_WRITE, input: ticketUpdate });
    expect(candidate.description).toMatch(/ticket/i);
    expect(candidate.description).toContain("service/tickets");
    expect(candidate.description).not.toContain("mcp__");
  });
  it("an Always allow for ticket updates does not cover schedule entries", () => {
    expect(matchOwnerRule([rule()], call(ticketUpdate))?.id).toBe("r1");
    expect(matchOwnerRule([rule()], call(scheduleCreate))).toBeUndefined();
  });
  it("an empty scope (any target, widened by the owner) covers every target", () => {
    expect(matchOwnerRule([rule({ scope: {} })], call(scheduleCreate))?.id).toBe("r1");
  });
});

describe("rules are kept per person and never shared", () => {
  it("a rule of Alice never answers for a bot of Bob, even for the same tool", () => {
    expect(matchOwnerRule([rule()], call(ticketUpdate, { ownerId: BOB, botId: "bot-b" }))).toBeUndefined();
    expect(matchOwnerRule([rule({ botId: null })], call(ticketUpdate, { ownerId: BOB, botId: "bot-b" }))).toBeUndefined();
  });
  it("a rule for one bot does not cover another bot of the same person; all my bots does", () => {
    expect(matchOwnerRule([rule()], call(ticketUpdate, { botId: "bot-other" }))).toBeUndefined();
    expect(matchOwnerRule([rule({ botId: null })], call(ticketUpdate, { botId: "bot-other" }))?.id).toBe("r1");
  });
});

describe("Always allow / Allow once / Deny", () => {
  it("Always allow approves the next matching call without a card", () => {
    expect(ownerDecision({ mode: "approval", rules: [rule()], call: call(ticketUpdate) })).toMatchObject({ kind: "allow", source: "owner-rule" });
  });
  it("Allow once saves nothing: the next call is a card again", () => {
    expect(ownerDecision({ mode: "approval", rules: [], call: call(ticketUpdate) })).toEqual({ kind: "card", reason: "no-rule" });
  });
  it("Always deny refuses without a card, and deny wins over allow", () => {
    const deny = rule({ id: "r2", behavior: "deny", scope: {} });
    expect(ownerDecision({ mode: "approval", rules: [rule(), deny], call: call(ticketUpdate) })).toMatchObject({ kind: "deny", source: "owner-rule-deny", rule: { id: "r2" } });
  });
  it("Ask every time keeps a card in approval and auto modes", () => {
    const ask = rule({ behavior: "ask" });
    expect(ownerDecision({ mode: "approval", rules: [ask], call: call(ticketUpdate) })).toMatchObject({ kind: "card", reason: "ask-rule" });
    expect(ownerDecision({ mode: "auto", rules: [ask], call: call(ticketUpdate) })).toMatchObject({ kind: "card", reason: "ask-rule" });
  });
});

describe("Always allow on a read card (JC, 2026-10-15: Rocket reading Twilio accounts)", () => {
  const TWILIO_QUERY = "mcp__perspicax_gox__twilio_api__query";
  const accounts = (extra: Record<string, unknown> = {}) => JSON.stringify({ resource: "Accounts", fields: ["sid", "friendlyName"], limit: 5, ...extra });
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("saves the card's rule for this person and scope, and the same request no longer asks", () => {
    dir = mkdtempSync(join(tmpdir(), "owner-approvals-"));
    const file = join(dir, "owner-approvals.json");
    const first: RuleCall = { ownerId: ALICE, botId: "rocket", tool: TWILIO_QUERY, input: accounts() };
    // before: a card, with Always allow to offer
    expect(ownerDecision({ mode: "approval", rules: [], call: first })).toEqual({ kind: "card", reason: "no-rule" });
    const candidate = ruleCandidateFor(first);
    expect(candidate).toMatchObject({ tool: "perspicax_gox__twilio_api__query", scope: { resource: "accounts" } });
    expect(candidate.destructive).toBeUndefined();
    // Always allow: the server saves the candidate for the bot's owner
    new OwnerApprovalStore(file).add({ ownerId: ALICE, botId: "rocket", tool: candidate.tool, scope: candidate.scope, behavior: "allow", description: candidate.description });
    // kept on disk: a restart still knows it
    const rules = new OwnerApprovalStore(file).rulesOf(ALICE, "rocket");
    expect(rules).toEqual([expect.objectContaining({ ownerId: ALICE, botId: "rocket", behavior: "allow", scope: { resource: "accounts" } })]);
    // the same request, and the same kind with other fields, pass without a card
    expect(ownerDecision({ mode: "approval", rules, call: first })).toMatchObject({ kind: "allow", source: "owner-rule" });
    expect(ownerDecision({ mode: "approval", rules, call: { ...first, input: accounts({ limit: 50 }) } })).toMatchObject({ kind: "allow", source: "owner-rule" });
    // another target, another bot of hers or another person still ask
    expect(ownerDecision({ mode: "approval", rules, call: { ...first, input: JSON.stringify({ resource: "Calls" }) } })).toEqual({ kind: "card", reason: "no-rule" });
    expect(new OwnerApprovalStore(file).rulesOf(ALICE, "other-bot")).toEqual([]);
    expect(ownerDecision({ mode: "approval", rules: new OwnerApprovalStore(file).rulesOf(BOB, "rocket"), call: { ...first, ownerId: BOB } })).toEqual({ kind: "card", reason: "no-rule" });
  });
});

describe("destructive actions need their own explicit Always rule", () => {
  it("detects a delete, a bulk change and an external message", () => {
    expect(destructiveKindOf({ tool: CW_WRITE, input: ticketDelete })).toBe("delete");
    expect(destructiveKindOf({ tool: CW_WRITE, input: bulkClose })).toBe("bulk");
    expect(destructiveKindOf({ tool: "mcp__perspicax_gox__twilio_api__write", input: smsSend })).toBe("external-message");
    expect(destructiveKindOf({ tool: "mcp__gmail__send_email", input: "{}" })).toBe("external-message");
    expect(destructiveKindOf({ tool: CW_WRITE, input: ticketUpdate })).toBeUndefined();
  });
  it("an allow rule with any target does not cover a delete, in any mode", () => {
    const wide = rule({ scope: {} });
    for (const mode of ["approval", "auto", "bypass"] as const) {
      expect(ownerDecision({ mode, rules: [wide], call: call(ticketDelete) })).toMatchObject({ kind: "card", reason: "destructive", destructive: "delete" });
    }
  });
  it("an allow rule made for that kind does", () => {
    const candidate = ruleCandidateFor({ tool: CW_WRITE, input: ticketDelete });
    expect(candidate.destructive).toBe("delete");
    const deletes = rule({ scope: candidate.scope, destructive: "delete" });
    expect(ownerDecision({ mode: "approval", rules: [deletes], call: call(ticketDelete) })).toMatchObject({ kind: "allow", source: "owner-rule" });
    // a delete rule does not cover a bulk close
    expect(ownerDecision({ mode: "approval", rules: [rule({ scope: {}, destructive: "delete" })], call: call(bulkClose) })).toMatchObject({ kind: "card", reason: "destructive" });
  });
  it("a deny rule covers a destructive call too", () => {
    expect(ownerDecision({ mode: "bypass", rules: [rule({ scope: {}, behavior: "deny" })], call: call(ticketDelete) })).toMatchObject({ kind: "deny" });
  });
});

describe("modes", () => {
  it("auto approves what no rule covers and is not destructive", () => {
    expect(ownerDecision({ mode: "auto", rules: [], call: call(ticketUpdate) })).toEqual({ kind: "allow", source: "owner-auto" });
    expect(ownerDecision({ mode: "auto", rules: [], call: call(smsSend, { tool: "mcp__perspicax_gox__twilio_api__write" }) })).toMatchObject({ kind: "card", reason: "destructive" });
  });
  it("bypass asks nothing on the owner route, even over an ask rule, and is journaled as bypass", () => {
    expect(ownerDecision({ mode: "bypass", rules: [], call: call(ticketUpdate) })).toEqual({ kind: "allow", source: "owner-bypass" });
    expect(ownerDecision({ mode: "bypass", rules: [rule({ behavior: "ask" })], call: call(ticketUpdate) })).toMatchObject({ kind: "allow", source: "owner-bypass" });
  });
  it("no mode or rule answers an admin card or a hold", () => {
    for (const mode of ["approval", "auto", "bypass"] as const) {
      expect(ownerDecision({ mode, rules: [rule({ scope: {} })], call: call(ticketUpdate), adminRoute: true })).toEqual({ kind: "card", reason: "admin" });
      expect(ownerDecision({ mode, rules: [rule({ scope: {} })], call: call(ticketUpdate), personMustAnswer: true })).toEqual({ kind: "card", reason: "hold" });
    }
  });
});

describe("the store", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });
  const open = () => {
    dir = mkdtempSync(join(tmpdir(), "owner-approvals-"));
    return new OwnerApprovalStore(join(dir, "owner-approvals.json"), () => 1_000);
  };

  it("keeps rules per person: another person neither sees, changes nor removes them", () => {
    const store = open();
    const saved = store.add({ ownerId: ALICE, botId: "bot-a", tool: "perspicax_gox__cw_psa__write", scope: { resource: "service/tickets" }, behavior: "allow", description: "Update tickets" });
    expect(store.rulesOf(ALICE)).toHaveLength(1);
    expect(store.rulesOf(BOB)).toHaveLength(0);
    expect(store.update(BOB, saved.id, { behavior: "deny" })).toBeNull();
    expect(store.remove(BOB, saved.id)).toBe(false);
    expect(store.rulesOf(ALICE)[0]!.behavior).toBe("allow");
    expect(store.update(ALICE, saved.id, { behavior: "deny", anyTarget: true, botId: null })).toMatchObject({ behavior: "deny", scope: {}, botId: null });
    expect(store.remove(ALICE, saved.id)).toBe(true);
    expect(store.rulesOf(ALICE)).toHaveLength(0);
  });

  it("the same rule saved twice replaces its behavior", () => {
    const store = open();
    const input = { ownerId: ALICE, botId: "bot-a", tool: "x__y", scope: { resource: "a" }, behavior: "allow" as const, description: "d" };
    store.add(input);
    store.add({ ...input, behavior: "deny" });
    expect(store.rulesOf(ALICE)).toEqual([expect.objectContaining({ behavior: "deny" })]);
  });

  it("filters to the rules that can apply to one bot", () => {
    const store = open();
    store.add({ ownerId: ALICE, botId: "bot-a", tool: "x__y", scope: {}, behavior: "allow", description: "a" });
    store.add({ ownerId: ALICE, botId: null, tool: "x__z", scope: {}, behavior: "allow", description: "all" });
    store.add({ ownerId: ALICE, botId: "bot-b", tool: "x__w", scope: {}, behavior: "allow", description: "b" });
    expect(store.rulesOf(ALICE, "bot-a").map((row) => row.description).sort()).toEqual(["a", "all"]);
  });

  it("a mode falls back to approval when the bot's owner changed, and persists 0600", () => {
    const store = open();
    expect(store.modeOf("bot-a", ALICE)).toBe("approval");
    store.setMode("bot-a", ALICE, "bypass");
    expect(store.modeOf("bot-a", ALICE)).toBe("bypass");
    expect(store.modeOf("bot-a", BOB)).toBe("approval");
    const file = join(dir, "owner-approvals.json");
    // Windows has no POSIX file modes: statSync reports 0o666 whatever chmod asked.
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
    const reopened = new OwnerApprovalStore(file);
    expect(reopened.modeOf("bot-a", ALICE)).toBe("bypass");
    reopened.forgetBot("bot-a");
    expect(new OwnerApprovalStore(file).modeOf("bot-a", ALICE)).toBe("approval");
  });

  it("never overwrites a file it could not read", () => {
    dir = mkdtempSync(join(tmpdir(), "owner-approvals-"));
    const file = join(dir, "owner-approvals.json");
    writeFileSync(file, "{broken");
    const store = new OwnerApprovalStore(file);
    expect(() => store.add({ ownerId: ALICE, botId: null, tool: "x__y", scope: {}, behavior: "allow", description: "d" })).toThrow(/Repair/);
    expect(readFileSync(file, "utf8")).toBe("{broken");
  });
});

describe("earlier per-bot Allow keys on the rules page", () => {
  it("round-trips a legacy id, and refuses anything else", async () => {
    const { legacyRuleId, parseLegacyRuleId } = await import("./routes/owner-approvals.ts");
    const id = legacyRuleId("bot-a", "mcp:perspicax_gox__cw_psa__write");
    expect(id).toMatch(/^legacy_[\w-]+$/);
    expect(parseLegacyRuleId(id)).toEqual({ botId: "bot-a", key: "mcp:perspicax_gox__cw_psa__write" });
    expect(parseLegacyRuleId("rule_123")).toBeNull();
  });
});
