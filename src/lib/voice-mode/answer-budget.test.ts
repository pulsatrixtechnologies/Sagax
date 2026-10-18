import { describe, expect, it } from "vitest";

import { SPOKEN_SENTENCES_MAX, spokenAnswer, spokenReply } from "./answer-budget";

describe("how much of an answer a call says", () => {
  it("says a short answer whole", () => {
    expect(spokenAnswer("Yes, the backup ran. It finished at nine.")).toEqual({ text: "Yes, the backup ran. It finished at nine.", cut: null });
    expect(spokenAnswer("")).toEqual({ text: "", cut: null });
  });

  it("stops after four sentences, and says the rest is in the chat", () => {
    expect(SPOKEN_SENTENCES_MAX).toBe(4);
    const answer = spokenAnswer("Un. Deux, c'est fait. Trois! Quatre… Cinq reste écrit. Six aussi.");
    expect(answer).toEqual({ text: "Un. Deux, c'est fait. Trois! Quatre… ", cut: "length" });
    expect(spokenReply("Un. Deux. Trois. Quatre. Cinq.", "Le reste est écrit dans la conversation.")).toBe(
      "Un. Deux. Trois. Quatre. Le reste est écrit dans la conversation.",
    );
    // a language without those words adds nothing
    expect(spokenReply("Un. Deux. Trois. Quatre. Cinq.", null)).toBe("Un. Deux. Trois. Quatre.");
  });

  it("a question ends what is said: one question per turn", () => {
    expect(spokenAnswer("Le serveur est arrêté. Veux-tu que je le redémarre? Ou que j'ouvre un billet?")).toEqual({
      text: "Le serveur est arrêté. Veux-tu que je le redémarre? ",
      cut: "question",
    });
    // a question cut says nothing more: the person answers it
    expect(spokenReply("Should I restart it? Or open a ticket?", "The rest is written in the chat.")).toBe("Should I restart it?");
    // a question as the last sentence is the answer whole
    expect(spokenAnswer("It is down. Should I restart it?")).toEqual({ text: "It is down. Should I restart it?", cut: null });
  });

  it("a quoted or a short rhetorical question does not end it", () => {
    expect(spokenAnswer('You asked "is it done?" Yes, it is done.').cut).toBeNull();
    expect(spokenAnswer("Tu demandes « est-ce fait ? » Oui, c'est fait.").cut).toBeNull();
    expect(spokenAnswer("Tu demandes « est-ce fait\u202f? » Oui, c'est fait.").cut).toBeNull();
    expect(spokenAnswer("Pourquoi? Parce que le disque est plein.").cut).toBeNull();
    expect(spokenAnswer("Pourquoi? Parce que le disque est plein.").text).toBe("Pourquoi? Parce que le disque est plein.");
  });

  it("code counts for nothing: its lines and marks are never spoken", () => {
    const answer = "Run this:\n```\nnpm ci\nnpm test\n```\nThen it works. Done.";
    expect(spokenAnswer(answer)).toEqual({ text: answer, cut: null });
    expect(spokenAnswer("Use `a ? b : c` here. It is fine.").cut).toBeNull();
  });

  it("a CRLF line ends a sentence like a line break", () => {
    expect(spokenAnswer("One\r\nTwo\r\nThree\r\nFour\r\nFive").cut).toBe("length");
  });

  it("a long run of dots is one linear pass", () => {
    const started = performance.now();
    spokenAnswer(`${".".repeat(50_000)}x`);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it("counts a line of a list as a sentence, never a list number or an abbreviation", () => {
    const list = "Three things:\n1. the printer\n2. the badge reader\n3. the camera\n4. the door";
    expect(spokenAnswer(list).text).toBe("Three things:\n1. the printer\n2. the badge reader\n3. the camera\n");
    expect(spokenAnswer(list).cut).toBe("length");
    expect(spokenAnswer("M. Tremblay a appelé. Il rappelle e.g. demain. Merci. Bonne journée. Fin.").text).toBe(
      "M. Tremblay a appelé. Il rappelle e.g. demain. Merci. Bonne journée. ",
    );
    expect(spokenAnswer("The rate is 3.5 percent. Two. Three. Four. Five.").text).toBe("The rate is 3.5 percent. Two. Three. Four. ");
  });

  it("never keeps more as the answer is written: the cut is a prefix that only grows", () => {
    const full = "One. Two. Three. Four. Five. Six? Seven.";
    let previous = "";
    for (let end = 1; end <= full.length; end += 1) {
      const said = spokenAnswer(full.slice(0, end)).text;
      expect(said.startsWith(previous)).toBe(true);
      previous = said;
    }
    expect(previous).toBe("One. Two. Three. Four. ");
    // code that closes later never moves the cut earlier
    for (const sample of ["Ok? `x` One. Two. Three. Four. Five.", "One 3 One?` »1. 3One.5 is it`"]) {
      let kept = "";
      for (let end = 1; end <= sample.length; end += 1) {
        const said = spokenAnswer(sample.slice(0, end)).text;
        expect(said.startsWith(kept)).toBe(true);
        kept = said;
      }
    }
  });

  it("does not count words that are never spoken, and never says the follow-up", () => {
    expect(spokenAnswer("Done. Two. Three. Four.\n\n```\ncode\n```")).toEqual({ text: "Done. Two. Three. Four.\n\n", cut: null });
    expect(spokenAnswer("Done, bye.\n---\nOne. Two. Three. Four. Five.")).toEqual({ text: "Done, bye.\n", cut: null });
  });
});
