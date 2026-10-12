import { describe, expect, it } from "vitest";

import { ttsLeadStep } from "./tts-lead";

describe("ttsLeadStep (first grok token opens TTS before the clause is complete)", () => {
  it("a punctuated first clause is spoken whole, no lead", () => {
    expect(ttsLeadStep({
      streaming: true, leadSent: null, emitted: ["Bien sûr,"], unconsumed: "",
    })).toEqual({
      actions: [{ action: "speak", text: "Bien sûr," }],
      leadSent: null,
    });
  });

  it("an unpunctuated first word begins a lead utterance (delta, not done)", () => {
    expect(ttsLeadStep({
      streaming: true, leadSent: null, emitted: [], unconsumed: "Four",
    })).toEqual({
      actions: [{ action: "begin", text: "Four" }],
      leadSent: "Four",
    });
  });

  it("more of the same first clause appends, and does not finish", () => {
    expect(ttsLeadStep({
      streaming: true, leadSent: "Four", emitted: [], unconsumed: "Four is",
    })).toEqual({
      actions: [{ action: "append", text: " is" }],
      leadSent: "Four is",
    });
  });

  it("the first clause completing finishes the lead, with the missing tail", () => {
    expect(ttsLeadStep({
      streaming: true, leadSent: "Four", emitted: ["Four is"], unconsumed: " the sum of two and two.",
    })).toEqual({
      actions: [{ action: "finish", append: " is" }],
      leadSent: null,
    });
  });

  it("a first clause that already matches the lead just finishes", () => {
    expect(ttsLeadStep({
      streaming: true, leadSent: "Four is", emitted: ["Four is"], unconsumed: " the sum.",
    })).toEqual({
      actions: [{ action: "finish" }],
      leadSent: null,
    });
  });

  it("later clauses after a finished lead are spoken whole", () => {
    expect(ttsLeadStep({
      streaming: true, leadSent: "Four", emitted: ["Four is", "the sum of two and two."], unconsumed: "",
    })).toEqual({
      actions: [
        { action: "finish", append: " is" },
        { action: "speak", text: "the sum of two and two." },
      ],
      leadSent: null,
    });
  });

  it("POST / non-streaming never opens a lead", () => {
    expect(ttsLeadStep({
      streaming: false, leadSent: null, emitted: [], unconsumed: "Four",
    })).toEqual({ actions: [], leadSent: null });
    expect(ttsLeadStep({
      streaming: false, leadSent: null, emitted: ["Bien sûr,"], unconsumed: "",
    })).toEqual({
      actions: [{ action: "speak", text: "Bien sûr," }],
      leadSent: null,
    });
  });

  it("empty unconsumed does not begin a lead", () => {
    expect(ttsLeadStep({
      streaming: true, leadSent: null, emitted: [], unconsumed: "  ",
    })).toEqual({ actions: [], leadSent: null });
  });
});
