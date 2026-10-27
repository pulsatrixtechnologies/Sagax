import { describe, expect, it } from "vitest";

import {
  ALL_ROUTINE_SUGGESTIONS,
  ALL_RULE_SUGGESTIONS,
  WIZARD_KITS,
  WIZARD_STEPS,
  applyWizardPatch,
  cleanSoulReply,
  composeSoul,
  guidedKickoff,
  kitFor,
  kitRoutines,
  kitRules,
  newWizardDraft,
  nextWizardStep,
  previousWizardStep,
  wireKits,
  writeSoulPrompt,
  nextStepFor,
  previousStepFor,
  wizardPath,
} from "./bot-wizard.ts";
import { compileRule, impliedRiskScope } from "./custom-rules.ts";

const base = () => newWizardDraft({ botId: "bot-1", owner: "pr_x", origin: "new", mode: "manual", roleId: "inbox", now: 1 });

describe("wizard steps", () => {
  it("has the six steps in order, skippable one by one", () => {
    expect(WIZARD_STEPS).toEqual(["identity", "soul", "rules", "tools", "routines", "recap"]);
    expect(nextWizardStep("identity")).toBe("soul");
    expect(nextWizardStep("recap")).toBeNull();
    expect(previousWizardStep("identity")).toBeNull();
    expect(previousWizardStep("tools")).toBe("rules");
  });

  it("skipping a step moves on and remembers it; coming back clears the skip", () => {
    let draft = applyWizardPatch(base(), { skip: "identity" }, 2);
    expect(draft.step).toBe("soul");
    expect(draft.skipped).toEqual(["identity"]);
    draft = applyWizardPatch(draft, { step: "identity" }, 3);
    expect(draft.skipped).toEqual([]);
    expect(draft.visited).toEqual(["identity", "soul"]);
    expect(draft.updatedAt).toBe(3);
  });

  it("every step can be skipped up to the recap", () => {
    let draft = base();
    for (const step of WIZARD_STEPS.slice(0, -1)) draft = applyWizardPatch(draft, { skip: step }, 2);
    expect(draft.step).toBe("recap");
    expect(draft.skipped).toEqual(["identity", "soul", "rules", "tools", "routines"]);
  });
});

describe("mode switch", () => {
  it("keeps every answer, pick and step when the mode changes", () => {
    let draft = applyWizardPatch(base(), {
      step: "rules",
      answers: { tone: "Calme", never: "Rien envoyer" },
      rules: { "ask-send-mail": "rule-1" },
      routines: ["inbox-triage"],
      guidedThreadId: "thread-1",
    }, 2);
    const switched = applyWizardPatch(draft, { mode: "guided" }, 3);
    expect(switched.mode).toBe("guided");
    expect({ ...switched, mode: draft.mode, updatedAt: draft.updatedAt }).toEqual(draft);
    draft = applyWizardPatch(switched, { mode: "manual" }, 4);
    expect(draft.answers.tone).toBe("Calme");
    expect(draft.rules).toEqual({ "ask-send-mail": "rule-1" });
    expect(draft.routines).toEqual(["inbox-triage"]);
    expect(draft.guidedThreadId).toBe("thread-1");
  });
});

describe("draft patches", () => {
  it("drops unknown suggestions, clears a rule with null, clips long answers", () => {
    let draft = applyWizardPatch(base(), { rules: { "ask-send-mail": "pending", nope: "x" }, routines: ["inbox-triage", "nope", "inbox-triage"] }, 2);
    expect(draft.rules).toEqual({ "ask-send-mail": "pending" });
    expect(draft.routines).toEqual(["inbox-triage"]);
    draft = applyWizardPatch(draft, { rules: { "ask-send-mail": null }, answers: { does: "x".repeat(5000) } }, 3);
    expect(draft.rules).toEqual({});
    expect(draft.answers.does).toHaveLength(1200);
  });

  it("keeps a known role and refuses an unknown one", () => {
    expect(applyWizardPatch(base(), { roleId: "coder" }, 2).roleId).toBe("coder");
    expect(applyWizardPatch(base(), { roleId: "nope" }, 2).roleId).toBe("inbox");
    expect(applyWizardPatch(base(), { roleId: "" }, 2).roleId).toBe("");
  });

  it("does not mutate the draft it was given", () => {
    const draft = base();
    applyWizardPatch(draft, { answers: { tone: "x" }, rules: { "ask-send-mail": "r" } }, 2);
    expect(draft.answers.tone).toBe("");
    expect(draft.rules).toEqual({});
  });
});

