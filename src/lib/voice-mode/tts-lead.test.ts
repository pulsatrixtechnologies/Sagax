import { describe, expect, it } from "vitest";

import { leadText, NO_LEAD, ROLL_CHARS, ttsLeadStep, type TtsLeadAction, type TtsLeadState } from "./tts-lead";

/** Feed the steps in order; what went to the voice, and the state after. */
function run(steps: Array<{ emitted?: string[]; unconsumed?: string; done?: boolean; streaming?: boolean }>, state: TtsLeadState = NO_LEAD) {
  const actions: TtsLeadAction[] = [];
  for (const step of steps) {
    const out = ttsLeadStep({ streaming: step.streaming ?? true, state, emitted: step.emitted ?? [], unconsumed: step.unconsumed ?? "", ...(step.done ? { done: true } : {}) });
    actions.push(...out.actions);
    state = out.state;
  }
  return { actions, state };
}

/** The text the voice was given, as one utterance per begin..finish. */
function spoken(actions: TtsLeadAction[]): string[] {
  const out: string[] = [];
  for (const action of actions) {
    if (action.action === "begin" || action.action === "speak") out.push(action.text);
    else if (action.action === "append") out[out.length - 1] += action.text;
  }
  return out;
}

describe("ttsLeadStep (one xAI utterance per answer)", () => {
  it("a punctuated first clause opens the utterance, later clauses grow it, done ends it", () => {
    const { actions, state } = run([
      { emitted: ["Bien sûr,"] },
      { emitted: ["il fait beau."] },
      { emitted: ["Autre chose?"], done: true },
    ]);
    expect(actions).toEqual([
      { action: "begin", text: "Bien sûr,", caption: { text: "Bien sûr,", at: 0 } },
      { action: "append", text: " il fait beau.", caption: { text: "il fait beau.", at: 10 } },
      { action: "append", text: " Autre chose?", caption: { text: "Autre chose?", at: 24 } },
      { action: "finish" },
    ]);
    expect(state).toEqual(NO_LEAD);
  });

  it("never finishes before the answer is done, even after a full sentence", () => {
    const { actions } = run([{ emitted: ["C'est fait."] }, { unconsumed: "Le billet " }]);
    expect(actions.some((a) => a.action === "finish")).toBe(false);
  });

  it("an unpunctuated first word begins the utterance as a lead", () => {
    const { actions, state } = run([{ unconsumed: "Four" }]);
    expect(actions).toEqual([{ action: "begin", text: "Four" }]);
    expect(state).toEqual({ open: 4, lead: "Four", clauseAt: 0 });
  });

  it("more of the lead appends; the clause completing appends its tail with the caption", () => {
    const { actions } = run([
      { unconsumed: "Four" },
      { unconsumed: "Four is" },
      { emitted: ["Four is the sum."], unconsumed: " Yes" },
      { done: true },
    ]);
    expect(actions).toEqual([
      { action: "begin", text: "Four" },
      { action: "append", text: " is" },
      { action: "append", text: " the sum.", caption: { text: "Four is the sum.", at: 0 } },
      { action: "append", text: " Yes" },
      { action: "finish" },
    ]);
    expect(spoken(actions)).toEqual(["Four is the sum. Yes"]);
  });

  it("a lead that ran past a short clause carries on as the next clause", () => {
    const { actions } = run([
      { unconsumed: "Oui, c'est" },
      { emitted: ["Oui,"], unconsumed: " c'est réglé" },
      { emitted: ["c'est réglé."], done: true },
    ]);
    expect(actions).toEqual([
      { action: "begin", text: "Oui, c'est" },
      { action: "append", text: "", caption: { text: "Oui,", at: 0 } },
      { action: "append", text: " réglé" },
      { action: "append", text: ".", caption: { text: "c'est réglé.", at: 5 } },
      { action: "finish" },
    ]);
    expect(spoken(actions)).toEqual(["Oui, c'est réglé."]);
  });

  it("markdown never opens the utterance; the bold word is said", () => {
    const { actions } = run([
      { unconsumed: "*" },
      { unconsumed: "**" },
      { unconsumed: "**Oui" },
      { emitted: ["Oui, c'est réglé."], done: true },
    ]);
    expect(actions[0]).toEqual({ action: "begin", text: "Oui" });
    expect(spoken(actions)).toEqual(["Oui, c'est réglé."]);
  });

  it("a rewritten clause is said from the last shared word, never lost", () => {
    const { actions } = run([{ unconsumed: "Le bilet" }, { emitted: ["Le billet est fermé."], done: true }]);
    expect(spoken(actions)).toEqual(["Le bilet billet est fermé."]);
  });

  it("past ROLL_CHARS the utterance ends at a sentence end and the next one begins", () => {
    const sentence = `${"mot ".repeat(99)}fin.`;
    const steps = Array.from({ length: Math.ceil(ROLL_CHARS / sentence.length) + 1 }, () => ({ emitted: [sentence] }));
    const { actions } = run([...steps, { done: true }]);
    const finishes = actions.filter((a) => a.action === "finish").length;
    const begins = actions.filter((a) => a.action === "begin").length;
    expect(begins).toBe(2);
    expect(finishes).toBe(2);
    for (const text of spoken(actions)) expect(text.length).toBeLessThan(ROLL_CHARS + sentence.length + 2);
  });

  it("POST / non-streaming speaks each clause and never opens a lead", () => {
    expect(run([{ streaming: false, unconsumed: "Four" }]).actions).toEqual([]);
    expect(run([{ streaming: false, emitted: ["Bien sûr,"] }]).actions).toEqual([{ action: "speak", text: "Bien sûr," }]);
  });

  it("the socket giving up mid-answer ends the utterance; the lead already said is not said again", () => {
    const first = run([{ unconsumed: "Oui c'est" }]);
    const { actions } = run([{ streaming: false, emitted: ["Oui c'est réglé."] }, { streaming: false, emitted: ["Merci."] }], first.state);
    expect(actions).toEqual([
      { action: "finish" },
      { action: "speak", text: "réglé." },
      { action: "speak", text: "Merci." },
    ]);
  });

  it("blank text does not begin anything", () => {
    expect(run([{ unconsumed: "  " }]).actions).toEqual([]);
  });
});

describe("leadText", () => {
  it("cleans markdown and waits for a letter", () => {
    expect(leadText("*")).toBe("");
    expect(leadText("**Oui")).toBe("Oui");
    expect(leadText("_Oui")).toBe("Oui");
    expect(leadText("👍 ")).toBe("");
  });

  it("stops before links, code and tables, and holds back a last word with a digit", () => {
    expect(leadText("Voir [le lien")).toBe("Voir");
    expect(leadText("Lance `pnpm")).toBe("Lance");
    expect(leadText("Le billet 297048")).toBe("Le billet");
    expect(leadText("Rendez-vous à 14h30")).toBe("Rendez-vous à");
    expect(leadText("Ça coûte 25 $")).toBe("Ça coûte");
  });
});
