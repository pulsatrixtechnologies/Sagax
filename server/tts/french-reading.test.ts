import { describe, expect, it } from "vitest";

import { readFrench, readsFrench } from "./french-reading.ts";

describe("French reading for the voice", () => {
  it("leaves words that are already speakable", () => {
    expect(readFrench("Bonjour")).toBe("Bonjour");
    expect(readFrench("Bonjour Ada.")).toBe("Bonjour Ada.");
  });

  it("reads a time, a price, an ordinal and a title", () => {
    expect(readFrench("Rendez-vous à 14 h 30.")).toBe("Rendez-vous à 14 heures 30.");
    expect(readFrench("Rendez-vous à 14h30.")).toBe("Rendez-vous à 14 heures 30.");
    expect(readFrench("À 1 h 30.")).toBe("À 1 heure 30.");
    expect(readFrench("C'est 25 $.")).toBe("C'est 25 dollars.");
    expect(readFrench("C'est $ 25.")).toBe("C'est 25 dollars.");
    expect(readFrench("C'est 1 $.")).toBe("C'est 1 dollar.");
    expect(readFrench("C'est 25 €.")).toBe("C'est 25 euros.");
    expect(readFrench("Le 1er mai, la 1re fois, le 2e et le 10e.")).toBe(
      "Le premier mai, la première fois, le deuxième et le dixième.",
    );
    expect(readFrench("M. Martin, Mme Curie, Mlle Dupont et Dr Pasteur habitent St-Laurent, rue Ste-Catherine.")).toBe(
      "Monsieur Martin, Madame Curie, Mademoiselle Dupont et Docteur Pasteur habitent Saint-Laurent, rue Sainte-Catherine.",
    );
  });

  it("applies only to a French language", () => {
    expect(readsFrench("fr")).toBe(true);
    expect(readsFrench("fr-CA")).toBe(true);
    expect(readsFrench("en")).toBe(false);
    expect(readsFrench("auto")).toBe(false);
  });
});
