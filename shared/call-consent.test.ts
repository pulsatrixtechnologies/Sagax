import { describe, expect, it } from "vitest";

import { spokenConsent } from "./call-consent.ts";

describe("spokenConsent", () => {
  it("reads a clear yes or no at the start of the answer", () => {
    expect(spokenConsent("Yes, go ahead")).toBe("allow");
    expect(spokenConsent("okay")).toBe("allow");
    expect(spokenConsent("No, don't do that")).toBe("deny");
    expect(spokenConsent("cancel it")).toBe("deny");
  });

  it("drops leading filler words", () => {
    expect(spokenConsent("uh, yes")).toBe("allow");
    expect(spokenConsent("Hmm... no")).toBe("deny");
  });

  it("never reads consent from a sentence that only contains the word", () => {
    expect(spokenConsent("I'm not sure")).toBeNull();
    expect(spokenConsent("what does it want to do? sure, maybe")).toBeNull();
    expect(spokenConsent("")).toBeNull();
    expect(spokenConsent("yesterday was fine")).toBeNull();
  });

  // On a Live call the microphone stays open while the voice speaks, and
  // nothing waits for the person to finish a thought: "okay…" then a pause
  // then "wait, what does it delete?" granted the card. Take turns closes the
  // microphone while the bot talks and keeps its rule.
  describe("on a Live call", () => {
    it("does not take a hedging okay, sure or fine as a yes", () => {
      for (const said of ["okay", "OK.", "ok", "sure", "fine", "Okay... wait, what does it delete?", "okay I need your permission to run a command"]) {
        expect(spokenConsent(said, "live"), said).toBeNull();
      }
    });

    it("still reads a clear yes or no, after a hedge or filler", () => {
      expect(spokenConsent("yes", "live")).toBe("allow");
      expect(spokenConsent("Okay, yes", "live")).toBe("allow");
      expect(spokenConsent("sure, go ahead", "live")).toBe("allow");
      expect(spokenConsent("uh, do it", "live")).toBe("allow");
      expect(spokenConsent("okay no", "live")).toBe("deny");
      expect(spokenConsent("no", "live")).toBe("deny");
      expect(spokenConsent("fine, don't", "live")).toBe("deny");
    });

    it("does not grant a qualified, corrected or questioning yes", () => {
      for (const said of ["yes, but do not delete it", "yes — wait, no", "yes, what does that delete?", "yes, only if you make a backup"]) {
        expect(spokenConsent(said, "live"), said).toBeNull();
      }
      expect(spokenConsent("Yes, go ahead.", "live")).toBe("allow");
      expect(spokenConsent("yes please", "live")).toBe("allow");
    });

    it("leaves take turns as it was", () => {
      expect(spokenConsent("okay")).toBe("allow");
      expect(spokenConsent("sure", "turns")).toBe("allow");
      expect(spokenConsent("fine")).toBe("allow");
    });
  });

  // Every call that speaks the card as "Allow once, or deny?" (voice mode,
  // take turns, a room, the iPhone): the answer must pick an option.
  describe("on a voice call (two options)", () => {
    it("allows on a whole-utterance yes, in English or French", () => {
      for (const said of ["yes", "Yes, go ahead.", "allow once", "Allow it", "uh, yes please", "okay, do it", "oui", "Oui, vas-y.", "ouais", "autoriser une fois", "Autorise-le", "j\u2019autorise", "ben oui", "d'accord, vas-y", "je confirme", "confirm it"]) {
        expect(spokenConsent(said, "voice"), said).toBe("allow");
      }
    });

    it("denies on a clear no, a reason allowed", () => {
      for (const said of ["no", "No, don't do that.", "deny", "cancel it", "non", "Non merci", "refuser", "je refuse", "pas question", "annule ça", "don't do it", "okay no"]) {
        expect(spokenConsent(said, "voice"), said).toBe("deny");
      }
    });

    it("asks again for a hedge, a mix, a question, a condition or Always allow", () => {
      for (const said of [
        "okay", "sure", "fine", "d'accord", "ok?", "", "   ",
        "yes, but rename it first", "yes wait no", "yes, what does it delete?", "oui mais pas ce fichier-là",
        "no wait, yes", "non, vas-y", "no? what is it", "non, plutôt l'autre",
        "always allow", "allow always", "toujours autoriser",
        "yesterday was fine", "I'm not sure", "what does it do", "nonsense",
      ]) {
        expect(spokenConsent(said, "voice"), JSON.stringify(said)).toBeNull();
      }
    });
  });
});