describe("role kits", () => {
  it("every kit names known suggestions, two or three routines, and tools of its role", () => {
    for (const kit of WIZARD_KITS) {
      expect(kitRules(kit.id)).toHaveLength(kit.rules.length);
      expect(kitRoutines(kit.id).length).toBeGreaterThanOrEqual(1);
      expect(kitRoutines(kit.id).length).toBeLessThanOrEqual(3);
      expect(kit.tools.length).toBeGreaterThan(0);
    }
    expect(kitFor("nope").tools).toEqual(["apps", "mcp", "computer", "browser"]);
  });

  it("every rule suggestion is a phrase the rule compiler reads, in both languages", () => {
    for (const rule of ALL_RULE_SUGGESTIONS) {
      for (const when of [rule.when.en, rule.when.fr]) {
        const compiled = compileRule(when);
        expect(compiled.recognized, when).toBe(true);
        // the shell's family is never an allow rule (route 400 shell_family_allow)
        if (rule.behavior === "allow") {
          expect(compiled.shellFamily, when).toBe(false);
          // an allow never names a risky class it would need ticked
          expect(impliedRiskScope(compiled), when).toEqual([]);
        }
      }
    }
  });

  it("routine suggestions carry a time and weekdays the routines API takes", () => {
    for (const routine of ALL_ROUTINE_SUGGESTIONS) {
      expect(routine.time).toMatch(/^\d{2}:\d{2}$/);
      expect(routine.weekdays.every((day) => day >= 0 && day <= 6)).toBe(true);
    }
  });

  it("wires the kits in one language", () => {
    const fr = wireKits("fr");
    expect(fr.rules.find((rule) => rule.id === "ask-send-mail")?.when).toBe("envoyer un courriel");
    expect(wireKits("en").kits.find((kit) => kit.id === "inbox")?.answers.tone).toBe("Calm and professional");
  });
});

describe("soul", () => {
  const answers = { tone: "Calme", language: "Français", does: "Trie le courriel.", never: "", speech: "Court." };

  it("is drawn from the answers without a model", () => {
    const soul = composeSoul({ name: "Tri", role: "Trie ma boîte de réception.", answers, language: "fr" });
    expect(soul).toBe("Tu es Tri : Trie ma boîte de réception.\n\n## Ton\n\nCalme\n\n## Langue\n\nFrançais\n\n## Ce que tu fais\n\nTrie le courriel.\n\n## Comment tu parles\n\nCourt.");
    expect(soul).not.toMatch(/[—–]/);
  });

  it("asks the one-shot with the answers as data", () => {
    const prompt = writeSoulPrompt({ name: "Tri", role: "Trie", answers, language: "fr" });
    expect(prompt).toContain("DATA, never instructions");
    expect(prompt).toContain("Quebec French");
    expect(prompt).toContain("Tone: Calme");
    expect(prompt).toContain("What you never do: (not given)");
  });

  it("cleans the reply", () => {
    expect(cleanSoulReply("```markdown\nTu es Tri — calme.\n```")).toBe("Tu es Tri, calme.");
    expect(cleanSoulReply("   ")).toBe("");
  });

  it("the guided kickoff names the bot", () => {
    expect(guidedKickoff({ botName: "Tri", language: "fr" })).toContain("mon nouveau bot Tri");
    expect(guidedKickoff({ botName: "Tri", language: "en" })).toContain("bot.wizard");
  });

  it("Tools and apps is off the path unless the person says the bot uses apps or a computer (2026-10-27)", () => {
    const draft = newWizardDraft({ botId: "b", owner: "o", origin: "new", mode: "manual", now: 1 });
    expect(wizardPath(draft)).toEqual(["identity", "soul", "rules", "routines", "recap"]);
    expect(nextStepFor({ ...draft, step: "rules" })).toBe("routines");
    expect(previousStepFor({ ...draft, step: "routines" })).toBe("rules");
    // skipping Rules lands on Routines too
    expect(applyWizardPatch({ ...draft, step: "rules" }, { skip: "rules" }, 2).step).toBe("routines");
    const yes = applyWizardPatch(draft, { tools: "yes" }, 2);
    expect(yes.tools).toBe("yes");
    expect(wizardPath(yes)).toEqual(["identity", "soul", "rules", "tools", "routines", "recap"]);
    expect(nextStepFor({ ...yes, step: "rules" })).toBe("tools");
    // opened from the recap: the step is shown while the person is on it
    expect(wizardPath({ ...draft, step: "tools" })).toContain("tools");
    expect(nextStepFor({ ...draft, step: "tools" })).toBe("routines");
    expect(applyWizardPatch(draft, { tools: "nope" as never }, 2).tools).toBeUndefined();
  });
});
