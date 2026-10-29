import { describe, expect, it } from "vitest";

import type { TurnFacts } from "../shared/bot-act.ts";
import type { BotActService } from "./bot-act.ts";
import { sagaxInternalTool } from "./sagax-internal-tools.ts";
import { SETTINGS } from "../shared/settings-actions.ts";
import { createSettingsActions, settingStepUpClasses, type SettingsActionDeps } from "./settings-actions.ts";

const PERSON: TurnFacts = { automation: false, guest: false, requestUsable: true, senderUnproven: false, provenPerson: "pr_owner", sharedServer: true };

function harness(over: Partial<SettingsActionDeps> & { mode?: "ask" | "auto" | "full"; facts?: TurnFacts; routeStatus?: number | ((method: string, path: string) => number); answer?: unknown } = {}) {
  const planned: Array<{ effect: string; path: string; method: string; body?: unknown; stepUpClasses: readonly string[]; primary?: unknown; rule?: { scope: Record<string, string> }; noRule?: boolean }> = [];
  const audits: unknown[] = [];
  const screens: unknown[] = [];
  const acts = {
    async handlePlanned(input: Parameters<BotActService["handlePlanned"]>[0]) {
      const target = input.target.kind === "route" ? input.target : { method: "UI", path: `ui:${input.target.command}`, body: input.target.input };
      planned.push({ effect: input.plan.effect, path: target.path, method: target.method, body: target.body, stepUpClasses: input.plan.stepUpClasses, ...(input.plan.primary ? { primary: input.plan.primary } : {}), ...(input.plan.rule ? { rule: input.plan.rule } : {}), ...(input.plan.noRule ? { noRule: true } : {}) });
      const routeStatus = typeof over.routeStatus === "function" ? over.routeStatus(target.method, target.path) : over.routeStatus ?? 200;
      if (target.method === "GET" || input.plan.summary === "Read a setting") {
        if (routeStatus >= 400) return { status: routeStatus, body: { error: "forbidden: not yours" } };
        return { status: 200, body: { text: JSON.stringify(typeof over.answer === "function" ? (over.answer as (path: string) => unknown)(target.path) : over.answer ?? {}) } };
      }
      if (input.plan.effect === "hold") return { status: 200, body: { held: true, text: "Approval needed." } };
      const status = routeStatus;
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
  it("Full on the person's own request runs at once and says so to the route(2026-10-20), even for the speaking bot", async () => {
    const primary = { botId: "b1", botName: "Scout", messageId: "m1" };
    const h = harness({ mode: "ask", personAsked: () => ({ message: "Mets-toi en Full.", primary }) });
    const done = await h.call({ action: "set", key: "bot.approvalMode", value: "full", quote: "Mets-toi en Full" });
    expect(String(done.body.text)).toMatch(/^Done.*next message/);
    expect(h.planned).toMatchObject([{ effect: "run", method: "PATCH", path: "/api/bots/b1", body: { approvalMode: "full", confirmFullAccess: true }, primary }]);
    // without the person's words: the card, and no marker
    const card = harness({ mode: "ask" });
    await card.call({ action: "set", key: "bot.approvalMode", value: "full" });
    expect(card.planned[0]).toMatchObject({ effect: "hold" });
    expect(card.planned[0]!.primary).toBeUndefined();
  });

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

  it("keeps a card for Full, a secret, another person and the organization", async () => {
    const h = harness({ mode: "full" });
    for (const args of [
      { key: "bot.approvalMode", value: "full" },
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

  it("deletes the person's own routine and bot at Approve for me and Full without a card (2026-10-26)", async () => {
    for (const mode of ["auto", "full"] as const) {
      const h = harness({ mode });
      await h.call({ action: "set", key: "routine.delete", target: "r1", value: true });
      await h.call({ action: "set", key: "bot.delete", target: "b2", value: true });
      expect(h.planned.map((row) => row.effect), mode).toEqual(["run", "run"]);
    }
    // at Ask the level still asks
    const ask = harness({ mode: "ask" });
    expect((await ask.call({ action: "set", key: "routine.delete", target: "r1", value: true })).body.text).toContain("this bot is at Ask");
  });

  it("keeps the card for deleting a group with another person in it, someone else's routine, a shared team or an unknown group", async () => {
    const alone = harness({ mode: "full", groupHumans: () => ["pr_owner"] });
    await alone.call({ action: "set", key: "group.delete", target: "g1", value: true });
    expect(alone.planned.map((row) => row.effect)).toEqual(["run"]);
    for (const over of [{ groupHumans: () => ["pr_owner", "pr_bob"] }, { groupHumans: () => null }, {}]) {
      const h = harness({ mode: "full", ...over });
      expect((await h.call({ action: "set", key: "group.delete", target: "g1", value: true })).body.text).toContain("Approval needed.");
    }
    const theirs = harness({ mode: "full" });
    expect((await theirs.call({ action: "set", key: "routine.delete", target: "r2", value: true })).body.text).toContain("Approval needed.");
    const team = harness({ mode: "full" });
    expect((await team.call({ action: "set", key: "section.delete", target: "Sales", value: true })).body.text).toContain("Approval needed.");
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

  it("#1098: a change to rules or the approval level keeps its card and offers Always allow for this exact value", async () => {
    const h = harness({ mode: "ask" });
    await h.call({ action: "set", key: "bot.approvalMode", target: "b2", value: "auto" });
    expect(h.planned[0]!.effect).toBe("hold");
    expect(h.planned[0]!.noRule).toBeUndefined();
    expect(h.planned[0]!.rule?.scope).toMatchObject({ setting: "bot.approvalMode", target: "b2", value: expect.any(String) });
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

  // 2026-10-28 (one source of truth): the level is the bot's own setting, as
  // Permissions shows it, never the level of the conversation the read
  // landed on; this conversation's real level is said beside it.
  it("reads the bot's own approval setting, and this conversation's real level when it differs", async () => {
    const projected = { bots: [{ id: "b1", approvalMode: "ask", approvalSetting: "full" }] };
    const plain = await harness({ answer: projected }).call({ action: "get", key: "bot.approvalMode" });
    expect(JSON.parse(String(plain.body.text))).toEqual({ key: "bot.approvalMode", value: "full" });
    const seen: Array<[string, string | undefined]> = [];
    const h = harness({
      answer: projected,
      approvalLevel: (botId, threadId) => { seen.push([botId, threadId]); return { setting: "full", applied: { mode: "ask", reason: "engine" } }; },
    });
    const read = await h.call({ action: "get", key: "bot.approvalMode" });
    expect(JSON.parse(String(read.body.text))).toEqual({ key: "bot.approvalMode", value: "full", thisConversation: "ask", because: "engine" });
    expect(seen).toEqual([["b1", "th1"]]);
    const same = await harness({ answer: projected, approvalLevel: () => ({ setting: "full" }) }).call({ action: "get", key: "bot.approvalMode" });
    expect(JSON.parse(String(same.body.text))).toEqual({ key: "bot.approvalMode", value: "full" });
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

  it("never lets a target or a value name another route", async () => {
    const h = harness();
    for (const target of ["..", ".", "../config", "b1/tasks", "b1%2F..", "a b"]) {
      expect((await h.call({ action: "set", key: "bot.name", target, value: "x" })).status, target).toBe(400);
    }
    expect((await h.call({ action: "set", key: "connections.mcpServerRemove", value: ".." })).status).toBe(400);
    expect((await h.call({ action: "set", key: "bot.skill", value: { name: "../../config", enabled: true } })).status).toBe(400);
    expect(h.planned).toEqual([]);
    // a grant's target keeps its colon
    await harness({ mode: "full" }).call({ action: "set", key: "bot.share", value: { target: "user:pr_x", level: null } });
  });

  it("team memory sharing: the bot widening to shared waits on a card at Auto and Full; narrowing to private runs; anything else is refused", async () => {
    for (const mode of ["auto", "full"] as const) {
      for (const target of [undefined, "b2"]) {
        const h = harness({ mode });
        const where = `${mode} ${target ?? "itself"}`;
        const widen = await h.call({ action: "set", key: "bot.teamMemorySharing", ...(target ? { target } : {}), value: "shared" });
        expect(widen.body.text, where).toContain("Approval needed.");
        const narrow = await h.call({ action: "set", key: "bot.teamMemorySharing", ...(target ? { target } : {}), value: "private" });
        expect(narrow.body.text, where).toContain("Done");
        expect(h.planned.map((row) => row.effect), where).toEqual(["hold", "run"]);
        expect(h.planned[1], where).toMatchObject({ method: "PATCH", body: { teamMemorySharing: "private" } });
        // widening is recorded only once the person allows it
        expect(h.audits, where).toEqual([expect.objectContaining({ key: "bot.teamMemorySharing", value: "private", how: "run" })]);
      }
    }
    const h = harness({ mode: "full" });
    for (const value of ["everyone", "Private", "", null]) {
      expect((await h.call({ action: "set", key: "bot.teamMemorySharing", value })).status, JSON.stringify(value)).toBe(400);
    }
    expect(h.planned).toEqual([]);
  });

  it("security review: what widens keeps the card even at Approve for me", async () => {
    const h = harness();
    const held = async (args: Record<string, unknown>) => (await h.call({ action: "set", ...args })).body.text;
    // an allow rule spelled as a sentence, a rule from a card
    expect(await held({ key: "rules.custom", value: { text: "toujours permettre les lectures", botId: null } })).toContain("Approval needed.");
    expect(await held({ key: "rules.custom", value: { when: "x", behavior: "allow" } })).toContain("Approval needed.");
    // new bot defaults that set a level or grants
    expect(await held({ key: "server.newBotDefaults", value: { profile: { approvalMode: "full" } } })).toContain("Approval needed.");
    // a provider key block carries its key only
    expect((await h.call({ action: "set", key: "models.providerKey", value: { anthropic: { key: "k" }, signIn: { admins: ["x"] } } })).status).toBe(400);
    expect((await h.call({ action: "set", key: "models.providerKey", value: { anthropic: { key: "k", baseUrl: "http://x" } } })).status).toBe(400);
    // a key or an address in a model setting is a secret
    expect(await held({ key: "models.decider", value: { key: "sk-x" } })).toContain("Approval needed.");
    // the speaking bot widening its own tools; another own bot is simple
    expect(await held({ key: "bot.mcpServers", value: null })).toContain("Approval needed.");
    expect(await held({ key: "bot.mcpServers", target: "b2", value: null })).toContain("Done");
    // a routine run as someone else, a group with people, a routine moved to another person's bot
    expect(await held({ key: "routine.create", value: { name: "x", prompt: "y", botId: "b1", runAs: "pr_x" } })).toContain("Approval needed.");
    expect(await held({ key: "group.create", value: { memberIds: ["b1"], humanIds: ["pr_x"] } })).toContain("Approval needed.");
    expect(await held({ key: "routine.bot", target: "r1", value: "theirs" })).toContain("Approval needed.");
    // where bots run for the person
    expect(await held({ key: "computer.botWorkplace", value: { place: "computer", routines: true } })).toContain("Approval needed.");
    // the deny rule spelled out stays simple
    expect(await held({ key: "rules.custom", value: { when: "x", behavior: "deny" } })).toContain("Done");
    // a long value is shown by its keys and fingerprint on the card
    expect(h.planned.some((row) => row.effect === "hold")).toBe(true);
  });
});

describe("askedChange (a Primary Bot's change on the person's words, security review 2026-10-20)", () => {
  it("turns cards off only, with the level, the bot and the rule's own words named", async () => {
    const { askedChange } = await import("./settings-actions.ts");
    expect(askedChange("Mets Ottoline en auto", "bot.approvalMode", "auto", "Ottoline", false)).toBe(true);
    // security review 2026-10-20: the level and the bot are in the quote itself
    expect(askedChange("Ne mets pas Ottoline en Full, mets Zed en Full", "bot.approvalMode", "full", "Ottoline", false, undefined, "mets Zed en Full")).toMatch(/Ottoline/);
    expect(askedChange("Mets Zed en Full", "bot.approvalMode", "full", undefined, true, undefined, "Mets Zed en Full", "Scout")).toMatch(/itself/);
    expect(askedChange("Mets-toi en Full", "bot.approvalMode", "full", undefined, true, undefined, "Mets-toi en Full", "Scout")).toBe(true);
    expect(askedChange("Mets Ottoline en auto", "bot.approvalMode", "full", "Ottoline", false)).toMatch(/level full/);
    expect(askedChange("Fais-moi un rapport complet", "bot.approvalMode", "full", "Ottoline", false)).not.toBe(true);
    expect(askedChange("Mets-la en auto", "bot.approvalMode", "auto", "Ottoline", false)).toMatch(/Ottoline/);
    // anything that is not an approval level or a rule keeps its card
    expect(askedChange("Mets Ottoline en auto", "bot.title", "x", "Ottoline", false)).not.toBe(true);
    expect(askedChange("Mets Ottoline en auto", "bot.alwaysAllow", ["Bash"], "Ottoline", false)).not.toBe(true);
    // a new rule's words and an exact command are the person's own
    expect(askedChange("Ajoute une note au billet", "rules.custom", { when: "toute commande", behavior: "allow" }, undefined, true)).not.toBe(true);
    expect(askedChange("Toujours permettre la commande npm test pour Ottoline", "rules.custom", { when: "la commande npm test", behavior: "allow", botId: "kat" }, undefined, true)).toBe(true);
    // the behavior and "every bot" are said too; a one-word when is no rule
    expect(askedChange("mets une règle qui bloque les paiements", "rules.custom", { when: "les paiements", behavior: "allow" }, undefined, true)).not.toBe(true);
    expect(askedChange("mets une règle qui bloque les paiements par carte", "rules.custom", { when: "les paiements par carte", behavior: "allow", botId: "kat" }, undefined, true)).not.toBe(true);
    expect(askedChange("mets une règle qui bloque les paiements par carte", "rules.custom", { when: "les paiements par carte", behavior: "deny", botId: "kat" }, undefined, true)).toBe(true);
    expect(askedChange("Toujours permettre la commande npm test", "rules.custom", { when: "la commande npm test", behavior: "allow" }, undefined, true)).not.toBe(true);
    expect(askedChange("Toujours permettre la commande npm test pour tous les bots", "rules.custom", { when: "la commande npm test", behavior: "allow" }, undefined, true)).toBe(true);
    expect(askedChange("ajoute tout au rapport", "rules.custom", { when: "tout", behavior: "allow", botId: "kat" }, undefined, true)).not.toBe(true);
    expect(askedChange("Ajoute une note au billet", "rules.commandAllow", { command: "rm -rf /", cwd: "/", providerInstanceId: "claude" }, "Ottoline", true)).not.toBe(true);
    // a rule removed is one the message names
    expect(askedChange("Retire la règle", "rules.ownerDelete", true, undefined, true, "Run a command (printf primary-later)")).not.toBe(true);
    expect(askedChange("Retire la règle printf", "rules.ownerDelete", true, undefined, true, "Run a command (printf primary-later)")).not.toBe(true);
    expect(askedChange("Retire la règle printf primary-later", "rules.ownerDelete", true, undefined, true, "Run a command (printf primary-later)")).toBe(true);
  });
});

describe("askedBotChange (the Primary Bot changes the person's bots on their words, 2026-10-20)", () => {
  it("runs a named bot's model, archive and deletion, and refuses what the words do not say", async () => {
    const { askedBotChange } = await import("./settings-actions.ts");
    const order = "Passe SWAT, DOGE, Bot Designer et Disk Saver sur l'instance claudeApi";
    const model = (names: string[], valueNames: string[]) => askedBotChange({ key: "bot.model", family: "bot", value: {}, quote: order, names, speakingBot: false, valueNames });
    for (const name of ["SWAT", "DOGE", "Bot Designer", "Disk Saver"]) expect(model([name], ["claudeApi", "claude-opus"])).toBe(true);
    // a bot or an engine the words do not name
    expect(model(["Ottoline"], ["claudeApi"])).toMatch(/Ottoline/);
    expect(model(["SWAT"], ["codex"])).toMatch(/engine or model/);
    expect(askedBotChange({ key: "bot.hidden", family: "bot", value: true, quote: "Archive Disk Saver", names: ["Disk Saver"], speakingBot: false })).toBe(true);
    expect(askedBotChange({ key: "bot.hidden", family: "bot", value: true, quote: "Passe Disk Saver sur codex", names: ["Disk Saver"], speakingBot: false })).toMatch(/archive/);
    expect(askedBotChange({ key: "bot.delete", family: "bot", value: true, quote: "Supprime DOGE", names: ["DOGE"], speakingBot: false })).toBe(true);
    expect(askedBotChange({ key: "bot.delete", family: "bot", value: true, quote: "Archive DOGE", names: ["DOGE"], speakingBot: false })).toMatch(/delete/);
    // a new title is the person's own words
    expect(askedBotChange({ key: "bot.title", family: "bot", value: "Night shift", quote: "Renomme le titre de SWAT en Night shift", names: ["SWAT"], speakingBot: false })).toBe(true);
    expect(askedBotChange({ key: "bot.title", family: "bot", value: "Owned", quote: "Renomme SWAT", names: ["SWAT"], speakingBot: false })).toMatch(/new text/);
    // standing grants, sharing and other families keep their card
    expect(askedBotChange({ key: "bot.toolGrant", family: "bot", value: {}, quote: "Mets SWAT", names: ["SWAT"], speakingBot: false })).toMatch(/only/);
    expect(askedBotChange({ key: "account.email", family: "account", value: "x", quote: "Change mon courriel", names: [], speakingBot: true })).toMatch(/only/);
    // security review 2026-10-20: one quote carries one kind of change, a
    // question or a refusal right after it does not ask, a bare "you" is not the bot
    expect(askedBotChange({ key: "bot.persona", family: "bot", value: "x", quote: "change le modèle de Ember", names: ["Ember"], speakingBot: false })).toMatch(/which setting/);
    expect(askedBotChange({ key: "bot.cwd", family: "bot", value: "/", quote: "change le dossier de Ember", names: ["Ember"], speakingBot: false })).toMatch(/only/);
    expect(askedBotChange({ key: "bot.delete", family: "bot", value: true, quote: "supprime Ember", message: "supprime Ember ? non, pas encore", names: ["Ember"], speakingBot: false })).toMatch(/question/);
    expect(askedBotChange({ key: "bot.delete", family: "bot", value: true, quote: "ne supprime pas Ember", names: ["Ember"], speakingBot: false })).toMatch(/refuse/);
    expect(askedBotChange({ key: "routine.create", family: "routine", value: {}, quote: "use the web", names: ["Quasar"], speakingBot: true, speakingName: "Quasar" })).toMatch(/itself/);
    expect(askedBotChange({ key: "bot.persona", family: "bot", value: "x", quote: "can you change your tone", names: ["Quasar"], speakingBot: true, speakingName: "Quasar" })).toMatch(/itself/);
    // the speaking bot itself: "toi" or its name
    expect(askedBotChange({ key: "bot.effort", family: "bot", value: "high", quote: "mets-toi en effort high", names: ["Quasar"], speakingBot: true, speakingName: "Quasar" })).toBe(true);
  });
});

// #1545: every setting the person can manage, gated by the bot's level only
describe("sagax_settings engines and preferences (#1545)", () => {
  const ENGINES = { instances: [
    { instanceId: "claude", displayName: "Claude", driverKind: "claudeAgent", snapshot: { state: "available", authenticated: true, account: { email: "a@example.com" } }, models: { default: "opus" } },
    { instanceId: "claude-2", displayName: "Work account", driverKind: "claudeAgent", snapshot: { state: "available", authenticated: false }, claudeAccount: { isDefault: false } },
    { instanceId: "company.x", displayName: "Company", driverKind: "claudeAgent", readOnly: true, snapshot: { state: "available" } },
  ] };

  it("reads the bot workplace from the person's own preferences, the default when unset, and says where it lives on a personal computer", async () => {
    const set = harness({ organization: () => true, answer: { preferences: { "sagax.botWorkplace.v1": "{\"place\":\"server\",\"routines\":true}" } } });
    const read = await set.call({ action: "get", key: "computer.botWorkplace" });
    expect(JSON.parse(String(read.body.text))).toEqual({ key: "computer.botWorkplace", value: { place: "server", routines: true, network: "all" } });
    expect(set.planned).toMatchObject([{ method: "GET", path: "/api/me/preferences" }]);
    const unset = await harness({ organization: () => true, answer: { preferences: {} } }).call({ action: "get", key: "computer.botWorkplace" });
    expect(JSON.parse(String(unset.body.text))).toMatchObject({ value: { place: "computer", routines: false, network: "all" }, note: expect.stringMatching(/default/) });
    const solo = harness({ organization: () => false });
    const local = await solo.call({ action: "get", key: "computer.botWorkplace" });
    expect(local.status).toBe(200);
    expect(JSON.parse(String(local.body.text))).toMatchObject({ value: null, note: expect.stringMatching(/open Sagax app/) });
    expect(solo.planned).toEqual([]);
    // the look of a personal computer is kept by its server
    const skin = harness({ organization: () => false, answer: { preferences: { "omb-skin": "midnight" } } });
    expect(JSON.parse(String((await skin.call({ action: "get", key: "appearance.skin" })).body.text))).toMatchObject({ value: "midnight" });
    expect(skin.planned).toMatchObject([{ method: "GET", path: "/api/me/appearance" }]);
  });

  it("lists the engines and accounts the person sees, and one engine by its id", async () => {
    const h = harness({ answer: ENGINES });
    const list = JSON.parse(String((await h.call({ action: "get", key: "models.engines" })).body.text));
    expect(list.value).toEqual([
      { instanceId: "claude", name: "Claude", driver: "claudeAgent", state: "available", signedIn: true, account: "a@example.com", defaultModel: "opus" },
      { instanceId: "claude-2", name: "Work account", driver: "claudeAgent", state: "available", signedIn: false, claudeAccount: true },
      { instanceId: "company.x", name: "Company", driver: "claudeAgent", state: "available", signedIn: null, readOnly: true },
    ]);
    const one = JSON.parse(String((await h.call({ action: "get", key: "models.engine", target: "claude-2" })).body.text));
    expect(one.value).toMatchObject({ instanceId: "claude-2", signedIn: false });
    expect((await h.call({ action: "get", key: "models.engine" })).body.error).toMatch(/engine's id/);
  });

  it("adds a Claude account by the screen's route, then posts its sign-in card; never one already signed in or managed elsewhere", async () => {
    const cards: unknown[] = [];
    const h = harness({ answer: ENGINES, card: (_input, card) => { cards.push(card); return { status: 201, body: { text: "posted" } }; } });
    const added = await h.call({ action: "set", key: "models.claudeAccount", value: { name: " Work account " } });
    expect(added.body.text).toMatch(/^Done/);
    expect(h.planned.at(-1)).toMatchObject({ effect: "run", method: "POST", path: "/api/instances/claude-accounts", body: { displayName: "Work account" } });
    const signIn = await h.call({ action: "set", key: "models.engineSignIn", target: "claude-2", value: true });
    expect(signIn.body.text).toMatch(/sign-in card for Work account/);
    expect(cards).toEqual([{ kind: "engineSignIn", instanceId: "claude-2", name: "Work account" }]);
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "claude", value: true })).body.text).toMatch(/already signed in/);
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "company.x", value: true })).body.error).toMatch(/read only/);
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "nope", value: true })).status).toBe(404);
    expect(cards).toHaveLength(1);
    // the card is posted with the person's rights: an engine they cannot read gets none
    const refused = harness({ routeStatus: 403, card: (_input, card) => { cards.push(card); return { status: 201, body: {} }; } });
    expect((await refused.call({ action: "set", key: "models.engineSignIn", target: "claude-2", value: true })).status).toBe(403);
    expect(cards).toHaveLength(1);
    expect((await h.call({ action: "set", key: "models.claudeAccount", value: { configDir: "/x" } })).body.error).toMatch(/name/);
  });

  // criteria 3 to 5: capability is the person's rights (the route's answer),
  // permission is the bot's level; an engine others use keeps its card
  it("matrix: admin and member, Ask, Approve for me and Full, personal and organization server", async () => {
    const adminOnly = (method: string, path: string) => method !== "GET" && path.startsWith("/api/instances") ? 403 : 200;
    const keys: Array<{ key: string; value: unknown; target?: string }> = [
      { key: "models.claudeAccount", value: { name: "Work" } },
      { key: "models.chatgptAccount", value: { name: "Work" } },
      { key: "models.engine", target: "claude-2", value: { displayName: "Main" } },
      { key: "models.engineSignOut", target: "claude-2", value: true },
      { key: "models.engineRemove", target: "claude-2", value: true },
    ];
    for (const organization of [false, true]) {
      for (const role of ["admin", "member"] as const) {
        for (const mode of ["ask", "auto", "full"] as const) {
          for (const { key, value, target } of keys) {
            const h = harness({ mode, organization: () => organization, ...(role === "member" ? { routeStatus: adminOnly } : {}) });
            const result = await h.call({ action: "set", key, value, ...(target ? { target } : {}) });
            // a removal of the person's own engine on their own computer follows the level (2026-10-26);
            // 2026-10-28: on an organization server, adding an account or renaming
            // one follows the level too; signing out or removing an engine whose
            // users are unknown keeps the card (others' work may stop)
            const sensitive = organization && (key === "models.engineSignOut" || key === "models.engineRemove");
            const expected = mode === "ask" || sensitive ? "hold" : "run";
            // never refused as UI only: the change runs, or waits on the person's card
            expect(result.body.error ?? "", `${key} ${role} ${mode}`).not.toMatch(/no read|not available|see it at/);
            expect(h.planned.at(-1)?.effect, `${key} ${role} ${mode} org=${organization}`).toBe(expected);
            // a member's change the route refuses comes back as the route's refusal
            if (role === "member" && expected === "run") expect(result.status, key).toBe(403);
            if (role === "admin" && expected === "run") expect(result.body.text, key).toMatch(/^Done/);
          }
        }
      }
    }
  });
});

