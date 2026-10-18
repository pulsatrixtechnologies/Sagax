import { describe, expect, it } from "vitest";

import { readForVoice } from "./voice-reading.ts";

describe("numbers, times and dates in the language of the text", () => {
  it("reads French text in French and English text in English", () => {
    expect(readForVoice("auto", "Le billet est fermé à 15:30.")).toBe("Le billet est fermé à 15 heures 30.");
    expect(readForVoice("auto", "The ticket was closed at 15:30.")).toBe("The ticket was closed at 3:30 PM.");
    expect(readForVoice("fr-CA", "OK, 2026-10-18.")).toBe("OK, 18 octobre 2026.");
    expect(readForVoice("en", "OK, 2026-10-18.")).toBe("OK, October 18, 2026.");
  });

  it("judges an appended piece with the utterance before it", () => {
    expect(readForVoice("auto", " 15:30.", "Le serveur redémarre à")).toBe(" 15 heures 30.");
    expect(readForVoice("auto", " 15:30.", "The server restarts at")).toBe(" 3:30 PM.");
  });

  it("leaves another language, or text it cannot judge, as written", () => {
    expect(readForVoice("es", "La reunión es a las 15:30.")).toBe("La reunión es a las 15:30.");
    expect(readForVoice("auto", "15:30")).toBe("15:30");
  });
});
