import { describe, expect, it } from "vitest";
import { personaPageRank, personaPagesMatching, stepPersonaResult } from "./persona-search";
import { PERSONA_CATEGORIES, type PersonaCategory } from "./persona-sections";

const label = (page: PersonaCategory) => ({ appearance: "Apparence", model: "Modèle", voice: "Voix", permissions: "Permissions", access: "Accès", perspicax: "Perspicax Profiles" } as Record<string, string>)[page] ?? page;
const find = (query: string) => personaPagesMatching(PERSONA_CATEGORIES, query, label);

describe("persona search index", () => {
  it("keeps every page in rail order for an empty query", () => {
    expect(find("  ")).toEqual([...PERSONA_CATEGORIES]);
  });
  it("finds the page of a setting by a French or English word, accents optional", () => {
    expect(find("mascotte")[0]).toBe("appearance");
    expect(find("moteur")).toContain("model");
    expect(find("voix")[0]).toBe("voice");
    expect(find("horaire")).toEqual(expect.arrayContaining(["voice", "permissions", "access"]));
    expect(find("approbation")).toContain("permissions");
    expect(find("mcp")).toEqual(expect.arrayContaining(["access", "perspicax"]));
    expect(find("modele")).toContain("model");
  });
  it("ranks a label before a keyword before the index", () => {
    expect(personaPageRank("voice", "Voix", "voix")).toBe(0);
    expect(personaPageRank("model", "Modèle", "claude")).toBe(2);
    expect(find("mcp").slice(0, 2)).toEqual(["access", "perspicax"]);
  });
  it("returns nothing for a word no page holds", () => {
    expect(find("zzzxq")).toEqual([]);
  });
  it("steps through results and wraps", () => {
    const list = ["a", "b", "c"];
    expect(stepPersonaResult(list, "a", "ArrowDown")).toBe("b");
    expect(stepPersonaResult(list, "c", "ArrowDown")).toBe("a");
    expect(stepPersonaResult(list, "a", "ArrowUp")).toBe("c");
    expect(stepPersonaResult(list, undefined, "ArrowDown")).toBe("a");
    expect(stepPersonaResult(list, "a", "x")).toBeNull();
    expect(stepPersonaResult([], "a", "ArrowDown")).toBeNull();
  });
});