describe("sagax_settings engines of an organization server: the card only when others use the engine (#1545, 2026-10-28)", () => {
  const changes: Array<{ key: string; value: unknown; target?: string; reach: boolean }> = [
    { key: "models.claudeAccount", value: { name: "Work" }, reach: false },
    { key: "models.chatgptAccount", value: { name: "Work" }, reach: false },
    { key: "models.antigravityAccount", value: { name: "Work", source: "antigravity" }, reach: false },
    { key: "models.engine", target: "claude-2", value: { displayName: "Main" }, reach: false },
    { key: "models.engineInstall", target: "claude-2", value: true, reach: false },
    { key: "models.engineRefresh", target: "claude-2", value: true, reach: false },
    { key: "models.claudeUpdate", target: "claude-2", value: true, reach: false },
    { key: "models.antigravityLeftovers", target: "antigravity", value: true, reach: false },
    { key: "models.engine", target: "claude-2", value: { cli: "/opt/claude" }, reach: true },
    { key: "models.engine", target: "claude-2", value: { displayName: "Main", configDir: "/x" }, reach: true },
    { key: "models.engineSignOut", target: "claude-2", value: true, reach: true },
    { key: "models.engineRemove", target: "claude-2", value: true, reach: true },
  ];

  it("admin and member, Ask, Approve for me and Full: no Bypass card for what touches the admin alone", async () => {
    const adminOnly = (method: string, path: string) => method !== "GET" && path.startsWith("/api/instances") ? 403 : 200;
    for (const used of [true, false, undefined]) {
      for (const role of ["admin", "member"] as const) {
        for (const mode of ["ask", "auto", "full"] as const) {
          for (const { key, value, target, reach } of changes) {
            const seen: Array<[string, string | null]> = [];
            const h = harness({
              mode, organization: () => true,
              engineShared: (id, speaker) => { seen.push([id, speaker]); return used; },
              ...(role === "member" ? { routeStatus: adminOnly } : {}),
            });
            const result = await h.call({ action: "set", key, value, ...(target ? { target } : {}) });
            const label = `${key} ${JSON.stringify(value)} ${role} ${mode} used=${used}`;
            // others' work: the card at every level, unless nobody else uses it
            const expected = mode === "ask" || (reach && used !== false) ? "hold" : "run";
            expect(h.planned.at(-1)?.effect, label).toBe(expected);
            if (target) expect(seen, label).toEqual([[target, "pr_owner"]]);
            if (expected === "hold" && mode !== "ask") expect(result.body.text, label).toMatch(/another person/);
            // the person's rights stay the route's: a member is refused by the route
            if (role === "member" && expected === "run") expect(result.status, label).toBe(403);
            if (role === "admin" && expected === "run") expect(result.body.text, label).toMatch(/^Done/);
          }
        }
      }
    }
  });

  it("asks nothing about others on a personal server: the level decides", async () => {
    for (const { key, value, target } of changes) {
      const h = harness({ mode: "full", engineShared: () => true });
      await h.call({ action: "set", key, value, ...(target ? { target } : {}) });
      expect(h.planned.at(-1)?.effect, key).toBe("run");
    }
  });
});

