import { describe, expect, it } from "vitest";
import { isSmallTalk } from "./small-talk.ts";

describe("isSmallTalk", () => {
  it("recognizes a greeting, thanks, a goodbye or how-are-you alone, in French and English", () => {
    for (const text of ["Hello Quasar", "hello", "Salut !", "Bonjour 👋", "allô", "Coucou toi", "Hi there", "Hey Quasar!",
      "Merci", "merci beaucoup !", "Thanks!", "thank you", "Bonne nuit", "Bonne soirée Quasar", "à demain", "See you tomorrow",
      "Comment ça va?", "How are you?", "Salut, comment ça va ?", "Bonjour et merci", "How’s it going", "Re"]) {
      expect(isSmallTalk(text, "Quasar"), text).toBe(true);
    }
  });

  it("never takes a request, a question or a confirmation for small talk", () => {
    for (const text of ["ok", "oui", "Oui vas-y", "go", "d'accord", "continue", "Hello, can you check the CI?", "Salut, lance gh auth login",
      "Merci, maintenant déploie", "Bonjour Quasar, où en est le login GitHub ?", "Thanks, and the logs?", "hello world in python",
      "`hello`", "/compact", "ça va", "Ça va ?", "Salut, ça va ?", "quoi de neuf ?", "what's up", "bonjour\nlance le build", "Salut Bob", "", "   ", "merci merci merci merci merci"]) {
      expect(isSmallTalk(text, "Quasar"), text).toBe(false);
    }
    expect(isSmallTalk(undefined)).toBe(false);
    expect(isSmallTalk(`hello ${"x".repeat(100)}`)).toBe(false);
  });
});