describe("sagax_settings engine sign-in on an organization server (#1545)", () => {
  it("checks the person's own subscription, not the server's sign-in", async () => {
    const cards: unknown[] = [];
    const answer = (path: string) => path === "/api/me/engines" ? { engines: [
      { instanceId: "claude", displayName: "Claude", subscription: { supported: true, signedIn: false } },
      { instanceId: "codex", displayName: "Codex", subscription: { supported: true, signedIn: true } },
      { instanceId: "grok", displayName: "Grok API", subscription: { supported: false, signedIn: false } },
    ] } : {};
    const h = harness({ organization: () => true, answer, card: (_input, card) => { cards.push(card); return { status: 201, body: {} }; } });
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "claude", value: true })).body.text).toMatch(/sign-in card for Claude/);
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "codex", value: true })).body.text).toMatch(/already signed in/);
    expect((await h.call({ action: "set", key: "models.engineSignIn", target: "grok", value: true })).body.error).toMatch(/no personal sign-in/);
    expect(cards).toEqual([{ kind: "engineSignIn", instanceId: "claude", name: "Claude" }]);
    expect(h.planned.every((row) => row.path === "/api/me/engines")).toBe(true);
    // the person's own subscription is theirs: signing it out follows the level
    const out = harness({ organization: () => true, mode: "auto" });
    await out.call({ action: "set", key: "models.mySignOut", target: "claude", value: true });
    expect(out.planned.at(-1)).toMatchObject({ effect: "run", method: "POST", path: "/api/me/engines/claude/login/sign-out" });
  });
});

describe("sagax_settings: the rest of Settings (#1545, lot 2)", () => {
  it("writes each provider key where the screen does, and reads only which are saved", async () => {
    const h = harness({ mode: "full", answer: { anthropic: { configured: true }, tts: { keys: { elevenlabs: true, fish: false } }, imageGen: { openaiConfigured: false } } });
    await h.call({ action: "set", key: "models.providerKey", value: { anthropic: { key: "sk-a" }, elevenlabs: { key: "el" }, fishAudio: { key: "fa" } } });
    expect(h.planned.at(-1)).toMatchObject({ method: "PATCH", path: "/api/config", body: { anthropic: { key: "sk-a" }, tts: { key: "el", fishKey: "fa" } } });
    const saved = JSON.parse(String((await h.call({ action: "get", key: "models.providerKey" })).body.text));
    expect(saved.value).toMatchObject({ anthropic: true, elevenlabs: true, fishAudio: false, openaiImage: false });
    expect(JSON.stringify(saved)).not.toMatch(/sk-a|"el"/);
    expect((await h.call({ action: "set", key: "models.providerKey", value: { nope: { key: "x" } } })).body.error).toMatch(/not a provider key/);
  });

  it("lists the vault with the person's own POST listing, names and sites only", async () => {
    const items = [{ id: "v1", kind: "login", name: "Shop", username: "me@example.com", domains: ["shop.example"], hasPassword: true, source: "local", grants: [{ botId: "b1" }], card: { last4: "4242" } }];
    const h = harness({ answer: { items } });
    const all = JSON.parse(String((await h.call({ action: "get", key: "credentials.item" })).body.text));
    expect(all.value).toEqual([{ id: "v1", kind: "login", name: "Shop", domains: ["shop.example"], hasPassword: true, source: "local", grants: [{ botId: "b1" }] }]);
    expect(h.planned[0]).toMatchObject({ effect: "run", method: "POST", path: "/api/me/credentials/list", body: {} });
    const one = JSON.parse(String((await h.call({ action: "get", key: "credentials.item", target: "v1" })).body.text));
    expect(one.value).not.toHaveProperty("username");
    const access = JSON.parse(String((await h.call({ action: "get", key: "credentials.botAccess", target: "v1" })).body.text));
    expect(access.value).toEqual([{ botId: "b1" }]);
  });

  it("every setting has a get, or is an action the screen offers (create, delete, run, test, sign-in)", () => {
    const actions = /(?:update|reset|power|Action|Attach|Revoke|create|delete|remove|Delete|Remove|run|Run|Test|SignIn|SignOut|Install|Refresh|Update|Account|Disconnect|Telegram|WhatsApp|commandAllow|template\.|section\.bots|account\.avatar|computer\.rename|liveKeyRemove)/;
    const missing = SETTINGS.filter((spec) => !spec.read && !actions.test(spec.key)).map((spec) => spec.key);
    expect(missing).toEqual([]);
  });

  it("reads a device-only preference as a note, never a refusal", async () => {
    for (const organization of [true, false]) {
      const h = harness({ organization: () => organization });
      const read = await h.call({ action: "get", key: "appearance.sendKey" });
      expect(read.status).toBe(200);
      expect(JSON.parse(String(read.body.text))).toMatchObject({ value: null, note: expect.stringMatching(/open Sagax app/) });
    }
  });

  it("matrix for the new keys: the level decides on a personal server, the organization keeps its card", async () => {
    const cases: Array<{ key: string; value: unknown; target?: string; card?: true }> = [
      { key: "account.usageMeter", value: true },
      { key: "notifications.blocks", value: { unblock: "pr_x" } },
      { key: "account.experimental", value: { features: { browser: true } } },
      { key: "bot.inboundMail", value: "scout" },
      { key: "bot.host", value: null },
      { key: "models.ttsModel", value: "v2" },
      { key: "org.phoneCalls", value: { enabled: true }, card: true },
      { key: "models.myVoiceKeys", value: { fish: { key: "k" } }, card: true },
    ];
    for (const mode of ["ask", "auto", "full"] as const) {
      for (const { key, value, target, card } of cases) {
        const h = harness({ mode });
        await h.call({ action: "set", key, value, ...(target ? { target } : {}) });
        expect(h.planned.at(-1)?.effect, `${key} ${mode}`).toBe(mode === "ask" || card ? "hold" : "run");
      }
    }
  });
});

describe("sagax_settings: the actions Settings offers (#1545, lot 3)", () => {
  it("runs each action by the screen's own route and body", async () => {
    const h = harness({ mode: "full" });
    const cases: Array<[Record<string, unknown>, { method: string; path: string; body?: unknown }]> = [
      [{ key: "computer.update", value: true }, { method: "POST", path: "/api/computer/update", body: {} }],
      [{ key: "computer.reset", value: true }, { method: "POST", path: "/api/computer/reset", body: { confirm: true } }],
      [{ key: "computer.power", value: "stop" }, { method: "POST", path: "/api/me/server-environment/power", body: { action: "stop", confirm: true } }],
      [{ key: "computer.localVmAction", value: "ensure" }, { method: "POST", path: "/api/local-computer/ensure", body: { reason: "person" } }],
      [{ key: "server.boxes", value: { sleep: "box1" } }, { method: "POST", path: "/api/computers/boxes/box1/sleep" }],
      [{ key: "org.invites", value: { invite: "new@example.com" } }, { method: "POST", path: "/api/org/invites", body: { email: "new@example.com" } }],
      [{ key: "bot.librarySkills", target: "b1", value: ["writer"] }, { method: "PUT", path: "/api/bots/b1/skills-library", body: { skills: ["writer"] } }],
      [{ key: "bot.history", target: "b1", value: { id: "v3", expectedRevision: 7 } }, { method: "POST", path: "/api/bots/b1/history/restore", body: { id: "v3", expectedRevision: 7 } }],
    ];
    for (const [args, route] of cases) {
      await h.call({ action: "set", ...args });
      expect(h.planned.at(-1), String(args.key)).toMatchObject(route);
    }
    expect((await h.call({ action: "set", key: "computer.update", value: false })).body.error).toMatch(/value is true/);
  });

  it("matrix: admin and member, Ask, Approve for me and Full; a member's refusal is the route's own", async () => {
    const adminRoutes = /^\/api\/(computers|computer\/(maintenance|disk-saver)|tool-grants|org|moderation|admin|local-computer)/;
    const cases: Array<{ key: string; value: unknown; sensitive?: true }> = [
      { key: "computer.update", value: true },
      { key: "computer.power", value: "start" },
      { key: "server.maintenance", value: { enabled: true } },
      { key: "computer.localVmAction", value: "start" },
      { key: "computer.reset", value: true },
      { key: "server.diskSaver", value: { categories: ["cache"] }, sensitive: true },
      { key: "org.toolGrants", value: "tg_1", sensitive: true },
      { key: "org.invites", value: { invite: "a@example.com" }, sensitive: true },
      { key: "org.pageRevoke", value: "p1", sensitive: true },
    ];
    for (const role of ["admin", "member"] as const) {
      for (const mode of ["ask", "auto", "full"] as const) {
        for (const { key, value, sensitive } of cases) {
          const h = harness({ mode, ...(role === "member" ? { routeStatus: (method: string, path: string) => method !== "GET" && adminRoutes.test(path) ? 403 : 200 } : {}) });
          const result = await h.call({ action: "set", key, value });
          const expected = mode === "ask" || sensitive ? "hold" : "run";
          expect(h.planned.at(-1)?.effect, `${key} ${role} ${mode}`).toBe(expected);
          if (expected === "run") {
            const adminOnly = adminRoutes.test(String(h.planned.at(-1)?.path));
            expect(result.status, `${key} ${role}`).toBe(role === "member" && adminOnly ? 403 : 200);
          }
        }
      }
    }
  });
});
